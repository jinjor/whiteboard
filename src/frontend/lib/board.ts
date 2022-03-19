import {
  Object_,
  ObjectId,
  Path,
  Position,
  Text,
  SessionUserId,
  SessionUser,
} from "../../schema";
import { testing } from "./debug";

type Size = { width: number; height: number };
export type PixelPosition = { px: number; py: number };
export class Rectangle {
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

type TextForSelect = {
  kind: "text";
  id: ObjectId;
  bbox: Rectangle;
  position: Position;
};
type PathForSelect = {
  kind: "path";
  id: ObjectId;
  bbox: Rectangle;
  points: Position[];
};
export type ObjectForSelect = TextForSelect | PathForSelect;
export type SelectedObject =
  | Omit<TextForSelect, "bbox">
  | Omit<PathForSelect, "bbox">;
export type UserEnvironment = {
  isMac: boolean;
  isTouchDevice: boolean;
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
function elementToObject(element: HTMLElement | SVGElement): Object_ | null {
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
function getBBox(element: HTMLElement | SVGElement): Rectangle {
  const { x, y, width, height } = (element as any).getBBox();
  return new Rectangle(x, y, width, height);
}
function getBBoxMock(object: Object_): Rectangle {
  switch (object.kind) {
    case "text": {
      return new Rectangle(object.position.x, object.position.y, 1, 1);
    }
    case "path": {
      const [x, y] = object.d
        .split("M")[1]
        .split("L")[0]
        .split(",")
        .map((s) => parseFloat(s));
      return new Rectangle(x, y, 1, 1);
    }
  }
}
function getText(element: HTMLElement | SVGElement): string {
  return element.textContent!;
}
function getPosition(element: HTMLElement | SVGElement): Position {
  return {
    x: parseFloat(element.getAttributeNS(null, "x")!),
    y: parseFloat(element.getAttributeNS(null, "y")!),
  };
}
function getD(element: HTMLElement | SVGElement): string {
  return element.getAttributeNS(null, "d")!;
}
function setRectangle(element: HTMLElement | SVGElement, rect: Rectangle) {
  setPosition(element, rect);
  setSize(element, rect);
}
function setPosition(element: HTMLElement | SVGElement, posision: Position) {
  element.setAttributeNS(null, "x", String(posision.x));
  element.setAttributeNS(null, "y", String(posision.y));
}
function setSize(element: HTMLElement | SVGElement, size: Size) {
  element.setAttributeNS(null, "width", String(size.width));
  element.setAttributeNS(null, "height", String(size.height));
}
function setD(element: HTMLElement | SVGElement, d: string) {
  element.setAttributeNS(null, "d", d);
}
function setStroke(element: HTMLElement | SVGElement, stroke: string) {
  element.setAttributeNS(null, "stroke", stroke);
}
function setSelected(element: HTMLElement | SVGElement, selected: boolean) {
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
function isObjectSelected(element: HTMLElement | SVGElement): boolean {
  switch (element.tagName) {
    case "text": {
      return element.getAttributeNS(null, "fill") === "red";
    }
    case "path": {
      return element.getAttributeNS(null, "stroke") === "red";
    }
  }
  return false;
}
function getStroke(element: HTMLElement | SVGElement): string | null {
  return element.getAttributeNS(null, "stroke");
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
  getFontSizeInPixel(boardSize: Size): number {
    const { width, height } = boardSize;
    const viewBoxWidth = this.options.viewBox.width;
    const viewBoxHeight = this.options.viewBox.height;
    const actualRatioPerExpectedRatio =
      width / height / (viewBoxWidth / viewBoxHeight);
    const scaleY = Math.max(1 / actualRatioPerExpectedRatio, 1);
    const fontSize = this.options.textFontSize;
    return (fontSize / viewBoxHeight / scaleY) * height;
  }
  toMovingCursor(): void {
    this.element.style.cursor = "move";
  }
  toDefaultCursor(): void {
    this.element.style.removeProperty("cursor");
  }
  upsertObject(object: Object_): void {
    switch (object.kind) {
      case "text": {
        return this.upsertText(object);
      }
      case "path": {
        return this.upsertPath(object);
      }
    }
  }
  upsertText(text: Text): void {
    const fontSize = this.options.textFontSize;
    let element = document.getElementById(text.id) as unknown as SVGTextElement;
    if (element == null) {
      element = createObjectElement("text", text.id);
      element.setAttributeNS(null, "dominant-baseline", "central");
      element.setAttributeNS(null, "font-size", String(fontSize));
    }
    element.textContent = text.text;
    element.setAttributeNS(null, "x", String(text.position.x));
    element.setAttributeNS(null, "y", String(text.position.y));
    this.element.append(element);
  }
  upsertPath(path: Path): void {
    const strokeWidth = this.options.pathStrokeWidth;
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
  updatePosition(id: ObjectId, pos: Position): void {
    const element = document.getElementById(id);
    if (element != null) {
      setPosition(element, pos);
    }
  }
  updateD(id: ObjectId, d: string): void {
    const element = document.getElementById(id);
    if (element != null) {
      setD(element, d);
    }
  }
  hasObject(id: ObjectId): boolean {
    return document.getElementById(id) != null;
  }
  getObject(id: ObjectId): Object_ | null {
    const element = document.getElementById(id);
    if (element == null) {
      return null;
    }
    return elementToObject(element);
  }
  private getAllObjectElements(): SVGElement[] {
    return document.getElementsByClassName("object") as unknown as SVGElement[];
  }
  getAllObjects(): Object_[] {
    const elements = this.getAllObjectElements();
    const objects = [];
    for (const element of elements) {
      const object = elementToObject(element);
      if (object != null) {
        objects.push(object);
      }
    }
    return objects;
  }
  getAllObjectsWithBoundingBox(): { object: Object_; bbox: Rectangle }[] {
    const elements = this.getAllObjectElements();
    const objects = [];
    for (const element of elements) {
      const object = elementToObject(element);
      if (object != null) {
        const bbox = testing() ? getBBoxMock(object) : getBBox(element);
        objects.push({ object, bbox });
      }
    }
    return objects;
  }
  getObjectWithBoundingBox(
    objectId: ObjectId
  ): { object: Object_; bbox: Rectangle } | null {
    const element = document.getElementById(objectId);
    if (element == null) {
      return null;
    }
    const object = elementToObject(element);
    if (object == null) {
      return null;
    }
    const bbox = testing() ? getBBoxMock(object) : getBBox(element);
    return { object, bbox };
  }
  setObjectSelected(id: ObjectId, selected: boolean): void {
    const element = document.getElementById(id)!;
    setSelected(element, selected);
  }
  getSelectedObjectIds(): ObjectId[] {
    const ids = [];
    for (const element of this.getAllObjectElements()) {
      if (isObjectSelected(element)) {
        ids.push(element.id);
      }
    }
    return ids;
  }
  patchObject(id: ObjectId, key: string, value: any): void {
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
  deleteObject(id: ObjectId): void {
    document.getElementById(id)?.remove();
  }
  listenToBoardEvents(o: {
    getBoardRect: () => { position: PixelPosition; size: Size };
    doubleClick: (pos: Position) => void;
    mouseDown: (pos: Position, isRight: boolean) => void;
    touchStart: (pos: Position) => void;
    touchStartLong: (pos: Position) => void;
    mouseMove: (pos: Position) => void;
    touchMove: (pos: Position) => void;
    mouseUp: (pos: Position) => void;
    touchEnd: (pos: Position) => void;
  }): () => void {
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
      const isRight = e.button !== 0;
      o.mouseDown(npos, isRight);
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
  private elementHeight: number;
  private elementFontSize = 14; // 縮尺の基準、なんでもいい
  constructor() {
    this.element = document.getElementById("input")! as HTMLInputElement;
    // フォントサイズを先に指定、一瞬表示して外枠のサイズを測る
    this.element.style.fontSize = `${this.elementFontSize}px`;
    this.element.classList.remove("hidden");
    this.elementHeight = this.element.getBoundingClientRect().height;
    this.element.classList.add("hidden");
  }
  getText(): string {
    return this.element.value;
  }
  setText(value: string): void {
    this.element.value = value;
  }
  setPosition(pos: PixelPosition, width: number, fontSizePx: number): void {
    const scale = fontSizePx / this.elementFontSize;
    this.element.style.left = `${pos.px}px`;
    this.element.style.top = `${pos.py - (this.elementHeight * scale) / 2}px`;
    this.element.style.width = `${width / scale}px`;
    this.element.style.transform = `scale(${scale})`;
  }
  showAndFocus(): void {
    this.element.classList.remove("hidden");
    this.element.focus();
  }
  hideAndReset(): void {
    this.element.value = "";
    this.element.classList.add("hidden");
    this.element.blur();
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
  isShown(): boolean {
    return getStroke(this.element) === "red";
  }
}

export class Help {
  constructor(env: UserEnvironment) {
    if (env.isTouchDevice) {
      document.getElementById("help-touch")!.classList.remove("hidden");
    } else {
      const helpElement = document.getElementById("help")!;
      helpElement.classList.remove("hidden");
      if (env.isMac) {
        helpElement.classList.add("mac");
      }
    }
  }
}
export class Shortcuts {
  private selectButton: HTMLElement;
  private deleteButton: HTMLElement;
  private undoButton: HTMLButtonElement;
  private redoButton: HTMLButtonElement;
  constructor(env: UserEnvironment) {
    this.selectButton = document.getElementById("select")!;
    this.deleteButton = document.getElementById("delete")!;
    this.undoButton = document.getElementById("undo")! as HTMLButtonElement;
    this.redoButton = document.getElementById("redo")! as HTMLButtonElement;
    if (env.isTouchDevice) {
      document.getElementById("shortcut-buttons")!.classList.remove("hidden");
    }
  }
  isSelectingReady(): boolean {
    return this.selectButton.classList.contains("select");
  }
  setSelectingReady(ready: boolean): void {
    if (ready) {
      this.selectButton.classList.add("select");
    } else {
      this.selectButton.classList.remove("select");
    }
  }
  isSelecting(): boolean {
    return this.selectButton.classList.contains("hidden");
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
  isUndoDisabled(): boolean {
    return this.undoButton.disabled;
  }
  setUndoDisabled(disabled: boolean): void {
    this.undoButton.disabled = disabled;
  }
  isRedoDisabled(): boolean {
    return this.redoButton.disabled;
  }
  setRedoDisabled(disabled: boolean): void {
    this.redoButton.disabled = disabled;
  }
  listenToButtons(o: {
    clickUndo: () => void;
    clickRedo: () => void;
    clickSelect: () => void;
    clickDelete: () => void;
  }): () => void {
    this.undoButton.onclick = () => {
      o.clickUndo();
    };
    this.redoButton.onclick = () => {
      o.clickRedo();
    };
    this.selectButton.onclick = () => {
      o.clickSelect();
    };
    this.deleteButton.onclick = () => {
      o.clickDelete();
    };
    return () => {
      this.undoButton.onclick = null;
      this.redoButton.onclick = null;
      this.selectButton.onclick = null;
      this.deleteButton.onclick = null;
    };
  }
}

export class NavBar {
  updateStatus(
    kind: "active" | "inactive" | "disconnected",
    title: string,
    reason?: string
  ): void {
    const buttonElement = document.getElementById("status-button")!;
    buttonElement.classList.remove("active", "inactive", "disconnected");
    buttonElement.classList.add(kind);
    buttonElement.classList.remove("hidden");
    buttonElement.textContent = title;

    const reasonElement = document.getElementById("status-reason")!;
    if (reason != null) {
      reasonElement.textContent = reason;
      reasonElement.classList.remove("hidden");
    } else {
      reasonElement.classList.add("hidden");
      reasonElement.textContent = "";
    }
  }
  addMember(member: SessionUser, self: boolean): void {
    const membersEl = document.getElementById("members")!;
    let element = document.getElementById(member.id);
    if (element != null) {
      return;
    }
    element = document.createElement("div");
    membersEl.append(element);
    element.id = member.id;
    element.classList.add("member");
    if (self) {
      element.classList.add("self");
    }
    if (member.image != null) {
      element.style.backgroundImage = `url(${member.image})`;
      element.style.backgroundSize = "cover";
    } else {
      element.textContent = member.name.slice(0, 2);
    }
    const selfEl = document.querySelector(".member.self");
    if (selfEl != null) {
      membersEl.append(selfEl);
    }
  }
  deleteMember(member: SessionUserId): void {
    document.getElementById(member)?.remove();
  }
}
