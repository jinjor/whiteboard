import {
  AddEventBody,
  CloseReason,
  DeleteEventBody,
  ObjectId,
  PatchEventBody,
  Position,
  ResponseEvent,
  UserId,
} from "../schema";
import {
  Board,
  Help,
  Input,
  NavBar,
  ObjectForSelect,
  PixelPosition,
  Rectangle,
  SelectedObject,
  Selector,
  Shortcuts,
} from "./lib/board";
import {
  API,
  makeAddObjectEvent,
  makeDeleteObjectEvent,
  makePatchObjectEventFromPath,
  makePatchObjectEventFromText,
} from "./lib/api";
import { deepEqual } from "../deep-equal";
import { appendCreateRoomButton, debugging, testing } from "./lib/debug";
import { v4 as uuidv4 } from "uuid";

type Size = { width: number; height: number };
type ActionEvent = AddEventBody | PatchEventBody | DeleteEventBody;
type Action = {
  events: ActionEvent[];
};

type EditingState =
  | { kind: "none" }
  | { kind: "select"; start: Position; objects: ObjectForSelect[] }
  | { kind: "move"; start: Position }
  | { kind: "path"; points: Position[]; id: ObjectId }
  | { kind: "text"; position: Position };

export type State = {
  api: API;
  self: UserId | null;
  board: Board;
  navBar: NavBar;
  help: Help;
  shortcuts: Shortcuts;
  input: Input;
  selector: Selector;
  boardRect: { position: PixelPosition; size: Size };
  websocket: WebSocket | null;
  undos: Action[];
  redos: Action[];
  editing: EditingState;
  selected: SelectedObject[];
  unlisten: (() => void) | null;
};

export type ApplicationEvent =
  | { kind: "room:init" }
  | { kind: "room:disable_editing" }
  | { kind: "key:delete" }
  | { kind: "key:select_all" }
  | { kind: "key:undo" }
  | { kind: "key:redo" }
  | { kind: "shortcut_button:delete" }
  | { kind: "shortcut_button:select" }
  | { kind: "shortcut_button:undo" }
  | { kind: "shortcut_button:redo" }
  | { kind: "window:resize" }
  | { kind: "input:enter" }
  | { kind: "board:double_click"; position: Position }
  | { kind: "board:mouse_down"; position: Position; isRight: boolean }
  | { kind: "board:touch_start"; position: Position }
  | { kind: "board:touch_start_long"; position: Position }
  | { kind: "board:mouse_move"; position: Position }
  | { kind: "board:touch_move"; position: Position }
  | { kind: "board:mouse_up"; position: Position }
  | { kind: "board:touch_end"; position: Position }
  | { kind: "ws:open"; websocket: WebSocket }
  | { kind: "ws:close"; code: number; reason: string }
  | { kind: "ws:error" }
  | { kind: "ws:message"; data: ResponseEvent };

