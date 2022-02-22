import { ObjectId, PatchEventBody, Position, ResponseEvent } from "../schema";

type Patch = PatchEventBody;
type Drag =
  | { kind: "select"; start: Position }
  | { kind: "draw"; path: Position[] }
  | { kind: "move"; start: Position };
type State = {
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
function startDrawing(state: State, pos: Position): void {
  state.drag = { kind: "draw", path: [pos] };
}
function continueDrawing(state: State, pos: Position): void {}
function stopDrawing(state: State, pos: Position): void {}

function startSelecting(state: State, pos: Position): void {
  state.drag = { kind: "select", start: pos };
}
function continueSelecting(state: State, pos: Position): void {}
function stopSelecting(state: State, pos: Position): void {}

function startMoving(state: State, pos: Position): void {
  state.drag = { kind: "select", start: pos };
}
function continueMoving(state: State, pos: Position): void {}
function stopMoving(state: State, pos: Position): void {}

function createText(state: State, pos: Position): void {}
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
function listenToInputEvents(
  state: State,
  inputElement: HTMLInputElement
): () => void {
  inputElement.onkeydown = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      const text = inputElement.value;
      stopEditingText(state, text);
      inputElement.value = "";
      inputElement.classList.add("hidden");
    }
  };
  return () => {
    inputElement.oninput = null;
    inputElement.onkeydown = null;
  };
}
function listenToBoardEvents(
  state: State,
  svgElement: HTMLElement,
  inputElement: HTMLInputElement
): () => void {
  svgElement.ondblclick = (e: MouseEvent) => {
    createText(state, { x: 0, y: 0 });
    inputElement.classList.remove("hidden");
    inputElement.focus();
  };
  svgElement.onmousedown = (e: MouseEvent) => {
    if (e.button === 0) {
      if (state.selected.length > 0) {
        return startMoving(state, { x: 0, y: 0 });
      }
      return startDrawing(state, { x: 0, y: 0 });
    } else {
      return startSelecting(state, { x: 0, y: 0 });
    }
  };
  svgElement.onmouseup = (e: MouseEvent) => {
    if (e.button === 0) {
      if (state.selected.length > 0) {
        return stopMoving(state, { x: 0, y: 0 });
      }
      return stopDrawing(state, { x: 0, y: 0 });
    } else {
      return stopMoving(state, { x: 0, y: 0 });
    }
  };
  return () => {
    svgElement.ondblclick = null;
    svgElement.onmousedown = null;
    svgElement.onmouseup = null;
  };
}

(async () => {
  const pageInfo = getPageInfo();
  const state: State = {
    websocket: null,
    undos: [],
    redos: [],
    drag: null,
    selected: [],
  };
  const roomExists = await isRoomPresent(pageInfo.roomId);
  if (roomExists) {
    connect(pageInfo, state);
    const svgElement = document.getElementById("board")!;
    const inputElement = document.getElementById("input")! as HTMLInputElement;
    listenToBoardEvents(state, svgElement, inputElement);
    listenToInputEvents(state, inputElement);
  } else {
    // show error
  }
})();
