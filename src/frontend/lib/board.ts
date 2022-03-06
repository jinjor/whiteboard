import {
  ObjectBody,
  ObjectId,
  PathBody,
  Position,
  TextBody,
} from "../../schema";
type Size = { width: number; height: number };
export type PixelPosition = { px: number; py: number };
export type Rectangle = { x: number; y: number; width: number; height: number };

const touchDevice =
  window.ontouchstart != null || window.navigator.maxTouchPoints > 0;

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
export function deleteObject(id: string): void {
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
export function patchObject(id: ObjectId, key: string, value: any): void {
  const element = document.getElementById(id)!;
  switch (element.tagName) {
    case "text": {
      switch (key) {
        case "position": {
          setPosition(element, value);
          break;
        }
      }
      break;
    }
    case "path": {
      switch (key) {
        case "d": {
          setD(element, value);
          break;
        }
      }
      break;
    }
  }
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
export type BoardOptions = {
  viewBox: Rectangle;
  textFontSize: number;
  pathStrokeWidth: number;
  selectorStrokeWidth: number;
};
export class Board {
  private element: HTMLElement;
  constructor(private options: BoardOptions) {
    this.element = document.getElementById("board")!;
    const backgroundEl = document.getElementById("board-background")!;
    const clipRectEl = document.getElementById("board-clip-rect")!;
    const viewBox = `${options.viewBox.x} ${options.viewBox.y} ${options.viewBox.width} ${options.viewBox.height}`;
    this.element.setAttributeNS(null, "viewBox", viewBox);
    setRectangle(backgroundEl, options.viewBox);
    setRectangle(clipRectEl, options.viewBox);
  }
  calculateBoardRect(): {
    size: Size;
    position: PixelPosition;
  } {
    const rect = this.element.getBoundingClientRect();
    return {
      size: { width: rect.width, height: rect.height },
      position: { px: rect.left, py: rect.top },
    };
  }
  toBoardPosition(boardSize: Size, ppos: PixelPosition): Position {
    const { width, height } = boardSize;
    const viewBoxWidth = this.options.viewBox.width;
    const viewBoxHeight = this.options.viewBox.height;
    const actualRatioPerExpectedRatio =
      width / height / (viewBoxWidth / viewBoxHeight);
    const scaleX = Math.max(actualRatioPerExpectedRatio, 1);
    const scaleY = Math.max(1 / actualRatioPerExpectedRatio, 1);
    const offsetX = (1 - scaleX) / 2;
    const offsetY = (1 - scaleY) / 2;
    const x = viewBoxWidth * ((ppos.px / width) * scaleX + offsetX);
    const y = viewBoxHeight * ((ppos.py / height) * scaleY + offsetY);
    return { x, y };
  }
  toPixelPosition(boardSize: Size, npos: Position): PixelPosition {
    const { width, height } = boardSize;
    const viewBoxWidth = this.options.viewBox.width;
    const viewBoxHeight = this.options.viewBox.height;
    const actualRatioPerExpectedRatio =
      width / height / (viewBoxWidth / viewBoxHeight);
    const scaleX = Math.max(actualRatioPerExpectedRatio, 1);
    const scaleY = Math.max(1 / actualRatioPerExpectedRatio, 1);
    const offsetX = (1 - scaleX) / 2;
    const offsetY = (1 - scaleY) / 2;
    const px = ((npos.x / viewBoxWidth - offsetX) / scaleX) * width;
    const py = ((npos.y / viewBoxHeight - offsetY) / scaleY) * height;
    return { px, py };
  }
  toMovingCursor() {
    this.element.style.cursor = "move";
  }
  toDefaultCursor() {
    this.element.style.removeProperty("cursor");
  }
  upsertObject(object: ObjectBody, boardOptions: BoardOptions): void {
    switch (object.kind) {
      case "text": {
        return this.upsertText(object, boardOptions.textFontSize);
      }
      case "path": {
        return this.upsertPath(object, boardOptions.pathStrokeWidth);
      }
    }
  }
  upsertText(text: TextBody, fontSize: number) {
    let element = document.getElementById(text.id) as unknown as SVGTextElement;
    if (element == null) {
      element = createObjectElement("text", text.id);
      element.setAttributeNS(null, "font-size", String(fontSize));
    }
    element.textContent = text.text;
    element.setAttributeNS(null, "x", String(text.position.x));
    element.setAttributeNS(null, "y", String(text.position.y));
    this.element.append(element);
  }
  upsertPath(path: PathBody, strokeWidth: number) {
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
    this.element.append(element);
  }
  listenToBoardEvents(
    boardOptions: BoardOptions,
    o: {
      getBoardRect: () => { position: PixelPosition; size: Size };
      doubleClick: (pos: Position) => void;
      mouseDown: (pos: Position, isRight: boolean) => void;
      touchStart: (pos: Position) => void;
      touchStartLong: (pos: Position) => void;
      mouseMove: (pos: Position) => void;
      touchMove: (pos: Position) => void;
      mouseUp: (pos: Position) => void;
      touchEnd: (pos: Position) => void;
    }
  ): () => void {
    this.element.ondblclick = (e: MouseEvent) => {
      e.preventDefault();
      const boardRect = o.getBoardRect();
      const pos = getPixelPositionFromMouse(e);
      const npos = this.toBoardPosition(boardRect.size, pos);
      o.doubleClick(npos);
    };
    this.element.oncontextmenu = (e: MouseEvent) => {
      if (e.ctrlKey || e.metaKey) {
        return;
      }
      e.preventDefault();
    };
    this.element.onmousedown = (e: MouseEvent) => {
      e.preventDefault();
      const boardRect = o.getBoardRect();
      const pos = getPixelPositionFromMouse(e);
      const npos = this.toBoardPosition(boardRect.size, pos);
      o.mouseDown(npos, e.button !== 0);
    };
    let touchdown = false;
    this.element.ontouchstart = (e: TouchEvent) => {
      e.preventDefault();
      const boardRect = o.getBoardRect();
      const pos = getPixelPositionFromTouch(boardRect.position, e.touches[0]);
      const npos = this.toBoardPosition(boardRect.size, pos);
      o.touchStart(npos);

      e.stopPropagation();
      touchdown = true;
      setTimeout(() => {
        if (touchdown) {
          touchdown = false;
          o.touchStartLong(npos);
        }
      }, 600);
    };
    this.element.onmousemove = (e: MouseEvent) => {
      e.preventDefault();
      const boardRect = o.getBoardRect();
      const pos = getPixelPositionFromMouse(e);
      const npos = this.toBoardPosition(boardRect.size, pos);
      o.mouseMove(npos);
    };
    this.element.ontouchmove = (e: TouchEvent) => {
      touchdown = false;
      e.preventDefault();
      const boardRect = o.getBoardRect();
      const pos = getPixelPositionFromTouch(boardRect.position, e.touches[0]);
      const npos = this.toBoardPosition(boardRect.size, pos);
      o.touchMove(npos);
    };
    this.element.ontouchend = (e: TouchEvent) => {
      touchdown = false;
      e.preventDefault();
      const boardRect = o.getBoardRect();
      const pos = getPixelPositionFromTouch(
        boardRect.position,
        e.changedTouches[0]
      );
      const npos = this.toBoardPosition(boardRect.size, pos);
      o.touchEnd(npos);
    };
    const mouseUp = (e: MouseEvent) => {
      e.preventDefault();
      const boardRect = o.getBoardRect();
      const pos = getPixelPositionFromMouse(e);
      const npos = this.toBoardPosition(boardRect.size, pos);
      o.mouseUp(npos);
    };
    window.addEventListener("mouseup", mouseUp);
    return () => {
      this.element.ondblclick = null;
      this.element.onmousedown = null;
      this.element.ontouchstart = null;
      this.element.onmousemove = null;
      this.element.ontouchmove = null;
      this.element.ontouchend = null;
      window.removeEventListener("mouseup", mouseUp);
    };
  }
}

export class Input {
  private element: HTMLInputElement;
  constructor() {
    this.element = document.getElementById("input")! as HTMLInputElement;
  }
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
  private element: HTMLElement;
  constructor(options: BoardOptions) {
    this.element = document.getElementById("board-selector")!;
    this.element.setAttributeNS(
      null,
      "stroke-width",
      String(options.selectorStrokeWidth)
    );
  }
  setRectangle(rect: Rectangle): void {
    setRectangle(this.element, rect);
  }
  show(): void {
    setStroke(this.element, "red");
  }
  hide(): void {
    setStroke(this.element, "none");
  }
}

export class Help {
  constructor() {
    if (touchDevice) {
      document.getElementById("help-touch")!.classList.remove("hidden");
    } else {
      document.getElementById("help")!.classList.remove("hidden");
    }
  }
}
export class Shortcuts {
  private selectButton: HTMLElement;
  private deleteButton: HTMLElement;
  private undoButton: HTMLButtonElement;
  private redoButton: HTMLButtonElement;
  constructor() {
    this.selectButton = document.getElementById("select")!;
    this.deleteButton = document.getElementById("delete")!;
    this.undoButton = document.getElementById("undo")! as HTMLButtonElement;
    this.redoButton = document.getElementById("redo")! as HTMLButtonElement;
    if (touchDevice) {
      document.getElementById("shortcut-buttons")!.classList.remove("hidden");
    }
  }
  setSelectingReady(ready: boolean): void {
    if (ready) {
      this.selectButton.classList.remove("select");
    }
  }
  setSelecting(selecting: boolean): void {
    if (selecting) {
      this.selectButton.classList.add("hidden");
      this.deleteButton.classList.remove("hidden");
    } else {
      this.selectButton.classList.remove("hidden");
      this.deleteButton.classList.add("hidden");
    }
  }
  setUndoDisabled(disabled: boolean): void {
    this.undoButton.disabled = disabled;
  }
  setRedoDisabled(disabled: boolean): void {
    this.redoButton.disabled = disabled;
  }
}
