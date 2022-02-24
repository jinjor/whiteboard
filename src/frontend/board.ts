import { ObjectBody, PathBody, Position, TextBody } from "../schema";
type Size = { width: number; height: number };
export type PixelPosition = { px: number; py: number };
export type Rectangle = { x: number; y: number; width: number; height: number };
export type BoardOptions = {
  viewBox: Rectangle;
  textFontSize: number;
  pathStrokeWidth: number;
  selectorStrokeWidth: number;
};

function getPixelPositionFromMouse(e: MouseEvent): PixelPosition {
  return {
    px: e.offsetX,
    py: e.offsetY,
  };
}
function getPixelPositionFromTouch(
  boardPosition: PixelPosition,
  touch: Touch
): PixelPosition {
  return {
    px: touch.pageX - boardPosition.px,
    py: touch.pageY - boardPosition.py,
  };
}
export function listenToBoardEvents(
  boardOptions: BoardOptions,
  svgEl: HTMLElement,
  o: {
    getBoardRect: () => { position: PixelPosition; size: Size };
    doubleClick: (pos: Position) => void;
    mouseDown: (pos: Position, isRight: boolean) => void;
    touchStart: (pos: Position) => void;
    mouseMove: (pos: Position) => void;
    touchMove: (pos: Position) => void;
    mouseUp: (pos: Position) => void;
    touchEnd: (pos: Position) => void;
  }
): () => void {
  svgEl.ondblclick = (e: MouseEvent) => {
    e.preventDefault();
    const boardRect = o.getBoardRect();
    const pos = getPixelPositionFromMouse(e);
    const npos = toBoardPosition(boardOptions, boardRect.size, pos);
    o.doubleClick(npos);
  };
  svgEl.oncontextmenu = (e: MouseEvent) => {
    if (e.ctrlKey) {
      return;
    }
    e.preventDefault();
  };
  svgEl.onmousedown = (e: MouseEvent) => {
    e.preventDefault();
    const boardRect = o.getBoardRect();
    const pos = getPixelPositionFromMouse(e);
    const npos = toBoardPosition(boardOptions, boardRect.size, pos);
    o.mouseDown(npos, e.button !== 0);
  };
  svgEl.ontouchstart = (e: TouchEvent) => {
    e.preventDefault();
    const boardRect = o.getBoardRect();
    const pos = getPixelPositionFromTouch(boardRect.position, e.touches[0]);
    const npos = toBoardPosition(boardOptions, boardRect.size, pos);
    o.touchStart(npos);
  };
  svgEl.onmousemove = (e: MouseEvent) => {
    e.preventDefault();
    const boardRect = o.getBoardRect();
    const pos = getPixelPositionFromMouse(e);
    const npos = toBoardPosition(boardOptions, boardRect.size, pos);
    o.mouseMove(npos);
  };
  svgEl.ontouchmove = (e: TouchEvent) => {
    e.preventDefault();
    const boardRect = o.getBoardRect();
    const pos = getPixelPositionFromTouch(boardRect.position, e.touches[0]);
    const npos = toBoardPosition(boardOptions, boardRect.size, pos);
    o.touchMove(npos);
  };
  svgEl.onmouseup = (e: MouseEvent) => {
    e.preventDefault();
    const boardRect = o.getBoardRect();
    const pos = getPixelPositionFromMouse(e);
    const npos = toBoardPosition(boardOptions, boardRect.size, pos);
    o.mouseUp(npos);
  };
  svgEl.ontouchend = (e: TouchEvent) => {
    e.preventDefault();
    const boardRect = o.getBoardRect();
    const pos = getPixelPositionFromTouch(
      boardRect.position,
      e.changedTouches[0]
    );
    const npos = toBoardPosition(boardOptions, boardRect.size, pos);
    o.touchEnd(npos);
  };
  return () => {
    svgEl.ondblclick = null;
    svgEl.onmousedown = null;
    svgEl.ontouchstart = null;
    svgEl.onmousemove = null;
    svgEl.ontouchmove = null;
    svgEl.onmouseup = null;
    svgEl.ontouchend = null;
  };
}

