import { ObjectId, PatchEventBody, Position, ResponseEvent } from "../schema";

type PixelPosition = Position & { pos: "p" };
type NormalizedPosition = Position & { pos: "n" };

type Size = { width: number; height: number };
type Patch = PatchEventBody;
type Drag =
  | { kind: "select"; start: NormalizedPosition }
  | { kind: "draw"; path: NormalizedPosition[] }
  | { kind: "move"; start: NormalizedPosition };
type State = {
  svgEl: HTMLElement;
  inputEl: HTMLInputElement;
  boardSize: Size;
  websocket: WebSocket | null;
  undos: Patch[];
  redos: Patch[];
  drag: Drag | null;
  selected: ObjectId[];
};

type PageInfo = {
  roomId: string;
  wsRoot: string;
};

function getPageInfo(): PageInfo {
  const hostName = window.location.host;
  const splitted = window.location.pathname.split("/");
  const roomName = splitted[2];
  const wsProtocol = hostName.startsWith("localhost") ? "ws" : "wss";
  return {
    roomId: roomName,
    wsRoot: `${wsProtocol}://${hostName}`,
  };
}
async function isRoomPresent(roomId: string): Promise<boolean> {
  const res = await fetch("/api/rooms/" + roomId);
  const roomExists = res.status === 200;
  if (!roomExists) {
    const errMessage = await res.text();
    console.log(errMessage);
  }
  return res.status === 200;
}

function connect(pageInfo: PageInfo, state: State) {
  const ws = new WebSocket(
    `${pageInfo.wsRoot}/api/rooms/${pageInfo.roomId}/websocket`
  );
  ws.addEventListener("open", () => {
    state.websocket = ws;
  });
  ws.addEventListener("message", (event) => {
    const data: ResponseEvent = JSON.parse(event.data);
    console.log(data);
  });
  ws.addEventListener("close", (event) => {
    console.log("WebSocket closed: " + event.code + " " + event.reason);
    state.websocket = null;
    // TODO: reconnect
  });
  ws.addEventListener("error", (event) => {
    console.log("WebSocket error:", event);
    // TODO: reconnect
  });
}

function generateObjectId(): string {
  return String(Date.now()).padStart(32, "0");
}
function startDrawing(state: State, pos: NormalizedPosition): void {
  state.drag = { kind: "draw", path: [pos] };
}
function continueDrawing(state: State, pos: NormalizedPosition): void {}
function stopDrawing(state: State, pos: NormalizedPosition): void {}

function startSelecting(state: State, pos: NormalizedPosition): void {
  state.drag = { kind: "select", start: pos };
}
function continueSelecting(state: State, pos: NormalizedPosition): void {}
function stopSelecting(state: State, pos: NormalizedPosition): void {}

function startMoving(state: State, pos: NormalizedPosition): void {
  state.drag = { kind: "select", start: pos };
}
function continueMoving(state: State, pos: NormalizedPosition): void {}
function stopMoving(state: State, pos: NormalizedPosition): void {}

function createText(state: State, pos: NormalizedPosition): void {}
function startEditingText(state: State): void {}
function stopEditingText(state: State, text: string): void {
  if (text.length > 0) {
    if (state.websocket != null) {
      state.websocket.send(
        JSON.stringify({
          kind: "add",
          object: {
            id: generateObjectId(),
            kind: "text",
            text: "foo",
            position: { x: 0, y: 0 },
          },
        })
      );
    }
  }
}

function undo(state: State): void {}
function redo(state: State): void {}
function listenToKeyboardEvents(
  state: State,
  element: HTMLElement
): () => void {
  return () => {};
}
function getBoardSize(svgElement: HTMLElement): Size {
  const rect = svgElement.getBoundingClientRect();
  return { width: rect.width, height: rect.height };
}
function getPixelPosition(e: MouseEvent): PixelPosition {
  return {
    pos: "p",
    x: e.offsetX,
    y: e.offsetY,
  };
}
function toNormalizedPosition(
  state: State,
  ppos: PixelPosition
): NormalizedPosition {
  return {
    pos: "n",
    x: ppos.x / state.boardSize.width,
    y: ppos.y / state.boardSize.height,
  };
}
function listtenToWindowEvents(state: State): () => void {
  window.onresize = () => {
    state.boardSize = getBoardSize(state.svgEl);
  };
  return () => {
    window.onresize = null;
  };
}
function listenToInputEvents(state: State): () => void {
  state.inputEl.onkeydown = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      const text = state.inputEl.value;
      stopEditingText(state, text);
      state.inputEl.value = "";
      state.inputEl.classList.add("hidden");
    }
  };
  return () => {
    state.inputEl.oninput = null;
    state.inputEl.onkeydown = null;
  };
}
function listenToBoardEvents(state: State): () => void {
  state.svgEl.ondblclick = (e: MouseEvent) => {
    const pos = getPixelPosition(e);
    const npos = toNormalizedPosition(state, pos);
    createText(state, npos);
    state.inputEl.classList.remove("hidden");
    state.inputEl.focus();
  };
  state.svgEl.onmousedown = (e: MouseEvent) => {
    const pos = getPixelPosition(e);
    const npos = toNormalizedPosition(state, pos);
    if (e.button === 0) {
      if (state.selected.length > 0) {
        return startMoving(state, npos);
      }
      return startDrawing(state, npos);
    } else {
      return startSelecting(state, npos);
    }
  };
  state.svgEl.onmouseup = (e: MouseEvent) => {
    const pos = getPixelPosition(e);
    const npos = toNormalizedPosition(state, pos);
    if (e.button === 0) {
      if (state.selected.length > 0) {
        return stopMoving(state, npos);
      }
      return stopDrawing(state, npos);
    } else {
      return stopMoving(state, npos);
    }
  };
  return () => {
    state.svgEl.ondblclick = null;
    state.svgEl.onmousedown = null;
    state.svgEl.onmouseup = null;
  };
}

(async () => {
  const pageInfo = getPageInfo();
  const roomExists = await isRoomPresent(pageInfo.roomId);
  if (roomExists) {
    const svgElement = document.getElementById("board")!;
    const inputElement = document.getElementById("input")! as HTMLInputElement;
    const state: State = {
      svgEl: svgElement,
      inputEl: inputElement,
      boardSize: getBoardSize(svgElement),
      websocket: null,
      undos: [],
      redos: [],
      drag: null,
      selected: [],
    };
    listenToBoardEvents(state);
    listenToInputEvents(state);
    listtenToWindowEvents(state);
    connect(pageInfo, state);
  } else {
    // show error
  }
})();
