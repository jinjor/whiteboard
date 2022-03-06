import {
  AddEventBody,
  DeleteEventBody,
  ObjectId,
  PatchEventBody,
  Position,
  ResponseEvent,
  UserId,
} from "../schema";
import {
  Board,
  getD,
  getPosition,
  Help,
  Input,
  makeD,
  parseD,
  PixelPosition,
  Selector,
  setD,
  setPosition,
  Shortcuts,
} from "./lib/board";
import * as api from "./lib/api";
import { addMember, deleteMember, updateStatus } from "./lib/navbar";
import { deepEqual } from "../deep-equal";
import { appendCreateRoomButton, debugging } from "./lib/debug";

type Size = { width: number; height: number };
class Rectangle {
  constructor(
    public x: number,
    public y: number,
    public width: number,
    public height: number
  ) {}
  get right() {
    return this.x + this.width;
  }
  get bottom() {
    return this.y + this.height;
  }
}
type ActionEvent = AddEventBody | PatchEventBody | DeleteEventBody;
type Action = {
  events: ActionEvent[];
};
type ObjectForSelect =
  | {
      kind: "text";
      id: ObjectId;
      bbox: Rectangle;
      position: Position;
    }
  | {
      kind: "path";
      id: ObjectId;
      bbox: Rectangle;
      points: Position[];
    };

type EditingState =
  | { kind: "none" }
  | { kind: "select"; start: Position; objects: ObjectForSelect[] }
  | { kind: "move"; start: Position }
  | { kind: "path"; points: Position[]; id: ObjectId }
  | { kind: "text"; position: Position };
type State = {
  self: UserId | null;
  board: Board;
  shortcuts: Shortcuts;
  input: Input;
  selector: Selector;
  boardRect: { position: PixelPosition; size: Size };
  websocket: WebSocket | null;
  undos: Action[];
  redos: Action[];
  editing: EditingState;
  selected: ObjectForSelect[];
};

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

function connect(pageInfo: PageInfo, state: State, disableEditing: () => void) {
  const ws = api.createWebsocket(pageInfo.wsRoot, pageInfo.roomId);
  ws.addEventListener("open", () => {
    state.websocket = ws;
    updateStatus("active", "Connected");
  });
  ws.addEventListener("message", (event) => {
    const data: ResponseEvent = JSON.parse(event.data);
    console.log(data);
    switch (data.kind) {
      case "init": {
        state.self = data.self;
        for (const member of data.members) {
          addMember(member, member.id === state.self);
        }
        for (const key of Object.keys(data.objects)) {
          state.board.upsertObject(data.objects[key]);
        }
        break;
      }
      case "join": {
        const member = data.user;
        addMember(member, member.id === state.self);
        break;
      }
      case "quit": {
        const member = data.id;
        deleteMember(member);
        break;
      }
      case "upsert": {
        state.board.upsertObject(data.object);
        break;
      }
      case "delete": {
        state.board.deleteObject(data.id);
        break;
      }
    }
  });
  ws.addEventListener("close", (event) => {
    console.log("WebSocket closed: " + event.code + " " + event.reason);
    state.websocket = null;
    disableEditing();
    updateStatus("inactive", "Disconnected");
    // TODO: reconnect
  });
  ws.addEventListener("error", (event) => {
    console.log("WebSocket error:", event);
    state.websocket = null;
    disableEditing();
    updateStatus("error", "Error");
    // TODO: reconnect
  });
}
function generateObjectId(): ObjectId {
  return String(Date.now()).padStart(36, "0");
  // https://caniuse.com/mdn-api_crypto_randomuuid
  // return crypto.randomUUID();
}
function startDrawing(state: State, pos: Position): void {
  const id = generateObjectId();
  const points = [pos];
  state.editing = { kind: "path", points, id };
}
function continueDrawing(state: State, pos: Position): void {
  if (state.editing.kind === "path") {
    const id = state.editing.id;
    let element = document.getElementById(
      id
    ) as unknown as SVGPathElement | null;
    state.editing.points.push(pos);
    const d = makeD(state.editing.points);
    if (element == null) {
      const object = { id, kind: "path", d } as const;
      state.board.upsertPath(object);
    } else {
      setD(element, d);
    }
  }
}
function stopDrawing(state: State, pos: Position): void {
  if (state.editing.kind === "path") {
    const points = state.editing.points;
    state.editing.points = [];
    if (points.length >= 2) {
      if (state.websocket != null) {
        const object = {
          id: state.editing.id,
          kind: "path",
          d: makeD(points),
        } as const;
        const event = api.makeAddObjectEvent(object);
        doAction(state, {
          events: [event],
        });
      }
    }
  }
  state.editing = { kind: "none" };
}

