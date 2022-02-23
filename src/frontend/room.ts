import {
  ObjectId,
  PatchEventBody,
  PathBody,
  Position,
  ResponseEvent,
  TextBody,
} from "../schema";

type PixelPosition = Position & { pos: "p" };
type NormalizedPosition = Position & { pos: "n" };

type Size = { width: number; height: number };
type Patch = PatchEventBody;
type EditingState =
  | { kind: "none" }
  | { kind: "select"; start: NormalizedPosition }
  | { kind: "move"; start: NormalizedPosition }
  | { kind: "path"; path: NormalizedPosition[] }
  | { kind: "text"; position: NormalizedPosition };
type State = {
  svgEl: HTMLElement;
  inputEl: HTMLInputElement;
  selectorEl: HTMLElement;
  boardSize: Size;
  websocket: WebSocket | null;
  undos: Patch[];
  redos: Patch[];
  editing: EditingState;
  selected: ObjectId[];
};

type PageInfo = {
  roomId: string;
  wsRoot: string;
};

function getPageInfo(): PageInfo {
  const { host, hostname, pathname } = window.location;
  const splitted = pathname.split("/");
  const roomName = splitted[2];
  const wsProtocol = hostname === "localhost" ? "ws" : "wss";
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
          const object = data.objects[key];
          switch (object.kind) {
            case "text": {
              upsertText(state, object);
              break;
            }
            case "path": {
              upsertPath(state, object);
              break;
            }
          }
        }
        break;
      }
      case "upsert": {
        const object = data.object;
        switch (object.kind) {
          case "text": {
            upsertText(state, object);
            break;
          }
          case "path": {
            upsertPath(state, object);
            break;
          }
        }
        break;
      }
      case "delete": {
        deleteObject(state, data.id);
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

function upsertText(state: State, text: TextBody) {
  let element = document.getElementById(text.id) as unknown as SVGTextElement;
  if (element == null) {
    element = document.createElementNS("http://www.w3.org/2000/svg", "text");
    element.id = text.id;
    element.setAttributeNS(null, "font-size", String(0.04));
  }
  element.textContent = text.text;
  element.setAttributeNS(null, "x", String(text.position.x));
  element.setAttributeNS(null, "y", String(text.position.y));
  state.svgEl.append(element);
}
function upsertPath(state: State, path: PathBody) {
  let element = document.getElementById(path.id) as unknown as SVGPathElement;
  if (element == null) {
    element = document.createElementNS("http://www.w3.org/2000/svg", "path");
    element.id = path.id;
    element.setAttributeNS(null, "stroke", "black");
    element.setAttributeNS(null, "stroke-width", String(2));
  }
  const [init, ...rest] = path.points;
  const m = `${init.x} ${init.y}`;
  const l = rest.map((r) => `${r.x} ${r.y}`).join(" ");
  const d = `M${m} L${l}`;
  element.setAttributeNS(null, "d", d);
  state.svgEl.append(element);
}
function deleteObject(state: State, id: string) {
  document.getElementById(id)?.remove();
}

function generateObjectId(): string {
  return String(Date.now()).padStart(32, "0");
}
function startDrawing(state: State, pos: NormalizedPosition): void {
  state.editing = { kind: "path", path: [pos] };
}
function continueDrawing(state: State, pos: NormalizedPosition): void {
  if (state.editing.kind === "path") {
    state.editing.path.push(pos);
  }
}
function stopDrawing(
  state: State,
  pos: NormalizedPosition
): NormalizedPosition[] {
  if (state.editing.kind === "path") {
    const path = state.editing.path;
    state.editing.path = [];
    return path;
  }
  return [];
}

function startSelecting(state: State, pos: NormalizedPosition): void {
  state.editing = { kind: "select", start: pos };
}
function continueSelecting(state: State, pos: NormalizedPosition): void {}
function stopSelecting(state: State, pos: NormalizedPosition): void {}

function startMoving(state: State, pos: NormalizedPosition): void {
  state.editing = { kind: "select", start: pos };
}
function continueMoving(state: State, pos: NormalizedPosition): void {}
function stopMoving(state: State, pos: NormalizedPosition): void {}

function createText(state: State, pos: NormalizedPosition): void {
  state.editing = { kind: "text", position: pos };
}
function startEditingText(state: State): void {}
function stopEditingText(state: State, text: string): void {
  if (state.editing.kind === "text") {
    if (text.length > 0) {
      if (state.websocket != null) {
        const position = state.editing.position;
        const object = {
          id: generateObjectId(),
          kind: "text",
          text,
          position,
        } as const;
        const event = {
          kind: "add",
          object,
        };
        upsertText(state, object);
        state.websocket.send(JSON.stringify(event));
      }
    }
  }
  state.editing = { kind: "none" };
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
function toPixelPosition(
  state: State,
  npos: NormalizedPosition
): PixelPosition {
  return {
    pos: "p",
    x: npos.x * state.boardSize.width,
    y: npos.y * state.boardSize.height,
  };
}
function updateInputElementPosition(state: State): void {
  if (state.editing.kind === "text") {
    const ppos = toPixelPosition(state, state.editing.position);
    state.inputEl.style.left = `${ppos.x}px`;
    state.inputEl.style.top = `${ppos.y}px`;
  }
}
function listtenToWindowEvents(state: State): () => void {
  window.onresize = () => {
    state.boardSize = getBoardSize(state.svgEl);
    updateInputElementPosition(state);
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
    updateInputElementPosition(state);
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
    const svgEl = document.getElementById("board")!;
    const selectorEl = document.getElementById("selector")!;
    const inputEl = document.getElementById("input")! as HTMLInputElement;
    const state: State = {
      svgEl,
      inputEl,
      selectorEl,
      boardSize: getBoardSize(svgEl),
      websocket: null,
      undos: [],
      redos: [],
      editing: { kind: "none" },
      selected: [],
    };
    const unlistenBoard = listenToBoardEvents(state);
    const unlistenInput = listenToInputEvents(state);
    const unlistenWindow = listtenToWindowEvents(state);
    connect(pageInfo, state, () => {
      unlistenBoard();
      unlistenInput();
      unlistenWindow();
    });
  } else {
    // show error
    if (location.hostname === "localhost") {
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
