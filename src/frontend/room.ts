import { ObjectId, PatchEventBody, Position, ResponseEvent } from "../schema";
import {
  BoardOptions,
  deleteObject,
  elementToObject,
  getD,
  getPosition,
  Input,
  listenToBoardEvents,
  makeD,
  parseD,
  PixelPosition,
  Selector,
  setD,
  setPosition,
  setRectangle,
  setSelected,
  toPixelPosition,
  upsertObject,
  upsertPath,
  upsertText,
} from "./board";
import * as api from "./api";

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
type Patch = PatchEventBody;
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
  boardOptions: BoardOptions;
  svgEl: HTMLElement;
  input: Input;
  selector: Selector;
  boardRect: { position: PixelPosition; size: Size };
  websocket: WebSocket | null;
  undos: Patch[];
  redos: Patch[];
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
async function isRoomPresent(roomId: string): Promise<boolean> {
  const res = await fetch("/api/rooms/" + roomId);
  const roomExists = res.status === 200;
  if (!roomExists) {
    const errorMessage = await res.text();
    console.log(errorMessage);
  }
  return res.status === 200;
}

function connect(pageInfo: PageInfo, state: State, disableEditing: () => void) {
  const ws = new WebSocket(
    `${pageInfo.wsRoot}/api/rooms/${pageInfo.roomId}/websocket`
  );
  ws.addEventListener("open", () => {
    state.websocket = ws;
  });
  ws.addEventListener("message", (event) => {
    const data: ResponseEvent = JSON.parse(event.data);
    console.log(data);
    switch (data.kind) {
      case "init": {
        for (const key of Object.keys(data.objects)) {
          upsertObject(state.svgEl, data.objects[key], state.boardOptions);
        }
        break;
      }
      case "upsert": {
        upsertObject(state.svgEl, data.object, state.boardOptions);
        break;
      }
      case "delete": {
        deleteObject(state.svgEl, data.id);
        break;
      }
    }
  });
  ws.addEventListener("close", (event) => {
    console.log("WebSocket closed: " + event.code + " " + event.reason);
    state.websocket = null;
    disableEditing();
    // TODO: reconnect
  });
  ws.addEventListener("error", (event) => {
    console.log("WebSocket error:", event);
    state.websocket = null;
    disableEditing();
    // TODO: reconnect
  });
}
function generateObjectId(): ObjectId {
  return String(Date.now()).padStart(32, "0");
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
      upsertPath(state.svgEl, object, state.boardOptions.pathStrokeWidth);
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
        upsertPath(state.svgEl, object, state.boardOptions.pathStrokeWidth);
        api.addObject(state.websocket, object);
      }
    }
  }
  state.editing = { kind: "none" };
}

function startSelecting(state: State, pos: Position): void {
  const elements = document.getElementsByClassName(
    "object"
  ) as unknown as SVGElement[];
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
  state.editing = { kind: "select", start: pos, objects };
  state.selector.setRectangle(pos.x, pos.y, 0, 0);
  state.selector.show();
}
function isObjectSelected(object: ObjectForSelect, rect: Rectangle): boolean {
  const orect = object.bbox;
  const fullyContained =
    orect.x > rect.x &&
    orect.right < rect.right &&
    orect.y > rect.y &&
    orect.bottom < rect.bottom;
  if (fullyContained) {
    return true;
  }
  const fullySeparated =
    orect.x > rect.right ||
    orect.right < rect.x ||
    orect.y > rect.bottom ||
    orect.bottom < rect.y;
  if (fullySeparated) {
    return false;
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

function continueSelecting(state: State, pos: Position): void {
  state.selected = [];
  if (state.editing.kind === "select") {
    const start = state.editing.start;
    const x = Math.min(pos.x, start.x);
    const y = Math.min(pos.y, start.y);
    const width = Math.abs(pos.x - start.x);
    const height = Math.abs(pos.y - start.y);
    state.selector.setRectangle(x, y, width, height);
    const rect = new Rectangle(x, y, width, height);
    for (const object of state.editing.objects) {
      const selected = isObjectSelected(object, rect);
      if (selected) {
        state.selected.push(object);
      }
      const element = document.getElementById(object.id)!;
      setSelected(element, selected);
    }
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
      for (const object of state.selected) {
        // TODO: 選択中に他の人が動かしたり消したりしたらどうするか
        switch (object.kind) {
          case "text": {
            const x = object.position.x + dx;
            const y = object.position.y + dy;
            const oldPosision = object.position;
            const newPosision = { x, y };
            patchTextPosision(object.id, newPosision);
            api.patchText(state.websocket, object.id, "position", {
              old: oldPosision,
              new: newPosision,
            });
            break;
          }
          case "path": {
            const oldD = makeD(object.points);
            const points = object.points.map((p) => ({
              x: p.x + dx,
              y: p.y + dy,
            }));
            const d = makeD(points);
            const event: PatchEventBody = {
              kind: "patch",
              id: object.id,
              key: "d",
              value: {
                old: oldD,
                new: d,
              },
            };
            patchPathD(object.id, d);
            api.patchPath(state.websocket, object.id, "d", {
              old: oldD,
              new: d,
            });
            break;
          }
        }
      }
    }
  }
  for (const object of state.selected) {
    const element = document.getElementById(object.id)!;
    setSelected(element, false);
  }
  state.selected = [];
  state.editing = { kind: "none" };
}
function patchTextPosision(id: ObjectId, position: Position): void {
  const element = document.getElementById(id)!;
  setPosition(element, position);
}
function patchPathD(id: ObjectId, d: string): void {
  const element = document.getElementById(id)!;
  setD(element, d);
}

function createText(state: State, pos: Position): void {
  state.editing = { kind: "text", position: pos };
  updateInputElementPosition(state);
  state.input.showAndFocus();
}
function startEditingText(state: State): void {}
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
        upsertText(state.svgEl, object, state.boardOptions.textFontSize);
        api.addObject(state.websocket, object);
      }
    }
  }
  state.editing = { kind: "none" };
  state.input.hideAndReset();
}