export function toBoardPosition(
  boardOptions: BoardOptions,
  boardSize: Size,
  ppos: PixelPosition
): Position {
  const { width, height } = boardSize;
  const viewBoxWidth = boardOptions.viewBox.width;
  const viewBoxHeight = boardOptions.viewBox.height;
  const actualRatioPerExpectedRatio =
    width / height / (viewBoxWidth / viewBoxHeight);
  const scaleX = Math.max(actualRatioPerExpectedRatio, 1);
  const scaleY = Math.max(1 / actualRatioPerExpectedRatio, 1);
  const offsetX = viewBoxWidth * ((1 - scaleX) / 2);
  const offsetY = viewBoxHeight * ((1 - scaleY) / 2);
  return {
    x: (ppos.px / width) * scaleX + offsetX,
    y: (ppos.py / height) * scaleY + offsetY,
  };
}
export function toPixelPosition(
  boardOptions: BoardOptions,
  boardSize: Size,
  npos: Position
): PixelPosition {
  const { width, height } = boardSize;
  const viewBoxWidth = boardOptions.viewBox.width;
  const viewBoxHeight = boardOptions.viewBox.height;
  const actualRatioPerExpectedRatio =
    width / height / (viewBoxWidth / viewBoxHeight);
  const scaleX = Math.max(actualRatioPerExpectedRatio, 1);
  const scaleY = Math.max(1 / actualRatioPerExpectedRatio, 1);
  const offsetX = viewBoxWidth * ((1 - scaleX) / 2);
  const offsetY = viewBoxHeight * ((1 - scaleY) / 2);
  return {
    px: ((npos.x - offsetX) / scaleX) * width,
    py: ((npos.y - offsetY) / scaleY) * height,
  };
}
export function upsertObject(
  svgEl: HTMLElement,
  object: ObjectBody,
  boardOptions: BoardOptions
): void {
  switch (object.kind) {
    case "text": {
      return upsertText(svgEl, object, boardOptions.textFontSize);
    }
    case "path": {
      return upsertPath(svgEl, object, boardOptions.pathStrokeWidth);
    }
  }
}
export function deleteObject(svgEl: HTMLElement, id: string): void {
  document.getElementById(id)?.remove();
}
function createObjectElement<T extends string>(
  tagName: T,
  id: string
): T extends "text"
  ? SVGTextElement
  : T extends "path"
  ? SVGPathElement
  : never {
  const element = document.createElementNS(
    "http://www.w3.org/2000/svg",
    tagName
  );
  element.id = id;
  element.classList.add("object");
  element.setAttributeNS(null, "clip-path", "url(#clip)");
  return element as any;
}
export function upsertText(
  svgEl: HTMLElement,
  text: TextBody,
  fontSize: number
) {
  let element = document.getElementById(text.id) as unknown as SVGTextElement;
  if (element == null) {
    element = createObjectElement("text", text.id);
    element.setAttributeNS(null, "font-size", String(fontSize));
  }
  element.textContent = text.text;
  element.setAttributeNS(null, "x", String(text.position.x));
  element.setAttributeNS(null, "y", String(text.position.y));
  svgEl.append(element);
}
export function upsertPath(
  svgEl: HTMLElement,
  path: PathBody,
  strokeWidth: number
) {
  let element = document.getElementById(
    path.id
  ) as unknown as SVGPathElement | null;
  if (element == null) {
    element = createObjectElement("path", path.id);
    element.setAttributeNS(null, "fill", "none");
    element.setAttributeNS(null, "stroke", "black");
    element.setAttributeNS(null, "stroke-width", String(strokeWidth));
  }
  element.setAttributeNS(null, "d", path.d);
  svgEl.append(element);
}
export function elementToObject(element: HTMLElement): ObjectBody | null {
  const id = element.id;
  const kind = element.tagName;
  switch (kind) {
    case "text": {
      const text = getText(element);
      const position = getPosition(element);
      return {
        id,
        kind: "text",
        text,
        position,
      };
    }
    case "path": {
      const d = getD(element);
      return {
        id,
        kind: "path",
        d,
      };
    }
  }
  return null;
}
function formatPosition(pos: Position): string {
  return `${pos.x.toFixed(4)},${pos.y.toFixed(4)}`;
}
export function makeD(points: Position[]) {
  const [init, ...rest] = points;
  const m = formatPosition(init);
  if (rest.length <= 0) {
    return `M${m}`;
  }
  const l = rest.map(formatPosition).join(" ");
  return `M${m}L${l}`;
}
export function parseD(d: string): Position[] {
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
export function getText(element: HTMLElement | SVGElement): string {
  return element.textContent!;
}
export function getPosition(element: HTMLElement | SVGElement): Position {
  return {
    x: parseFloat(element.getAttributeNS(null, "x")!),
    y: parseFloat(element.getAttributeNS(null, "y")!),
  };
}
export function getD(element: HTMLElement | SVGElement): string {
  return element.getAttributeNS(null, "d")!;
}
export function setRectangle(
  element: HTMLElement | SVGElement,
  rect: Rectangle
) {
  setPosition(element, rect);
  setSize(element, rect);
}
export function setPosition(
  element: HTMLElement | SVGElement,
  posision: Position
) {
  element.setAttributeNS(null, "x", String(posision.x));
  element.setAttributeNS(null, "y", String(posision.y));
}
export function setSize(element: HTMLElement | SVGElement, size: Size) {
  element.setAttributeNS(null, "width", String(size.width));
  element.setAttributeNS(null, "height", String(size.height));
}
export function setD(element: HTMLElement | SVGElement, d: string) {
  element.setAttributeNS(null, "d", d);
}
export function setStroke(element: HTMLElement | SVGElement, stroke: string) {
  element.setAttributeNS(null, "stroke", stroke);
}
export function setSelected(
  element: HTMLElement | SVGElement,
  selected: boolean
) {
  const color = selected ? "red" : "black";
  switch (element.tagName) {
    case "text": {
      element.setAttributeNS(null, "fill", color);
      break;
    }
    case "path": {
      element.setAttributeNS(null, "stroke", color);
      break;
    }
  }
}

export class Input {
  constructor(private element: HTMLInputElement) {}
  getText(): string {
    return this.element.value;
  }
  setPosition(pos: PixelPosition): void {
    this.element.style.left = `${pos.px}px`;
    this.element.style.top = `${pos.py}px`;
  }
  showAndFocus(): void {
    this.element.classList.remove("hidden");
    this.element.focus();
  }
  hideAndReset(): void {
    this.element.value = "";
    this.element.classList.add("hidden");
  }
  listen(o: { enter: () => void }): void {
    this.element.onkeydown = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        o.enter();
      }
    };
  }
  unlisten(): void {
    this.element.onkeydown = null;
  }
}
export class Selector {
  constructor(private element: HTMLElement) {}
  setRectangle(x: number, y: number, width: number, height: number): void {
    setRectangle(this.element, { x, y, width, height });
  }
  show(): void {
    setStroke(this.element, "red");
  }
  hide(): void {
    setStroke(this.element, "none");
  }
}