export async function update(
  e: ApplicationEvent,
  state: State,
  effect: (e: ApplicationEvent) => void
): Promise<void> {
  switch (e.kind) {
    case "room:init": {
      const pageInfo = getPageInfo();
      const roomInfo = await state.api.getRoomInfo(pageInfo.roomId);
      if (roomInfo != null) {
        if (!roomInfo.active) {
          state.navBar.updateStatus("inactive", "Inactive");
          const objects = await state.api.getObjects(roomInfo.id);
          if (objects != null) {
            for (const key of Object.keys(objects)) {
              state.board.upsertObject(objects[key]);
            }
          }
        } else {
          const unlistenBoard = listenToBoard(state, effect);
          const unlistenInput = listenToInputEvents(state, effect);
          const unlistenWindow = listenToWindowEvents(state, effect);
          const unlistenKeyboard = listenToKeyboardEvents(state, effect);
          const unlistenShortcutButtons = listenToShortcutButtons(
            state,
            effect
          );
          connect(pageInfo, state, effect);
          state.unlisten = () => {
            unlistenBoard();
            unlistenInput();
            unlistenWindow();
            unlistenKeyboard();
            unlistenShortcutButtons();
          };
        }
      } else {
        // show error
        if (debugging()) {
          document.getElementById("board")!.remove();
          await appendCreateRoomButton(document.body);
        }
      }
      return;
    }
    case "room:disable_editing": {
      if (state.unlisten != null) {
        state.unlisten();
        state.unlisten = null;
      }
      return;
    }
    case "key:delete": {
      deleteSelectedObjects(state);
      syncCursorAndButtons(state);
      return;
    }
    case "key:select_all": {
      selectAll(state);
      syncCursorAndButtons(state);
      return;
    }
    case "key:redo": {
      redo(state);
      syncCursorAndButtons(state);
      return;
    }
    case "key:undo": {
      undo(state);
      syncCursorAndButtons(state);
      return;
    }
    case "shortcut_button:delete": {
      deleteSelectedObjects(state);
      syncCursorAndButtons(state);
      return;
    }
    case "shortcut_button:select": {
      if (state.editing.kind === "text") {
        stopEditingText(state);
      }
      state.shortcuts.setSelectingReady(true);
      return;
    }
    case "shortcut_button:undo": {
      if (state.editing.kind === "text") {
        stopEditingText(state);
      }
      undo(state);
      syncCursorAndButtons(state);
      return;
    }
    case "shortcut_button:redo": {
      if (state.editing.kind === "text") {
        stopEditingText(state);
      }
      redo(state);
      syncCursorAndButtons(state);
      return;
    }
    case "window:resize": {
      state.boardRect = state.board.calculateBoardRect();
      updateInputPosition(state);
      return;
    }
    case "input:enter": {
      stopEditingText(state);
      syncCursorAndButtons(state);
      return;
    }
    case "board:double_click": {
      createText(state, e.position);
      return;
    }
    case "board:mouse_down": {
      if (state.editing.kind === "text") {
        stopEditingText(state);
      }
      if (e.isRight) {
        startSelecting(state, e.position);
      } else {
        if (state.selected.length > 0) {
          startMoving(state, e.position);
        } else {
          startDrawing(state, e.position);
        }
      }
      syncCursorAndButtons(state);
      return;
    }
    case "board:touch_start": {
      if (state.editing.kind === "text") {
        stopEditingText(state);
      }
      if (state.shortcuts.isSelectingReady()) {
        startSelecting(state, e.position);
        return;
      }
      if (state.selected.length > 0) {
        return startMoving(state, e.position);
      }
      return startDrawing(state, e.position);
    }
    case "board:touch_start_long": {
      if (state.shortcuts.isSelectingReady()) {
        return;
      }
      if (state.editing.kind === "select") {
        return;
      }
      if (state.selected.length > 0) {
        return;
      }
      createText(state, e.position);
      return;
    }
    case "board:mouse_move": {
      switch (state.editing.kind) {
        case "move": {
          continueMoving(state, e.position);
          break;
        }
        case "path": {
          continueDrawing(state, e.position);
          break;
        }
        case "select": {
          continueSelecting(state, e.position);
          break;
        }
      }
      syncCursorAndButtons(state);
      return;
    }
    case "board:touch_move": {
      switch (state.editing.kind) {
        case "move": {
          return continueMoving(state, e.position);
        }
        case "path": {
          return continueDrawing(state, e.position);
        }
        case "select": {
          return continueSelecting(state, e.position);
        }
      }
      syncCursorAndButtons(state);
      return;
    }
    case "board:mouse_up": {
      switch (state.editing.kind) {
        case "move": {
          stopMoving(state, e.position);
          break;
        }
        case "path": {
          stopDrawing(state, e.position);
          break;
        }
        case "select": {
          stopSelecting(state, e.position);
          break;
        }
      }
      syncCursorAndButtons(state);
      return;
    }
    case "board:touch_end": {
      switch (state.editing.kind) {
        case "move": {
          stopMoving(state, e.position);
          break;
        }
        case "path": {
          stopDrawing(state, e.position);
          break;
        }
        case "select": {
          stopSelecting(state, e.position);
          break;
        }
      }
      syncCursorAndButtons(state);
      return;
    }
    case "ws:open": {
      state.websocket = e.websocket;
      state.navBar.updateStatus("active", "Connected");
      return;
    }
    case "ws:close": {
      const reason = e.reason as CloseReason;
      console.log("WebSocket closed: " + e.code + " " + reason);
      state.websocket = null;
      rollbackAllTemporaryStates(state);
      effect({ kind: "room:disable_editing" });
      if (reason === "unexpected") {
        state.navBar.updateStatus("error", "Error", formatCloseReason(reason));
      } else {
        state.navBar.updateStatus(
          "error",
          "Disconnected",
          formatCloseReason(reason)
        );
      }
      return;
    }
    case "ws:error": {
      state.websocket = null;
      rollbackAllTemporaryStates(state);
      effect({ kind: "room:disable_editing" });
      state.navBar.updateStatus(
        "error",
        "Error",
        formatCloseReason("unexpected")
      );
      return;
    }
    case "ws:message": {
      const data = e.data;
      switch (data.kind) {
        case "init": {
          state.self = data.self;
          for (const member of data.members) {
            state.navBar.addMember(member, member.id === state.self);
          }
          for (const key of Object.keys(data.objects)) {
            state.board.upsertObject(data.objects[key]);
          }
          break;
        }
        case "join": {
          const member = data.user;
          state.navBar.addMember(member, member.id === state.self);
          break;
        }
        case "quit": {
          const member = data.id;
          state.navBar.deleteMember(member);
          break;
        }
        case "upsert": {
          state.board.upsertObject(data.object);
          if (state.editing.kind === "select") {
            for (const object of state.editing.objects) {
              if (object.id === data.object.id) {
                if (object.kind === "text" && data.object.kind === "text") {
                  object.position = data.object.position;
                } else if (
                  object.kind === "path" &&
                  data.object.kind === "path"
                ) {
                  object.points = parseD(data.object.d);
                }
              }
            }
          }
          for (const object of state.selected) {
            if (object.id === data.object.id) {
              if (object.kind === "text" && data.object.kind === "text") {
                object.position = data.object.position;
              } else if (
                object.kind === "path" &&
                data.object.kind === "path"
              ) {
                object.points = parseD(data.object.d);
              }
            }
          }
          break;
        }
        case "delete": {
          state.board.deleteObject(data.id);
          if (state.editing.kind === "select") {
            for (let i = state.editing.objects.length - 1; i >= 0; i--) {
              const objectForSelect = state.editing.objects[i];
              if (objectForSelect.id === data.id) {
                state.editing.objects.splice(i, 1);
              }
            }
          }
          for (let i = state.selected.length - 1; i >= 0; i--) {
            const objectForSelect = state.selected[i];
            if (objectForSelect.id === data.id) {
              state.selected.splice(i, 1);
            }
          }
          syncCursorAndButtons(state);
          break;
        }
      }
      return;
    }
  }
}