function deleteSelectedObjects(state: State) {
  if (state.websocket != null) {
    for (const { id } of state.selected) {
      // TODO: 選択中に他の人が動かしたり消したりしたらどうするか
      // 選択開始時点で見ていたものと違うものを消していい？
      const element = document.getElementById(id);
      if (element == null) {
        // 既に他の人が消していた場合
        continue;
      }
      deleteObject(state.svgEl, id);
      const object = elementToObject(element)!;
      api.deleteObject(state.websocket, object);
    }
  }
  state.selected = [];
}

function undo(state: State): void {}
function redo(state: State): void {}
function listenToKeyboardEvents(state: State): () => void {
  window.onkeydown = (e) => {
    if (e.key === "Backspace") {
      deleteSelectedObjects(state);
    }
  };
  return () => {
    window.onkeydown = null;
  };
}
function getBoardRect(svgElement: HTMLElement): {
  size: Size;
  position: PixelPosition;
} {
  const rect = svgElement.getBoundingClientRect();
  return {
    size: { width: rect.width, height: rect.height },
    position: { px: rect.left, py: rect.top },
  };
}
function updateInputElementPosition(state: State): void {
  if (state.editing.kind === "text") {
    const ppos = toPixelPosition(
      state.boardOptions,
      state.boardRect.size,
      state.editing.position
    );
    state.input.setPosition(ppos);
  }
}
function listtenToWindowEvents(state: State): () => void {
  window.onresize = () => {
    state.boardRect = getBoardRect(state.svgEl);
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
  return listenToBoardEvents(state.boardOptions, state.svgEl, {
    getBoardRect: () => {
      return state.boardRect;
    },
    doubleClick: (npos) => {
      createText(state, npos);
    },
    mouseDown: (npos, isRight) => {
      if (isRight) {
        return startSelecting(state, npos);
      } else {
        if (state.selected.length > 0) {
          return startMoving(state, npos);
        }
        return startDrawing(state, npos);
      }
    },
    touchStart: (npos) => {
      if (state.selected.length > 0) {
        return startMoving(state, npos);
      }
      return startDrawing(state, npos);
    },
    mouseMove: (npos) => {
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
    },
    touchMove: (npos) => {
      switch (state.editing.kind) {
        case "move": {
          return stopMoving(state, npos);
        }
        case "path": {
          return stopDrawing(state, npos);
        }
        case "select": {
          return stopSelecting(state, npos);
        }
      }
    },
    mouseUp: (npos) => {
      switch (state.editing.kind) {
        case "move": {
          return stopMoving(state, npos);
        }
        case "path": {
          return stopDrawing(state, npos);
        }
        case "select": {
          return stopSelecting(state, npos);
        }
      }
    },
    touchEnd: (npos) => {
      if (state.selected.length > 0) {
        return stopMoving(state, npos);
      }
      return stopDrawing(state, npos);
    },
  });
}

function initBoard(o: BoardOptions): void {
  const svgEl = document.getElementById("board")!;
  const backgroundEl = document.getElementById("board-background")!;
  const clipRectEl = document.getElementById("board-clip-rect")!;
  const selectorEl = document.getElementById("board-selector")!;
  const viewBox = `${o.viewBox.x} ${o.viewBox.y} ${o.viewBox.width} ${o.viewBox.height}`;
  svgEl.setAttributeNS(null, "viewBox", viewBox);
  setRectangle(backgroundEl, o.viewBox);
  setRectangle(clipRectEl, o.viewBox);
  selectorEl.setAttributeNS(
    null,
    "stroke-width",
    String(o.selectorStrokeWidth)
  );
}

(async () => {
  const pageInfo = getPageInfo();
  const roomExists = await isRoomPresent(pageInfo.roomId);
  if (roomExists) {
    const boardOptions = {
      viewBox: new Rectangle(0, 0, 1, 1),
      textFontSize: 0.02,
      pathStrokeWidth: 0.002,
      selectorStrokeWidth: 0.001,
    };
    initBoard(boardOptions);
    const svgEl = document.getElementById("board")!;
    const selectorEl = document.getElementById("board-selector")!;
    const inputEl = document.getElementById("input")! as HTMLInputElement;
    const state: State = {
      boardOptions,
      svgEl,
      input: new Input(inputEl),
      selector: new Selector(selectorEl),
      boardRect: getBoardRect(svgEl),
      websocket: null,
      undos: [],
      redos: [],
      editing: { kind: "none" },
      selected: [],
    };
    const unlistenBoard = listenToBoard(state);
    const unlistenInput = listenToInputEvents(state);
    const unlistenWindow = listtenToWindowEvents(state);
    const unlistenKeyboard = listenToKeyboardEvents(state);
    connect(pageInfo, state, () => {
      unlistenBoard();
      unlistenInput();
      unlistenWindow();
      unlistenKeyboard();
    });
  } else {
    // show error
    if (location.protocol === "http:") {
      const button = document.createElement("button");
      button.textContent = "Create Room for Debug";
      button.onclick = async () => {
        const res = await fetch("/api/rooms/", {
          method: "POST",
        });
        if (res.status !== 200) {
          const errorMessage = await res.text();
          console.log(errorMessage);
          return;
        }
        const roomName_ = await res.text();
        location.href = "/rooms/" + roomName_;
      };
      document.getElementById("board")!.remove();
      document.body.append(button);
    }
  }
})();