function getAllObjectElements(): SVGElement[] {
  return document.getElementsByClassName("object") as unknown as SVGElement[];
}
function getAllObjectsForSelect(): ObjectForSelect[] {
  const elements = getAllObjectElements();
  const objects: ObjectForSelect[] = [];
  for (const element of elements) {
    const { x, y, width, height } = (element as any).getBBox();
    const bbox = new Rectangle(x, y, width, height);
    switch (element.tagName) {
      case "text": {
        const position = getPosition(element);
        objects.push({
          kind: "text",
          id: element.id,
          position,
          bbox,
        });
        break;
      }
      case "path": {
        const d = getD(element);
        const points = parseD(d);
        objects.push({
          kind: "path",
          id: element.id,
          bbox,
          points,
        });
        break;
      }
    }
  }
  return objects;
}
function startSelecting(state: State, pos: Position): void {
  const objects = getAllObjectsForSelect();
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
    orect.x > rect.x &&
    orect.right < rect.right &&
    orect.y > rect.y &&
    orect.bottom < rect.bottom;
  if (fullyContained) {
    return true;
  }
  for (const point of getPointsInObject(object)) {
    const contained =
      point.x > rect.x &&
      point.x < rect.right &&
      point.y > rect.y &&
      point.y < rect.bottom;
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
  state.editing = { kind: "move", start: pos };
}
function continueMoving(state: State, pos: Position): void {
  if (state.editing.kind === "move") {
    const dx = pos.x - state.editing.start.x;
    const dy = pos.y - state.editing.start.y;
    for (const object of state.selected) {
      const element = document.getElementById(object.id)!;
      switch (object.kind) {
        case "text": {
          const x = object.position.x + dx;
          const y = object.position.y + dy;
          setPosition(element, { x, y });
          break;
        }
        case "path": {
          const points = object.points.map((p) => ({
            x: p.x + dx,
            y: p.y + dy,
          }));
          const d = makeD(points);
          setD(element, d);
          break;
        }
      }
    }
  }
}
function stopMoving(state: State, pos: Position): void {
  if (state.editing.kind === "move") {
    if (state.websocket != null) {
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
            const event = api.makePatchObjectEventFromText(
              object.id,
              "position",
              {
                old: oldPosision,
                new: newPosision,
              }
            );
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
            const event = api.makePatchObjectEventFromPath(object.id, "d", {
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
  updateInputElementPosition(state);
  state.input.showAndFocus();
}
function stopEditingText(state: State): void {
  if (state.editing.kind === "text") {
    const text = state.input.getText();
    if (text.length > 0) {
      if (state.websocket != null) {
        const position = state.editing.position;
        const object = {
          id: generateObjectId(),
          kind: "text",
          text,
          position: { x: position.x, y: position.y },
        } as const;
        const event = api.makeAddObjectEvent(object);
        doAction(state, { events: [event] });
      }
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
      const event = api.makeDeleteObjectEvent(object);
      events.push(event);
    }
    doAction(state, { events });
  }
  state.selected = [];
}
function selectAll(state: State): void {
  const objects = getAllObjectsForSelect();
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
  api.send(state.websocket!, event);
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
      return;
    }
  }
  for (const event of action.events) {
    doEventWithoutCheck(state, event);
  }
  state.undos.push(action);
}
function listenToKeyboardEvents(state: State): () => void {
  window.onkeydown = (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;
    if (e.key === "Backspace") {
      return deleteSelectedObjects(state);
    }
    if (ctrl && e.key === "a") {
      e.preventDefault();
      return selectAll(state);
    }
    if ((ctrl && e.key === "y") || (ctrl && shift && e.key === "z")) {
      e.preventDefault();
      return redo(state);
    }
    if (ctrl && e.key === "z") {
      e.preventDefault();
      return undo(state);
    }
  };
  return () => {
    window.onkeydown = null;
  };
}
function listenToShortcutButtons(state: State): () => void {
  const undoButton = document.getElementById("undo")!;
  const redoButton = document.getElementById("redo")!;
  const selectButton = document.getElementById("select")!;
  const deleteButton = document.getElementById("delete")!;
  undoButton.onclick = () => {
    undo(state);
    syncCursorAndButtons(state);
  };
  redoButton.onclick = () => {
    redo(state);
    syncCursorAndButtons(state);
  };
  selectButton.onclick = () => {
    selectButton.classList.add("select");
  };
  deleteButton.onclick = () => {
    deleteSelectedObjects(state);
    syncCursorAndButtons(state);
  };
  return () => {
    undoButton.onclick = null;
    redoButton.onclick = null;
    selectButton.onclick = null;
    deleteButton.onclick = null;
  };
}
function updateInputElementPosition(state: State): void {
  if (state.editing.kind === "text") {
    const ppos = state.board.toPixelPosition(
      state.boardRect.size,
      state.editing.position
    );
    state.input.setPosition(ppos);
  }
}
function listenToWindowEvents(state: State): () => void {
  window.onresize = () => {
    state.boardRect = state.board.calculateBoardRect();
    updateInputElementPosition(state);
  };
  return () => {
    window.onresize = null;
  };
}
function listenToInputEvents(state: State): () => void {
  state.input.listen({
    enter: () => {
      stopEditingText(state);
    },
  });
  return () => state.input.unlisten();
}
function listenToBoard(state: State): () => void {
  return state.board.listenToBoardEvents({
    getBoardRect: () => {
      return state.boardRect;
    },
    doubleClick: (npos) => {
      createText(state, npos);
    },
    mouseDown: (npos, isRight) => {
      if (isRight) {
        startSelecting(state, npos);
      } else {
        if (state.selected.length > 0) {
          startMoving(state, npos);
        } else {
          switch (state.editing.kind) {
            case "text": {
              stopEditingText(state);
              break;
            }
            default: {
              startDrawing(state, npos);
              break;
            }
          }
        }
      }
      syncCursorAndButtons(state);
    },
    touchStart: (npos) => {
      if (document.getElementById("select")!.classList.contains("select")) {
        startSelecting(state, npos);
        return;
      }
      if (state.selected.length > 0) {
        return startMoving(state, npos);
      }
      switch (state.editing.kind) {
        case "text": {
          return stopEditingText(state);
        }
      }
      return startDrawing(state, npos);
    },
    touchStartLong: (npos) => {
      if (document.getElementById("select")!.classList.contains("select")) {
        return;
      }
      if (state.editing.kind === "select") {
        return;
      }
      if (state.selected.length > 0) {
        return;
      }
      createText(state, npos);
    },
    mouseMove: (npos) => {
      switch (state.editing.kind) {
        case "move": {
          continueMoving(state, npos);
          break;
        }
        case "path": {
          continueDrawing(state, npos);
          break;
        }
        case "select": {
          continueSelecting(state, npos);
          break;
        }
      }
      syncCursorAndButtons(state);
    },
    touchMove: (npos) => {
      switch (state.editing.kind) {
        case "move": {
          return continueMoving(state, npos);
        }
        case "path": {
          return continueDrawing(state, npos);
        }
        case "select": {
          return continueSelecting(state, npos);
        }
      }
      syncCursorAndButtons(state);
    },
    mouseUp: (npos) => {
      switch (state.editing.kind) {
        case "move": {
          stopMoving(state, npos);
          break;
        }
        case "path": {
          stopDrawing(state, npos);
          break;
        }
        case "select": {
          stopSelecting(state, npos);
          break;
        }
      }
      syncCursorAndButtons(state);
    },
    touchEnd: (npos) => {
      switch (state.editing.kind) {
        case "move": {
          stopMoving(state, npos);
          break;
        }
        case "path": {
          stopDrawing(state, npos);
          break;
        }
        case "select": {
          stopSelecting(state, npos);
          break;
        }
      }
      syncCursorAndButtons(state);
    },
  });
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

(async () => {
  const pageInfo = getPageInfo();
  const roomInfo = await api.getRoomInfo(pageInfo.roomId);
  if (roomInfo != null) {
    const boardOptions = {
      viewBox: new Rectangle(0, 0, 16, 9),
      textFontSize: 0.3,
      pathStrokeWidth: 0.02,
      selectorStrokeWidth: 0.01,
    };
    new Help();
    const board = new Board(boardOptions);
    const state: State = {
      self: null,
      board,
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
      const objects = await api.getObjects(roomInfo.id);
      if (objects != null) {
        for (const key of Object.keys(objects)) {
          state.board.upsertObject(objects[key]);
        }
      }
    } else {
      const unlistenBoard = listenToBoard(state);
      const unlistenInput = listenToInputEvents(state);
      const unlistenWindow = listenToWindowEvents(state);
      const unlistenKeyboard = listenToKeyboardEvents(state);
      const unlistenShortcutButtons = listenToShortcutButtons(state);
      connect(pageInfo, state, () => {
        unlistenBoard();
        unlistenInput();
        unlistenWindow();
        unlistenKeyboard();
        unlistenShortcutButtons();
      });
    }
  } else {
    // show error
    if (debugging) {
      document.getElementById("board")!.remove();
      await appendCreateRoomButton(document.body);
    }
  }
})();
