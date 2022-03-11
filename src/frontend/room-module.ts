import { ResponseEvent } from "../schema";
import {
  Board,
  Help,
  Input,
  Rectangle,
  Selector,
  Shortcuts,
} from "./lib/board";
import { API } from "./lib/api";
import { updateStatus } from "./lib/navbar";
import { appendCreateRoomButton, debugging } from "./lib/debug";
import { State, ApplicationEvent, update } from "./logic";

type PageInfo = {
  roomId: string;
  wsRoot: string;
};

function getPageInfo(): PageInfo {
  const { host, protocol, pathname } = window.location;
  const splitted = pathname.split("/");
  const roomName = splitted[2];
  const wsProtocol = protocol === "http:" ? "ws" : "wss";
  return {
    roomId: roomName,
    wsRoot: `${wsProtocol}://${host}`,
  };
}

function listenToKeyboardEvents(
  state: State,
  handle: (e: ApplicationEvent) => void
): () => void {
  window.onkeydown = (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;
    if (e.key === "Backspace") {
      return handle({ kind: "key:delete" });
    }
    if (ctrl && e.key === "a") {
      e.preventDefault();
      return handle({ kind: "key:select_all" });
    }
    if ((ctrl && e.key === "y") || (ctrl && shift && e.key === "z")) {
      e.preventDefault();
      return handle({ kind: "key:redo" });
    }
    if (ctrl && e.key === "z") {
      e.preventDefault();
      return handle({ kind: "key:undo" });
    }
  };
  return () => {
    window.onkeydown = null;
  };
}
function listenToShortcutButtons(
  state: State,
  handle: (e: ApplicationEvent) => void
): () => void {
  return state.shortcuts.listenToButtons({
    clickUndo: () => {
      return handle({ kind: "shortcut_button:undo" });
    },
    clickRedo: () => {
      return handle({ kind: "shortcut_button:redo" });
    },
    clickSelect: () => {
      return handle({ kind: "shortcut_button:select" });
    },
    clickDelete: () => {
      return handle({ kind: "shortcut_button:delete" });
    },
  });
}

function listenToWindowEvents(
  state: State,
  handle: (e: ApplicationEvent) => void
): () => void {
  window.onresize = () => {
    return handle({ kind: "window:resize" });
  };
  return () => {
    window.onresize = null;
  };
}
function listenToInputEvents(
  state: State,
  handle: (e: ApplicationEvent) => void
): () => void {
  state.input.listen({
    enter: () => {
      return handle({ kind: "input:enter" });
    },
  });
  return () => state.input.unlisten();
}
function listenToBoard(
  state: State,
  handle: (e: ApplicationEvent) => void
): () => void {
  return state.board.listenToBoardEvents({
    getBoardRect: () => {
      return state.boardRect;
    },
    doubleClick: (position) => {
      handle({ kind: "board:double_click", position });
    },
    mouseDown: (position, isRight) => {
      handle({ kind: "board:mouse_down", position, isRight });
    },
    touchStart: (position) => {
      handle({ kind: "board:touch_start", position });
    },
    touchStartLong: (position) => {
      handle({ kind: "board:touch_start_long", position });
    },
    mouseMove: (position) => {
      handle({ kind: "board:mouse_move", position });
    },
    touchMove: (position) => {
      handle({ kind: "board:touch_move", position });
    },
    mouseUp: (position) => {
      handle({ kind: "board:mouse_up", position });
    },
    touchEnd: (position) => {
      handle({ kind: "board:touch_end", position });
    },
  });
}

function connect(
  pageInfo: PageInfo,
  state: State,
  handle: (e: ApplicationEvent) => void
) {
  const ws = state.api.createWebsocket(pageInfo.wsRoot, pageInfo.roomId);
  ws.addEventListener("open", () => {
    handle({ kind: "ws:open", websocket: ws });
  });
  ws.addEventListener("message", (event) => {
    const data: ResponseEvent = JSON.parse(event.data);
    console.log(data);
    handle({ kind: "ws:message", data });
  });
  ws.addEventListener("close", (event) => {
    handle({ kind: "ws:close", code: event.code, reason: event.reason });
  });
  ws.addEventListener("error", (event) => {
    console.log("WebSocket error:", event);
    handle({ kind: "ws:error" });
  });
}

export async function run(api: API) {
  const pageInfo = getPageInfo();
  const roomInfo = await api.getRoomInfo(pageInfo.roomId);
  if (roomInfo != null) {
    const boardOptions = {
      viewBox: new Rectangle(0, 0, 16, 9),
      textFontSize: 0.3,
      pathStrokeWidth: 0.02,
      selectorStrokeWidth: 0.01,
    };
    const board = new Board(boardOptions);
    const state: State = {
      api,
      self: null,
      board,
      help: new Help(),
      shortcuts: new Shortcuts(),
      input: new Input(),
      selector: new Selector(boardOptions),
      boardRect: board.calculateBoardRect(),
      websocket: null,
      undos: [],
      redos: [],
      editing: { kind: "none" },
      selected: [],
    };
    if (!roomInfo.active) {
      updateStatus("inactive", "Inactive");
      const objects = await state.api.getObjects(roomInfo.id);
      if (objects != null) {
        for (const key of Object.keys(objects)) {
          state.board.upsertObject(objects[key]);
        }
      }
    } else {
      const disableEditing = () => {
        unlistenBoard();
        unlistenInput();
        unlistenWindow();
        unlistenKeyboard();
        unlistenShortcutButtons();
      };
      const handle = (e: ApplicationEvent) => update(e, state, disableEditing);
      const unlistenBoard = listenToBoard(state, handle);
      const unlistenInput = listenToInputEvents(state, handle);
      const unlistenWindow = listenToWindowEvents(state, handle);
      const unlistenKeyboard = listenToKeyboardEvents(state, handle);
      const unlistenShortcutButtons = listenToShortcutButtons(state, handle);
      connect(pageInfo, state, handle);
    }
  } else {
    // show error
    if (debugging()) {
      document.getElementById("board")!.remove();
      await appendCreateRoomButton(document.body);
    }
  }
}
