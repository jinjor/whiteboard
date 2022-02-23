import {
  ObjectBody,
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
  | { kind: "path"; points: NormalizedPosition[]; id: ObjectId }
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
          upsertObject(state, data.objects[key]);
        }
        break;
      }
      case "upsert": {
        upsertObject(state, data.object);
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
function upsertObject(state: State, object: ObjectBody) {
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
function upsertText(state: State, text: TextBody) {
  let element = document.getElementById(text.id) as unknown as SVGTextElement;
  if (element == null) {
    element = document.createElementNS("http://www.w3.org/2000/svg", "text");
    element.id = text.id;
    element.setAttributeNS(null, "clip-path", "url(#clip)");
    element.setAttributeNS(null, "font-size", String(0.04));
  }
  element.textContent = text.text;
  element.setAttributeNS(null, "x", String(text.position.x));
  element.setAttributeNS(null, "y", String(text.position.y));
  state.svgEl.append(element);
}
function upsertPath(state: State, path: PathBody) {
  let element = document.getElementById(
    path.id
  ) as unknown as SVGPathElement | null;
  if (element == null) {
    element = document.createElementNS("http://www.w3.org/2000/svg", "path");
    element.id = path.id;
    element.setAttributeNS(null, "clip-path", "url(#clip)");
    element.setAttributeNS(null, "fill", "none");
    element.setAttributeNS(null, "stroke", "black");
    element.setAttributeNS(null, "stroke-width", String(0.005));
  }
  const d = makeD(path.points);
  element.setAttributeNS(null, "d", d);
  state.svgEl.append(element);
}
function makeD(points: Position[]) {
  const [init, ...rest] = points;
  const m = `${init.x} ${init.y}`;
  if (rest.length <= 0) {
    return `M${m}`;
  }
  const l = rest.map((r) => `${r.x} ${r.y}`).join(" ");
  return `M${m} L${l}`;
}
function deleteObject(state: State, id: string) {
  document.getElementById(id)?.remove();
}

function generateObjectId(): ObjectId {
  return String(Date.now()).padStart(32, "0");
}
function startDrawing(state: State, pos: NormalizedPosition): void {
  const id = generateObjectId();
  const points = [pos];
  state.editing = { kind: "path", points, id };
  const object = {
    id,
    kind: "path",
    points,
  } as const;
  upsertPath(state, object);
}
function continueDrawing(state: State, pos: NormalizedPosition): void {
  if (state.editing.kind === "path") {
    const id = state.editing.id;
    const element = document.getElementById(
      id
    ) as unknown as SVGPathElement | null;
    if (element != null) {
      const d = makeD(state.editing.points);
      element.setAttributeNS(null, "d", d);
    }
    state.editing.points.push(pos);
  }
}
function stopDrawing(state: State, pos: NormalizedPosition): void {
  if (state.editing.kind === "path") {
    const points = state.editing.points;
    state.editing.points = [];
    if (points.length >= 2) {
      if (state.websocket != null) {
        const object = {
          id: generateObjectId(),
          kind: "path",
          points: points,
        } as const;
        const event = {
          kind: "add",
          object,
        };
        upsertPath(state, object);
        state.websocket.send(JSON.stringify(event));
      }
    }
  }
  state.editing = { kind: "none" };
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
  const { width, height } = state.boardSize;
  const viewBoxWidth = 1;
  const viewBoxHeight = 1;
  const actualRatioPerExpectedRatio =
    width / height / (viewBoxWidth / viewBoxHeight);
  const scaleX = Math.max(actualRatioPerExpectedRatio, 1);
  const scaleY = Math.max(1 / actualRatioPerExpectedRatio, 1);
  const offsetX = viewBoxWidth * ((1 - scaleX) / 2);
  const offsetY = viewBoxHeight * ((1 - scaleY) / 2);
  return {
    pos: "n",
    x: cutDecimal((ppos.x / width) * scaleX + offsetX),
    y: cutDecimal((ppos.y / height) * scaleY + offsetY),
  };
}
function cutDecimal(n: number) {
  return Math.floor(n * 1000) / 1000;
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
  state.svgEl.onmousemove = (e: MouseEvent) => {
    const pos = getPixelPosition(e);
    const npos = toNormalizedPosition(state, pos);
    if (e.button === 0) {
      if (state.selected.length > 0) {
        return continueMoving(state, npos);
      }
      return continueDrawing(state, npos);
    } else {
      return continueMoving(state, npos);
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