export function createState(api: API): State {
  const boardOptions = {
    viewBox: new Rectangle(0, 0, 16, 9),
    textFontSize: 0.3,
    pathStrokeWidth: 0.02,
    selectorStrokeWidth: 0.01,
  };
  const board = new Board(boardOptions);
  return {
    api,
    self: null,
    board,
    navBar: new NavBar(),
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
    unlisten: null,
  };
}

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

function formatCloseReason(reason: CloseReason): string {
  switch (reason) {
    case "room_got_inactive":
      return "Session closed because this room got inactive.";
    case "no_recent_activity":
      return "Session closed because there are no activity recently.";
    case "rate_limit_exceeded":
      return "Session closed because too many requests are sent.";
    case "duplicated_self":
      return "Session closed because you opened this room on another tab or window.";
    case "invalid_data":
      return "Session closed because invalid data is sent to server.";
    case "unexpected":
      return "Something went wrong.";
  }
}
function generateObjectId(): ObjectId {
  return uuidv4();
  // https://caniuse.com/mdn-api_crypto_randomuuid
  // return crypto.randomUUID();
}
function formatPosition(pos: Position): string {
  return `${pos.x.toFixed(4)},${pos.y.toFixed(4)}`;
}
function makeD(points: Position[]) {
  const [init, ...rest] = points;
  const m = formatPosition(init);
  if (rest.length <= 0) {
    return `M${m}`;
  }
  const l = rest.map(formatPosition).join(" ");
  return `M${m}L${l}`;
}
function parseD(d: string): Position[] {
  return d
    .slice(1) // remove M
    .replace("L", " ")
    .split(" ")
    .map((s) => s.split(","))
    .map(([x, y]) => ({
      x: parseFloat(x),
      y: parseFloat(y),
    }));
}
function startDrawing(state: State, pos: Position): void {
  if (state.websocket == null) {
    return;
  }
  const id = generateObjectId();
  const points = [pos];
  state.editing = { kind: "path", points, id };
}
function continueDrawing(state: State, pos: Position): void {
  if (state.editing.kind === "path") {
    const id = state.editing.id;
    state.editing.points.push(pos);
    const d = makeD(state.editing.points);
    if (state.board.hasObject(id)) {
      state.board.updateD(id, d);
    } else {
      const object = { id, kind: "path", d } as const;
      state.board.upsertPath(object);
    }
  }
}
function stopDrawing(state: State, pos: Position): void {
  if (state.editing.kind === "path") {
    const points = state.editing.points;
    state.editing.points = [];
    const canCommit = points.length >= 2 && state.websocket != null;
    if (canCommit) {
      const object = {
        id: state.editing.id,
        kind: "path",
        d: makeD(points),
      } as const;
      const event = makeAddObjectEvent(object);
      doAction(state, {
        events: [event],
      });
    } else {
      state.board.deleteObject(state.editing.id);
    }
  }
  state.editing = { kind: "none" };
}
function getAllObjectsForSelect(state: State): ObjectForSelect[] {
  return state.board.getAllObjectsWithBoundingBox().map(({ object, bbox }) => {
    switch (object.kind) {
      case "text": {
        return {
          kind: "text",
          id: object.id,
          position: object.position,
          bbox,
        };
      }
      case "path": {
        const points = parseD(object.d);
        return {
          kind: "path",
          id: object.id,
          bbox,
          points,
        };
      }
    }
  });
}
function startSelecting(state: State, pos: Position): void {
  if (state.websocket == null) {
    return;
  }
  const objects = getAllObjectsForSelect(state);
  state.editing = { kind: "select", start: pos, objects };
  const rect = new Rectangle(pos.x, pos.y, 0, 0);
  state.selector.setRectangle(rect);
  state.selector.show();
  selectAllObjects(state, state.editing.objects, rect);
}
function isObjectSelected(object: ObjectForSelect, rect: Rectangle): boolean {
  const orect = object.bbox;
  const fullySeparated =
    orect.x > rect.right ||
    orect.right < rect.x ||
    orect.y > rect.bottom ||
    orect.bottom < rect.y;
  if (fullySeparated) {
    return false;
  }
  if (object.kind === "text") {
    return true;
  }
  const fullyContained =
    orect.x >= rect.x &&
    orect.right <= rect.right &&
    orect.y >= rect.y &&
    orect.bottom <= rect.bottom;
  if (fullyContained) {
    return true;
  }
  for (const point of getPointsInObject(object)) {
    const contained =
      point.x >= rect.x &&
      point.x <= rect.right &&
      point.y >= rect.y &&
      point.y <= rect.bottom;
    if (contained) {
      return true;
    }
  }
  return false;
}
function getPointsInObject(object: ObjectForSelect): Position[] {
  switch (object.kind) {
    case "text": {
      const orect = object.bbox;
      return [
        { x: orect.x, y: orect.y },
        { x: orect.x, y: orect.bottom },
        { x: orect.right, y: orect.y },
        { x: orect.right, y: orect.bottom },
      ];
    }
    case "path": {
      return object.points;
    }
  }
}
function selectAllObjects(
  state: State,
  objects: ObjectForSelect[],
  rect: Rectangle
) {
  for (const object of objects) {
    const selected = isObjectSelected(object, rect);
    if (selected) {
      state.selected.push(object);
    }
    state.board.setObjectSelected(object.id, selected);
  }
}
function continueSelecting(state: State, pos: Position): void {
  state.selected = [];
  if (state.editing.kind === "select") {
    const start = state.editing.start;
    const x = Math.min(pos.x, start.x);
    const y = Math.min(pos.y, start.y);
    const width = Math.abs(pos.x - start.x);
    const height = Math.abs(pos.y - start.y);
    const rect = new Rectangle(x, y, width, height);
    state.selector.setRectangle(rect);
    selectAllObjects(state, state.editing.objects, rect);
  }
}
function stopSelecting(state: State, pos: Position): void {
  state.editing = { kind: "none" };
  state.selector.hide();
}

