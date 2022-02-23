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
      position: NormalizedPosition;
    }
  | {
      kind: "path";
      id: ObjectId;
      bbox: Rectangle;
      points: NormalizedPosition[];
    };

type EditingState =
  | { kind: "none" }
  | { kind: "select"; start: NormalizedPosition; objects: ObjectForSelect[] }
  | { kind: "move"; start: NormalizedPosition }
  | { kind: "path"; points: NormalizedPosition[]; id: ObjectId }
  | { kind: "text"; position: NormalizedPosition };
type State = {
  svgEl: HTMLElement;
  inputEl: HTMLInputElement;
  selectorEl: HTMLElement;
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
    element.classList.add("object");
    element.setAttributeNS(null, "clip-path", "url(#clip)");
    element.setAttributeNS(null, "font-size", String(0.02));
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
    element.classList.add("object");
    element.setAttributeNS(null, "clip-path", "url(#clip)");
    element.setAttributeNS(null, "fill", "none");
    element.setAttributeNS(null, "stroke", "black");
    element.setAttributeNS(null, "stroke-width", String(0.002));
  }
  element.setAttributeNS(null, "d", path.d);
  state.svgEl.append(element);
}
function makeD(points: Position[]) {
  const [init, ...rest] = points;
  const m = `${init.x.toFixed(4)},${init.y.toFixed(4)}`;
  if (rest.length <= 0) {
    return `M${m}`;
  }
  const l = rest.map((r) => `${r.x.toFixed(4)},${r.y.toFixed(4)}`).join(" ");
  return `M${m}L${l}`;
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
}
function continueDrawing(state: State, pos: NormalizedPosition): void {
  if (state.editing.kind === "path") {
    const id = state.editing.id;
    let element = document.getElementById(
      id
    ) as unknown as SVGPathElement | null;
    state.editing.points.push(pos);
    const d = makeD(state.editing.points);
    if (element == null) {
      const object = { id, kind: "path", d } as const;
      upsertPath(state, object);
    } else {
      element.setAttributeNS(null, "d", d);
    }
  }
}
function stopDrawing(state: State, pos: NormalizedPosition): void {
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
  const elements = document.getElementsByClassName(
    "object"
  ) as unknown as SVGElement[];
  const objects: ObjectForSelect[] = [];
  for (const element of elements) {
    const { x, y, width, height } = (element as any).getBBox();
    const bbox = new Rectangle(x, y, width, height);
    switch (element.tagName) {
      case "text": {
        const position = {
          pos: "n",
          x: parseFloat(element.getAttributeNS(null, "x")!),
          y: parseFloat(element.getAttributeNS(null, "y")!),
        } as const;
        objects.push({
          kind: "text",
          id: element.id,
          position,
          bbox,
        });
        break;
      }
      case "path": {
        const d = element.getAttributeNS(null, "d")!;
        const points = d
          .slice(1) // remove M
          .replace("L", " ")
          .split(" ")
          .map((s) => s.split(","))
          .map(
            ([x, y]) =>
              ({
                pos: "n",
                x: parseFloat(x),
                y: parseFloat(y),
              } as const)
          );
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
  state.selectorEl.setAttributeNS(null, "x", String(pos.x));
  state.selectorEl.setAttributeNS(null, "y", String(pos.y));
  state.selectorEl.setAttributeNS(null, "width", String(0));
  state.selectorEl.setAttributeNS(null, "height", String(0));
  state.selectorEl.setAttributeNS(null, "stroke", "red");
}
function isObjectSelected(object: ObjectForSelect, rect: Rectangle): boolean {
  const orect = object.bbox;
  const fillyContained =
    orect.x > rect.x &&
    orect.right < rect.right &&
    orect.y > rect.y &&
    orect.bottom < rect.bottom;
  if (fillyContained) {
    return true;
  }
  const points =
    object.kind === "text"
      ? [
          { x: orect.x, y: orect.y },
          { x: orect.x, y: orect.bottom },
          { x: orect.right, y: orect.y },
          { x: orect.right, y: orect.bottom },
        ]
      : object.points;
  for (const point of points) {
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
function continueSelecting(state: State, pos: NormalizedPosition): void {
  state.selected = [];
  if (state.editing.kind === "select") {
    const start = state.editing.start;
    const x = Math.min(pos.x, start.x);
    const y = Math.min(pos.y, start.y);
    const width = Math.abs(pos.x - start.x);
    const height = Math.abs(pos.y - start.y);
    state.selectorEl.setAttributeNS(null, "x", String(x));
    state.selectorEl.setAttributeNS(null, "y", String(y));
    state.selectorEl.setAttributeNS(null, "width", String(width));
    state.selectorEl.setAttributeNS(null, "height", String(height));
    for (const object of state.editing.objects) {
      const selected = isObjectSelected(
        object,
        new Rectangle(x, y, width, height)
      );
      const element = document.getElementById(object.id)!;
      if (selected) {
        state.selected.push(object);
      }
      const color = selected ? "red" : "black";
      const key = object.kind === "text" ? "fill" : "stroke";
      element.setAttributeNS(null, key, color);
    }
  }
}
function stopSelecting(state: State, pos: NormalizedPosition): void {
  state.editing = { kind: "none" };
  state.selectorEl.setAttributeNS(null, "stroke", "none");
}

function startMoving(state: State, pos: NormalizedPosition): void {
  state.editing = { kind: "move", start: pos };
}
function continueMoving(state: State, pos: NormalizedPosition): void {
  if (state.editing.kind === "move") {
    const dx = pos.x - state.editing.start.x;
    const dy = pos.y - state.editing.start.y;
    for (const object of state.selected) {
      const element = document.getElementById(
        object.id
      )! as unknown as SVGElement;
      switch (object.kind) {
        case "text": {
          const x = object.position.x + dx;
          const y = object.position.y + dy;
          element.setAttributeNS(null, "x", String(x));
          element.setAttributeNS(null, "y", String(y));
          break;
        }
        case "path": {
          const points = object.points.map((p) => ({
            x: p.x + dx,
            y: p.y + dy,
          }));
          const d = makeD(points);
          element.setAttributeNS(null, "d", d);
          break;
        }
      }
    }
  }
}
function stopMoving(state: State, pos: NormalizedPosition): void {
  if (state.editing.kind === "move") {
    if (state.websocket != null) {
      const dx = pos.x - state.editing.start.x;
      const dy = pos.y - state.editing.start.y;
      for (const object of state.selected) {
        switch (object.kind) {
          case "text": {
            const x = object.position.x + dx;
            const y = object.position.y + dy;
            const oldPosision = { x: object.position.x, y: object.position.y };
            const newPosision = { x, y };
            const event: PatchEventBody = {
              kind: "patch",
              id: object.id,
              key: "position",
              value: { old: oldPosision, new: newPosision },
            };
            patchTextPosision(object.id, { pos: "n", x, y });
            state.websocket.send(JSON.stringify(event));
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
            state.websocket.send(JSON.stringify(event));
            break;
          }
        }
      }
    }
  }
  for (const object of state.selected) {
    const element = document.getElementById(object.id)!;
    const key = object.kind === "text" ? "fill" : "stroke";
    element.setAttributeNS(null, key, "black");
  }
  state.editing = { kind: "none" };
  state.selected = [];
}
function patchTextPosision(id: ObjectId, position: NormalizedPosition): void {
  const element = document.getElementById(id)! as unknown as SVGPathElement;
  element.setAttributeNS(null, "x", String(position.x));
  element.setAttributeNS(null, "y", String(position.y));
}
function patchPathD(id: ObjectId, d: string): void {
  const element = document.getElementById(id)! as unknown as SVGPathElement;
  element.setAttributeNS(null, "d", d);
}

function createText(state: State, pos: NormalizedPosition): void {
  state.editing = { kind: "text", position: pos };
  updateInputElementPosition(state);
  state.inputEl.classList.remove("hidden");
  state.inputEl.focus();
}
function startEditingText(state: State): void {}
function stopEditingText(state: State): void {
  const text = state.inputEl.value;
  if (state.editing.kind === "text") {
    if (text.length > 0) {
      if (state.websocket != null) {
        const position = state.editing.position;
        const object = {
          id: generateObjectId(),
          kind: "text",
          text,
          position: { x: position.x, y: position.y },
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
  state.inputEl.value = "";
  state.inputEl.classList.add("hidden");
}

function undo(state: State): void {}
function redo(state: State): void {}
function listenToKeyboardEvents(
  state: State,
  element: HTMLElement
): () => void {
  return () => {};
}
function getBoardRect(svgElement: HTMLElement): {
  size: Size;
  position: PixelPosition;
} {
  const rect = svgElement.getBoundingClientRect();
  return {
    size: { width: rect.width, height: rect.height },
    position: { pos: "p", x: rect.left, y: rect.top },
  };
}
function getPixelPositionFromMouse(e: MouseEvent): PixelPosition {
  return {
    pos: "p",
    x: e.offsetX,
    y: e.offsetY,
  };
}
function getPixelPositionFromTouch(state: State, touch: Touch): PixelPosition {
  return {
    pos: "p",
    x: touch.pageX - state.boardRect.position.x,
    y: touch.pageY - state.boardRect.position.y,
  };
}
function toNormalizedPosition(
  state: State,
  ppos: PixelPosition
): NormalizedPosition {
  const { width, height } = state.boardRect.size;
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
    x: (ppos.x / width) * scaleX + offsetX,
    y: (ppos.y / height) * scaleY + offsetY,
  };
}
function toPixelPosition(
  state: State,
  npos: NormalizedPosition
): PixelPosition {
  const { width, height } = state.boardRect.size;
  const viewBoxWidth = 1;
  const viewBoxHeight = 1;
  const actualRatioPerExpectedRatio =
    width / height / (viewBoxWidth / viewBoxHeight);
  const scaleX = Math.max(actualRatioPerExpectedRatio, 1);
  const scaleY = Math.max(1 / actualRatioPerExpectedRatio, 1);
  const offsetX = viewBoxWidth * ((1 - scaleX) / 2);
  const offsetY = viewBoxHeight * ((1 - scaleY) / 2);
  return {
    pos: "p",
    x: ((npos.x - offsetX) / scaleX) * width,
    y: ((npos.y - offsetY) / scaleY) * height,
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
    state.boardRect = getBoardRect(state.svgEl);
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
      stopEditingText(state);
    }
  };
  return () => {
    state.inputEl.oninput = null;
    state.inputEl.onkeydown = null;
  };
}
function listenToBoardEvents(state: State): () => void {
  state.svgEl.ondblclick = (e: MouseEvent) => {
    e.preventDefault();
    const pos = getPixelPositionFromMouse(e);
    const npos = toNormalizedPosition(state, pos);
    createText(state, npos);
  };
  state.svgEl.oncontextmenu = (e: MouseEvent) => {
    if (e.ctrlKey) {
      return;
    }
    e.preventDefault();
  };
  state.svgEl.onmousedown = (e: MouseEvent) => {
    e.preventDefault();
    const pos = getPixelPositionFromMouse(e);
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
  state.svgEl.ontouchstart = (e: TouchEvent) => {
    e.preventDefault();
    const pos = getPixelPositionFromTouch(state, e.touches[0]);
    const npos = toNormalizedPosition(state, pos);
    if (state.selected.length > 0) {
      return startMoving(state, npos);
    }
    return startDrawing(state, npos);
  };
  state.svgEl.onmousemove = (e: MouseEvent) => {
    e.preventDefault();
    const pos = getPixelPositionFromMouse(e);
    const npos = toNormalizedPosition(state, pos);
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
  };
  state.svgEl.ontouchmove = (e: TouchEvent) => {
    e.preventDefault();
    const pos = getPixelPositionFromTouch(state, e.touches[0]);
    const npos = toNormalizedPosition(state, pos);
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
  };
  state.svgEl.onmouseup = (e: MouseEvent) => {
    e.preventDefault();
    const pos = getPixelPositionFromMouse(e);
    const npos = toNormalizedPosition(state, pos);
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
  };
  state.svgEl.ontouchend = (e: TouchEvent) => {
    e.preventDefault();
    const pos = getPixelPositionFromTouch(state, e.changedTouches[0]);
    const npos = toNormalizedPosition(state, pos);
    if (state.selected.length > 0) {
      return stopMoving(state, npos);
    }
    return stopDrawing(state, npos);
  };
  return () => {
    state.svgEl.ondblclick = null;
    state.svgEl.onmousedown = null;
    state.svgEl.ontouchstart = null;
    state.svgEl.onmousemove = null;
    state.svgEl.ontouchmove = null;
    state.svgEl.onmouseup = null;
    state.svgEl.ontouchend = null;
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
      boardRect: getBoardRect(svgEl),
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