function startMoving(state: State, pos: Position): void {
  if (state.websocket == null) {
    return;
  }
  state.editing = { kind: "move", start: pos };
}
function continueMoving(state: State, pos: Position): void {
  if (state.editing.kind === "move") {
    const dx = pos.x - state.editing.start.x;
    const dy = pos.y - state.editing.start.y;
    for (const object of state.selected) {
      switch (object.kind) {
        case "text": {
          const x = object.position.x + dx;
          const y = object.position.y + dy;
          state.board.updatePosition(object.id, { x, y });
          break;
        }
        case "path": {
          const points = object.points.map((p) => ({
            x: p.x + dx,
            y: p.y + dy,
          }));
          const d = makeD(points);
          state.board.updateD(object.id, d);
          break;
        }
      }
    }
  }
}
function stopMoving(state: State, pos: Position): void {
  if (state.editing.kind === "move") {
    const canCommit = state.websocket != null;
    if (canCommit) {
      const dx = pos.x - state.editing.start.x;
      const dy = pos.y - state.editing.start.y;
      const events: ActionEvent[] = [];
      for (const object of state.selected) {
        switch (object.kind) {
          case "text": {
            const x = object.position.x + dx;
            const y = object.position.y + dy;
            const oldPosision = object.position;
            const newPosision = { x, y };
            const event = makePatchObjectEventFromText(object.id, "position", {
              old: oldPosision,
              new: newPosision,
            });
            events.push(event);
            break;
          }
          case "path": {
            const oldD = makeD(object.points);
            const points = object.points.map((p) => ({
              x: p.x + dx,
              y: p.y + dy,
            }));
            const d = makeD(points);
            const event = makePatchObjectEventFromPath(object.id, "d", {
              old: oldD,
              new: d,
            });
            events.push(event);
            break;
          }
        }
      }
      doAction(state, { events });
    }
  }
  for (const object of state.selected) {
    state.board.setObjectSelected(object.id, false);
  }
  state.selected = [];
  state.editing = { kind: "none" };
}
function createText(state: State, pos: Position): void {
  state.editing = { kind: "text", position: pos };
  updateInputPosition(state);
  state.input.showAndFocus();
}
function stopEditingText(state: State): void {
  if (state.editing.kind === "text") {
    const text = state.input.getText();
    const canCommit = text.length > 0 && state.websocket != null;
    if (canCommit) {
      const position = state.editing.position;
      const object = {
        id: generateObjectId(),
        kind: "text",
        text,
        position: { x: position.x, y: position.y },
      } as const;
      const event = makeAddObjectEvent(object);
      doAction(state, { events: [event] });
    }
  }
  state.editing = { kind: "none" };
  state.input.hideAndReset();
}

function deleteSelectedObjects(state: State) {
  if (state.websocket != null) {
    const events = [];
    for (const { id } of state.selected) {
      const object = state.board.getObject(id);
      if (object == null) {
        // 既に他の人が消していた場合
        continue;
      }
      const event = makeDeleteObjectEvent(object);
      events.push(event);
    }
    doAction(state, { events });
  }
  state.selected = [];
}
function selectAll(state: State): void {
  const objects = getAllObjectsForSelect(state);
  for (const object of objects) {
    state.selected.push(object);
    state.board.setObjectSelected(object.id, true);
  }
}
function canApplyEvent(state: State, event: ActionEvent): boolean {
  switch (event.kind) {
    case "add": {
      return !state.board.hasObject(event.object.id);
    }
    case "patch": {
      const object = state.board.getObject(event.id);
      if (object == null) {
        return false; // ?
      }
      return deepEqual((object as any)[event.key], event.value.old);
    }
    case "delete": {
      const object = state.board.getObject(event.object.id);
      if (object == null) {
        return false; // ?
      }
      return deepEqual(object, event.object);
    }
  }
}
function doEventWithoutCheck(state: State, event: ActionEvent) {
  switch (event.kind) {
    case "add": {
      state.board.upsertObject(event.object);
      break;
    }
    case "patch": {
      state.board.patchObject(event.id, event.key, event.value.new);
      break;
    }
    case "delete": {
      state.board.deleteObject(event.object.id);
      break;
    }
  }
  state.api.send(state.websocket!, event);
}
function invertEvent(event: ActionEvent): ActionEvent {
  switch (event.kind) {
    case "add": {
      return {
        kind: "delete",
        object: event.object,
      };
    }
    case "patch": {
      return {
        kind: "patch",
        id: event.id,
        key: event.key,
        value: { old: event.value.new, new: event.value.old },
      };
    }
    case "delete": {
      return {
        kind: "add",
        object: event.object,
      };
    }
  }
}
function doAction(state: State, action: Action) {
  if (state.websocket == null) {
    return;
  }
  for (const event of action.events) {
    doEventWithoutCheck(state, event);
  }
  state.undos.push(action);
  state.redos = [];
}
type UndoStrategy = "skip_on_conflict" | "break_on_conflict";
const undoStrategy: UndoStrategy = "skip_on_conflict";
function undo(state: State): void {
  if (state.websocket == null) {
    return;
  }
  const action = state.undos.pop();
  if (action == null) {
    return;
  }
  for (const event of action.events) {
    const invertedEvent = invertEvent(event);
    if (!canApplyEvent(state, invertedEvent)) {
      switch (undoStrategy) {
        case "skip_on_conflict": {
          undo(state);
          break;
        }
        case "break_on_conflict": {
          state.undos.length = 0;
          break;
        }
      }
      return;
    }
  }
  for (const event of action.events) {
    const invertedEvent = invertEvent(event);
    doEventWithoutCheck(state, invertedEvent);
  }
  state.redos.push(action);
}
function redo(state: State): void {
  if (state.websocket == null) {
    return;
  }
  const action = state.redos.pop();
  if (action == null) {
    return;
  }
  for (const event of action.events) {
    if (!canApplyEvent(state, event)) {
      switch (undoStrategy) {
        case "skip_on_conflict": {
          redo(state);
          break;
        }
        case "break_on_conflict": {
          state.redos.length = 0;
          break;
        }
      }
      return;
    }
  }
  for (const event of action.events) {
    doEventWithoutCheck(state, event);
  }
  state.undos.push(action);
}

function updateInputPosition(state: State): void {
  if (state.editing.kind === "text") {
    const ppos = state.board.toPixelPosition(
      state.boardRect.size,
      state.editing.position
    );
    const fontSizePx = state.board.getFontSizeInPixel(state.boardRect.size);
    const width = state.boardRect.size.width - ppos.px;
    state.input.setPosition(ppos, width, fontSizePx);
  }
}

function syncCursorAndButtons(state: State) {
  if (state.editing.kind !== "select" && state.selected.length > 0) {
    state.board.toMovingCursor();
  } else {
    state.board.toDefaultCursor();
  }
  state.shortcuts.setSelectingReady(state.editing.kind === "select");
  state.shortcuts.setSelecting(state.selected.length > 0);
  state.shortcuts.setUndoDisabled(state.undos.length <= 0);
  state.shortcuts.setRedoDisabled(state.redos.length <= 0);
}

function rollbackAllTemporaryStates(state: State) {
  switch (state.editing.kind) {
    case "text": {
      state.input.hideAndReset();
      break;
    }
    case "path": {
      state.board.deleteObject(state.editing.id);
      break;
    }
    case "select": {
      state.selector.hide();
      break;
    }
    case "move": {
      for (const object of state.selected) {
        switch (object.kind) {
          case "text": {
            state.board.updatePosition(object.id, object.position);
            break;
          }
          case "path": {
            state.board.updateD(object.id, makeD(object.points));
            break;
          }
        }
      }
    }
  }
  for (const object of state.selected) {
    state.board.setObjectSelected(object.id, false);
  }
  state.selected = [];
  state.editing = { kind: "none" };
  syncCursorAndButtons(state);
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
    if (!testing()) {
      console.log("WebSocket error:", event);
    }
    handle({ kind: "ws:error" });
  });
}
