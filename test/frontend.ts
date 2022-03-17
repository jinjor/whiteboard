import * as assert from "assert";
import { JSDOM } from "jsdom";
import { API } from "../src/frontend/lib/api";
import {
  update,
  createState,
  ApplicationEvent,
  State,
} from "../src/frontend/logic";
import { ObjectId, Position, RequestEventBody } from "../src/schema";
import * as fs from "fs";
import * as path from "path";
const html = fs.readFileSync(
  path.resolve(__dirname, "../../../src/frontend/room.html"),
  "utf8"
);
describe("frontend", () => {
  beforeEach(() => {
    const dom = new JSDOM(html, { url: "http://example.com/rooms/a" });
    (global as any).window = dom.window;
    global.document = dom.window.document;
    global.WebSocket = dom.window.WebSocket;
  });
  it("creates websocket at initialization", async () => {
    const trace: number[] = [];
    const state = createState({
      getRoomInfo: async () => {
        trace.push(1);
        return {
          id: "a",
          active: true,
          createdAt: Date.now(),
          activeUntil: Date.now() + 1000,
          aliveUntil: Date.now() + 2000,
        };
      },
      getObjects: async () => {
        throw new Error();
      },
      createRoom: async () => {
        throw new Error();
      },
      createWebsocket: (wsRoot: string, roomId: string) => {
        assert.strictEqual(roomId, "a");
        trace.push(2);
        return new WebSocket(`${wsRoot}/api/rooms/${roomId}/websocket`);
      },
      send: () => {
        throw new Error();
      },
    });
    await update({ kind: "room:init" }, state, () => {});
    assert.deepStrictEqual(trace, [1, 2]);
  });
  it("get objects if room is not active", async () => {
    const trace: number[] = [];
    const state = createState({
      getRoomInfo: async () => {
        trace.push(1);
        return {
          id: "a",
          active: false,
          createdAt: Date.now(),
          activeUntil: Date.now() - 1000,
          aliveUntil: Date.now() + 1000,
        };
      },
      getObjects: async () => {
        trace.push(2);
        return {};
      },
      createRoom: async () => {
        throw new Error();
      },
      createWebsocket: (wsRoot: string, roomId: string) => {
        throw new Error();
      },
      send: () => {
        throw new Error();
      },
    });
    await update({ kind: "room:init" }, state, () => {});
    assert.deepStrictEqual(trace, [1, 2]);
  });
  it("creates a path", async () => {
    const requests: RequestEventBody[] = [];
    const api = apiForActiveRoom((e) => requests.push(e));
    const state = createState(api);
    const effect = () => {};
    const u = (e: ApplicationEvent) => update(e, state, effect);
    await u({ kind: "room:init" });
    await u({ kind: "ws:open", websocket: new WebSocket(`ws://dummy`) });
    await u({
      kind: "board:mouse_down",
      position: { x: 0, y: 0 },
      isRight: false,
    });
    await u({ kind: "board:mouse_move", position: { x: 1, y: 1 } });
    await u({ kind: "board:mouse_up", position: { x: 1, y: 1 } });
    const objects = state.board.getAllObjects();
    assert.strictEqual(objects.length, 1);
    const object = objects[0];
    assert.ok(object.kind === "path");
    assert.strictEqual(object.d, "M0.0000,0.0000L1.0000,1.0000");
    assert.deepStrictEqual(requests, [{ kind: "add", object }]);
  });
  it("creates a path (touch device)", async () => {
    const requests: RequestEventBody[] = [];
    const api = apiForActiveRoom((e) => requests.push(e));
    const state = createState(api);
    const effect = () => {};
    const u = (e: ApplicationEvent) => update(e, state, effect);
    await u({ kind: "room:init" });
    await u({ kind: "ws:open", websocket: new WebSocket(`ws://dummy`) });
    await u({ kind: "board:touch_start", position: { x: 0, y: 0 } });
    await u({ kind: "board:touch_move", position: { x: 1, y: 1 } });
    await u({ kind: "board:touch_end", position: { x: 1, y: 1 } });
    const objects = state.board.getAllObjects();
    assert.strictEqual(objects.length, 1);
    const object = objects[0];
    assert.ok(object.kind === "path");
    assert.strictEqual(object.d, "M0.0000,0.0000L1.0000,1.0000");
    assert.deepStrictEqual(requests, [{ kind: "add", object }]);
  });
  it("creates a text", async () => {
    const requests: RequestEventBody[] = [];
    const api = apiForActiveRoom((e) => requests.push(e));
    const state = createState(api);
    const effect = () => {};
    const u = (e: ApplicationEvent) => update(e, state, effect);
    await u({ kind: "room:init" });
    await u({ kind: "ws:open", websocket: new WebSocket(`ws://dummy`) });
    await u({ kind: "board:double_click", position: { x: 0, y: 0 } });
    state.input.setText("foo");
    await u({ kind: "input:enter" });
    const objects = state.board.getAllObjects();
    assert.strictEqual(objects.length, 1);
    const object = objects[0];
    assert.ok(object.kind === "text");
    assert.strictEqual(object.text, "foo");
    assert.deepStrictEqual(object.position, { x: 0, y: 0 });
    assert.deepStrictEqual(requests, [{ kind: "add", object }]);
  });
  it("creates a text (touch device)", async () => {
    const requests: RequestEventBody[] = [];
    const api = apiForActiveRoom((e) => requests.push(e));
    const state = createState(api);
    const effect = () => {};
    const u = (e: ApplicationEvent) => update(e, state, effect);
    await u({ kind: "room:init" });
    await u({ kind: "ws:open", websocket: new WebSocket(`ws://dummy`) });
    await u({ kind: "board:touch_start_long", position: { x: 0, y: 0 } });
    state.input.setText("foo");
    await u({ kind: "input:enter" });
    const objects = state.board.getAllObjects();
    assert.strictEqual(objects.length, 1);
    const object = objects[0];
    assert.ok(object.kind === "text");
    assert.strictEqual(object.text, "foo");
    assert.deepStrictEqual(object.position, { x: 0, y: 0 });
    assert.deepStrictEqual(requests, [{ kind: "add", object }]);
  });
  it("moves a path", async () => {
    const requests: RequestEventBody[] = [];
    const api = apiForActiveRoom((e) => requests.push(e));
    const state = createState(api);
    const effect = () => {};
    const u = (e: ApplicationEvent) => update(e, state, effect);
    await u({ kind: "room:init" });
    await u({ kind: "ws:open", websocket: new WebSocket(`ws://dummy`) });
    await drawLine(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    await u({
      kind: "board:mouse_down",
      position: { x: 0, y: 0 },
      isRight: true,
    });
    await u({ kind: "board:mouse_move", position: { x: 1, y: 1 } });
    assert.strictEqual(state.selector.isShown(), true);
    assert.strictEqual(state.selected.length, 1);
    assert.strictEqual(state.board.getSelectedObjectIds().length, 1);
    await u({ kind: "board:mouse_up", position: { x: 1, y: 1 } });
    assert.strictEqual(state.selector.isShown(), false);
    await u({
      kind: "board:mouse_down",
      position: { x: 10, y: 10 },
      isRight: false,
    });
    await u({ kind: "board:mouse_move", position: { x: 12, y: 13 } });
    await u({ kind: "board:mouse_up", position: { x: 12, y: 13 } });
    const objects = state.board.getAllObjects();
    assert.strictEqual(objects.length, 1);
    const object = objects[0];
    assert.ok(object.kind === "path");
    assert.strictEqual(object.d, "M2.0000,3.0000L3.0000,4.0000");
    assert.deepStrictEqual(requests[1], {
      kind: "patch",
      id: object.id,
      key: "d",
      value: {
        old: "M0.0000,0.0000L1.0000,1.0000",
        new: "M2.0000,3.0000L3.0000,4.0000",
      },
    });
  });
  it("moves a path (touch device)", async () => {
    const requests: RequestEventBody[] = [];
    const api = apiForActiveRoom((e) => requests.push(e));
    const state = createState(api);
    const effect = () => {};
    const u = (e: ApplicationEvent) => update(e, state, effect);
    await u({ kind: "room:init" });
    await u({ kind: "ws:open", websocket: new WebSocket(`ws://dummy`) });
    await drawLineTouch(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    await u({ kind: "shortcut_button:select" });
    assert.strictEqual(state.shortcuts.isSelectingReady(), true);
    await u({ kind: "board:touch_start", position: { x: 0, y: 0 } });
    await u({ kind: "board:touch_move", position: { x: 1, y: 1 } });
    assert.strictEqual(state.selector.isShown(), true);
    assert.strictEqual(state.selected.length, 1);
    assert.strictEqual(state.board.getSelectedObjectIds().length, 1);
    await u({ kind: "board:touch_end", position: { x: 1, y: 1 } });
    assert.strictEqual(state.shortcuts.isSelectingReady(), false);
    assert.strictEqual(state.shortcuts.isSelecting(), true);
    assert.strictEqual(state.selector.isShown(), false);
    await u({
      kind: "board:touch_start",
      position: { x: 10, y: 10 },
    });
    await u({ kind: "board:touch_move", position: { x: 12, y: 13 } });
    await u({ kind: "board:touch_end", position: { x: 12, y: 13 } });
    assert.strictEqual(state.shortcuts.isSelecting(), false);
    const objects = state.board.getAllObjects();
    assert.strictEqual(objects.length, 1);
    const object = objects[0];
    assert.ok(object.kind === "path");
    assert.strictEqual(object.d, "M2.0000,3.0000L3.0000,4.0000");
    assert.deepStrictEqual(requests[1], {
      kind: "patch",
      id: object.id,
      key: "d",
      value: {
        old: "M0.0000,0.0000L1.0000,1.0000",
        new: "M2.0000,3.0000L3.0000,4.0000",
      },
    });
  });
  it("moves a text", async () => {
    const requests: RequestEventBody[] = [];
    const api = apiForActiveRoom((e) => requests.push(e));
    const state = createState(api);
    const effect = () => {};
    const u = (e: ApplicationEvent) => update(e, state, effect);
    await u({ kind: "room:init" });
    await u({ kind: "ws:open", websocket: new WebSocket(`ws://dummy`) });
    await addText(u, state, { x: 0, y: 0 }, "foo");
    await u({
      kind: "board:mouse_down",
      position: { x: 0, y: 0 },
      isRight: true,
    });
    await u({ kind: "board:mouse_move", position: { x: 1, y: 1 } });
    assert.strictEqual(state.selector.isShown(), true);
    assert.strictEqual(state.selected.length, 1);
    assert.strictEqual(state.board.getSelectedObjectIds().length, 1);
    await u({ kind: "board:mouse_up", position: { x: 1, y: 1 } });
    assert.strictEqual(state.selector.isShown(), false);
    await u({
      kind: "board:mouse_down",
      position: { x: 10, y: 10 },
      isRight: false,
    });
    await u({ kind: "board:mouse_move", position: { x: 12, y: 13 } });
    await u({ kind: "board:mouse_up", position: { x: 12, y: 13 } });
    const objects = state.board.getAllObjects();
    assert.strictEqual(objects.length, 1);
    const object = objects[0];
    assert.ok(object.kind === "text");
    assert.deepStrictEqual(object.position, { x: 2, y: 3 });
    assert.deepStrictEqual(requests[1], {
      kind: "patch",
      id: object.id,
      key: "position",
      value: { old: { x: 0, y: 0 }, new: { x: 2, y: 3 } },
    });
  });
  it("moves a text (touch device)", async () => {
    const requests: RequestEventBody[] = [];
    const api = apiForActiveRoom((e) => requests.push(e));
    const state = createState(api);
    const effect = () => {};
    const u = (e: ApplicationEvent) => update(e, state, effect);
    await u({ kind: "room:init" });
    await u({ kind: "ws:open", websocket: new WebSocket(`ws://dummy`) });
    await addText(u, state, { x: 0, y: 0 }, "foo");
    await u({ kind: "shortcut_button:select" });
    assert.strictEqual(state.shortcuts.isSelectingReady(), true);
    await u({ kind: "board:touch_start", position: { x: 0, y: 0 } });
    await u({ kind: "board:touch_move", position: { x: 1, y: 1 } });
    assert.strictEqual(state.selector.isShown(), true);
    assert.strictEqual(state.selected.length, 1);
    assert.strictEqual(state.board.getSelectedObjectIds().length, 1);
    assert.strictEqual(state.shortcuts.isSelecting(), false);
    await u({ kind: "board:touch_end", position: { x: 1, y: 1 } });
    assert.strictEqual(state.shortcuts.isSelectingReady(), false);
    assert.strictEqual(state.shortcuts.isSelecting(), true);
    assert.strictEqual(state.selector.isShown(), false);
    await u({ kind: "board:touch_start", position: { x: 10, y: 10 } });
    await u({ kind: "board:touch_move", position: { x: 12, y: 13 } });
    await u({ kind: "board:touch_end", position: { x: 12, y: 13 } });
    const objects = state.board.getAllObjects();
    assert.strictEqual(objects.length, 1);
    const object = objects[0];
    assert.ok(object.kind === "text");
    assert.deepStrictEqual(object.position, { x: 2, y: 3 });
    assert.deepStrictEqual(requests[1], {
      kind: "patch",
      id: object.id,
      key: "position",
      value: { old: { x: 0, y: 0 }, new: { x: 2, y: 3 } },
    });
  });
  it("does not add objects if websocket is disconnected", async () => {
    const requests: RequestEventBody[] = [];
    const api = apiForActiveRoom((e) => requests.push(e));
    const state = createState(api);
    const effect = () => {};
    const u = (e: ApplicationEvent) => update(e, state, effect);
    await u({ kind: "room:init" });
    {
      await u({
        kind: "board:mouse_down",
        position: { x: 0, y: 0 },
        isRight: false,
      });
      await u({ kind: "board:mouse_move", position: { x: 1, y: 1 } });
      assert.deepStrictEqual(state.board.getAllObjects(), []);
      await u({ kind: "board:mouse_up", position: { x: 1, y: 1 } });
    }
    {
      await u({ kind: "board:touch_start", position: { x: 0, y: 0 } });
      await u({ kind: "board:touch_move", position: { x: 1, y: 1 } });
      assert.deepStrictEqual(state.board.getAllObjects(), []);
      await u({ kind: "board:touch_end", position: { x: 1, y: 1 } });
    }
    {
      await u({ kind: "board:double_click", position: { x: 0, y: 0 } });
      state.input.setText("foo");
      await u({ kind: "input:enter" });
    }
    {
      await u({ kind: "board:touch_start_long", position: { x: 0, y: 0 } });
      state.input.setText("foo");
      await u({ kind: "input:enter" });
    }
    const objects = state.board.getAllObjects();
    assert.deepStrictEqual(objects, []);
    assert.deepStrictEqual(requests, []);
  });
  it("does not add objects if websocket is disconnected (while editing)", async () => {
    const requests: RequestEventBody[] = [];
    const api = apiForActiveRoom((e) => requests.push(e));
    const state = createState(api);
    const effect = () => {};
    const u = (e: ApplicationEvent) => update(e, state, effect);
    await u({ kind: "room:init" });
    {
      await u({ kind: "ws:open", websocket: new WebSocket(`ws://dummy`) });
      await u({
        kind: "board:mouse_down",
        position: { x: 0, y: 0 },
        isRight: false,
      });
      await u({ kind: "board:mouse_move", position: { x: 1, y: 1 } });
      await u({ kind: "ws:close", code: 1000, reason: "" });
      assert.deepStrictEqual(state.board.getAllObjects(), []);
      await u({ kind: "board:mouse_up", position: { x: 1, y: 1 } });
    }
    {
      await u({ kind: "ws:open", websocket: new WebSocket(`ws://dummy`) });
      await u({ kind: "board:touch_start", position: { x: 0, y: 0 } });
      await u({ kind: "board:touch_move", position: { x: 1, y: 1 } });
      await u({ kind: "ws:close", code: 1000, reason: "" });
      assert.deepStrictEqual(state.board.getAllObjects(), []);
      await u({ kind: "board:touch_end", position: { x: 1, y: 1 } });
    }
    {
      await u({ kind: "ws:open", websocket: new WebSocket(`ws://dummy`) });
      await u({ kind: "board:double_click", position: { x: 0, y: 0 } });
      state.input.setText("foo");
      await u({ kind: "ws:close", code: 1000, reason: "" });
      await u({ kind: "input:enter" });
    }
    {
      await u({ kind: "ws:open", websocket: new WebSocket(`ws://dummy`) });
      await u({ kind: "board:touch_start_long", position: { x: 0, y: 0 } });
      state.input.setText("foo");
      await u({ kind: "ws:close", code: 1000, reason: "" });
      await u({ kind: "input:enter" });
    }
    const objects = state.board.getAllObjects();
    assert.deepStrictEqual(objects, []);
    assert.deepStrictEqual(requests, []);
  });
  it("does not move objects if websocket is disconnected", async () => {
    const requests: RequestEventBody[] = [];
    const api = apiForActiveRoom((e) => requests.push(e));
    const state = createState(api);
    const effect = () => {};
    const u = (e: ApplicationEvent) => update(e, state, effect);
    await u({ kind: "room:init" });
    await u({ kind: "ws:open", websocket: new WebSocket(`ws://dummy`) });
    await drawLine(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    await addText(u, state, { x: 0, y: 0 }, "foo");
    const objects = state.board.getAllObjects();
    requests.length = 0;
    await u({ kind: "ws:close", code: 1000, reason: "" });
    await u({
      kind: "board:mouse_down",
      position: { x: 0, y: 0 },
      isRight: true,
    });
    await u({ kind: "board:mouse_move", position: { x: 1, y: 1 } });
    assert.strictEqual(state.selector.isShown(), false);
    assert.strictEqual(state.selected.length, 0);
    assert.strictEqual(state.board.getSelectedObjectIds().length, 0);
    await u({ kind: "board:mouse_up", position: { x: 1, y: 1 } });
    assert.strictEqual(state.selected.length, 0);
    assert.strictEqual(state.board.getSelectedObjectIds().length, 0);
    await u({
      kind: "board:mouse_down",
      position: { x: 10, y: 10 },
      isRight: false,
    });
    await u({ kind: "board:mouse_move", position: { x: 12, y: 13 } });
    await u({ kind: "board:mouse_up", position: { x: 12, y: 13 } });
    for (const object of objects) {
      assert.deepStrictEqual(object, state.board.getObject(object.id));
    }
    assert.deepStrictEqual(requests, []);
  });
  it("does not move objects if websocket is disconnected (while moving)", async () => {
    const requests: RequestEventBody[] = [];
    const api = apiForActiveRoom((e) => requests.push(e));
    const state = createState(api);
    const effect = () => {};
    const u = (e: ApplicationEvent) => update(e, state, effect);
    await u({ kind: "room:init" });
    await u({ kind: "ws:open", websocket: new WebSocket(`ws://dummy`) });
    await drawLine(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    await addText(u, state, { x: 0, y: 0 }, "foo");
    const objects = state.board.getAllObjects();
    requests.length = 0;
    await select(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    await u({
      kind: "board:mouse_down",
      position: { x: 10, y: 10 },
      isRight: false,
    });
    await u({ kind: "board:mouse_move", position: { x: 12, y: 13 } });
    await u({ kind: "ws:close", code: 1000, reason: "" });
    assert.strictEqual(state.selector.isShown(), false);
    assert.deepStrictEqual(state.selected.length, 0);
    assert.strictEqual(state.board.getSelectedObjectIds().length, 0);
    for (const object of objects) {
      assert.deepStrictEqual(object, state.board.getObject(object.id));
    }
    await u({ kind: "board:mouse_up", position: { x: 12, y: 13 } });
    assert.deepStrictEqual(requests, []);
  });
  it("cancel selection if websocket is disconnected (white selecting)", async () => {
    const requests: RequestEventBody[] = [];
    const api = apiForActiveRoom((e) => requests.push(e));
    const state = createState(api);
    const effect = () => {};
    const u = (e: ApplicationEvent) => update(e, state, effect);
    await u({ kind: "room:init" });
    await u({ kind: "ws:open", websocket: new WebSocket(`ws://dummy`) });
    await drawLine(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    await addText(u, state, { x: 0, y: 0 }, "foo");
    requests.length = 0;
    await u({
      kind: "board:mouse_down",
      position: { x: 0, y: 0 },
      isRight: true,
    });
    await u({ kind: "board:mouse_move", position: { x: 1, y: 1 } });
    assert.strictEqual(state.selector.isShown(), true);
    assert.strictEqual(state.selected.length, 2);
    assert.strictEqual(state.board.getSelectedObjectIds().length, 2);
    await u({ kind: "ws:close", code: 1000, reason: "" });
    assert.strictEqual(state.selector.isShown(), false);
    assert.strictEqual(state.selected.length, 0);
    assert.strictEqual(state.board.getSelectedObjectIds().length, 0);
    await u({ kind: "board:mouse_up", position: { x: 1, y: 1 } });
    assert.strictEqual(state.selected.length, 0);
    assert.strictEqual(state.board.getSelectedObjectIds().length, 0);
  });
  it("cancel selection if websocket is disconnected (after selecting)", async () => {
    const requests: RequestEventBody[] = [];
    const api = apiForActiveRoom((e) => requests.push(e));
    const state = createState(api);
    const effect = () => {};
    const u = (e: ApplicationEvent) => update(e, state, effect);
    await u({ kind: "room:init" });
    await u({ kind: "ws:open", websocket: new WebSocket(`ws://dummy`) });
    await drawLine(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    await addText(u, state, { x: 0, y: 0 }, "foo");
    requests.length = 0;
    await select(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    assert.strictEqual(state.selector.isShown(), false);
    assert.strictEqual(state.selected.length, 2);
    assert.strictEqual(state.board.getSelectedObjectIds().length, 2);
    await u({ kind: "ws:close", code: 1000, reason: "" });
    assert.strictEqual(state.selector.isShown(), false);
    assert.strictEqual(state.selected.length, 0);
    assert.strictEqual(state.board.getSelectedObjectIds().length, 0);
  });
  it("deletes a path", async () => {
    const requests: RequestEventBody[] = [];
    const api = apiForActiveRoom((e) => requests.push(e));
    const state = createState(api);
    const effect = () => {};
    const u = (e: ApplicationEvent) => update(e, state, effect);
    await u({ kind: "room:init" });
    await u({ kind: "ws:open", websocket: new WebSocket(`ws://dummy`) });
    await drawLine(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    await select(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    assert.strictEqual(state.selector.isShown(), false);
    assert.strictEqual(state.selected.length, 1);
    assert.strictEqual(state.board.getSelectedObjectIds().length, 1);
    const objects = state.board.getAllObjects();
    assert.strictEqual(objects.length, 1);
    const object = objects[0];
    await u({ kind: "key:delete" });
    assert.strictEqual(state.selected.length, 0);
    assert.strictEqual(state.board.getSelectedObjectIds().length, 0);
    assert.deepStrictEqual(requests[1], { kind: "delete", object });
  });
  it("deletes a path (touch device)", async () => {
    const requests: RequestEventBody[] = [];
    const api = apiForActiveRoom((e) => requests.push(e));
    const state = createState(api);
    const effect = () => {};
    const u = (e: ApplicationEvent) => update(e, state, effect);
    await u({ kind: "room:init" });
    await u({ kind: "ws:open", websocket: new WebSocket(`ws://dummy`) });
    await drawLineTouch(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    await selectTouch(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    assert.strictEqual(state.selector.isShown(), false);
    assert.strictEqual(state.selected.length, 1);
    assert.strictEqual(state.board.getSelectedObjectIds().length, 1);
    const objects = state.board.getAllObjects();
    assert.strictEqual(objects.length, 1);
    const object = objects[0];
    await u({ kind: "shortcut_button:delete" });
    assert.strictEqual(state.selected.length, 0);
    assert.strictEqual(state.board.getSelectedObjectIds().length, 0);
    assert.deepStrictEqual(requests[1], { kind: "delete", object });
  });
  it("deletes a text", async () => {
    const requests: RequestEventBody[] = [];
    const api = apiForActiveRoom((e) => requests.push(e));
    const state = createState(api);
    const effect = () => {};
    const u = (e: ApplicationEvent) => update(e, state, effect);
    await u({ kind: "room:init" });
    await u({ kind: "ws:open", websocket: new WebSocket(`ws://dummy`) });
    await addText(u, state, { x: 0, y: 0 }, "foo");
    await select(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    assert.strictEqual(state.selector.isShown(), false);
    assert.strictEqual(state.selected.length, 1);
    assert.strictEqual(state.board.getSelectedObjectIds().length, 1);
    const objects = state.board.getAllObjects();
    assert.strictEqual(objects.length, 1);
    const object = objects[0];
    await u({ kind: "key:delete" });
    assert.strictEqual(state.selected.length, 0);
    assert.strictEqual(state.board.getSelectedObjectIds().length, 0);
    assert.deepStrictEqual(requests[1], { kind: "delete", object });
  });
  it("deletes a text (touch device)", async () => {
    const requests: RequestEventBody[] = [];
    const api = apiForActiveRoom((e) => requests.push(e));
    const state = createState(api);
    const effect = () => {};
    const u = (e: ApplicationEvent) => update(e, state, effect);
    await u({ kind: "room:init" });
    await u({ kind: "ws:open", websocket: new WebSocket(`ws://dummy`) });
    await addTextTouch(u, state, { x: 0, y: 0 }, "foo");
    await selectTouch(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    assert.strictEqual(state.selector.isShown(), false);
    assert.strictEqual(state.selected.length, 1);
    assert.strictEqual(state.board.getSelectedObjectIds().length, 1);
    const objects = state.board.getAllObjects();
    assert.strictEqual(objects.length, 1);
    const object = objects[0];
    await u({ kind: "shortcut_button:delete" });
    assert.strictEqual(state.selected.length, 0);
    assert.strictEqual(state.board.getSelectedObjectIds().length, 0);
    assert.deepStrictEqual(requests[1], { kind: "delete", object });
  });
  const undoTextExpected = (id: ObjectId) => [
    {
      kind: "add",
      object: {
        id,
        kind: "text",
        position: { x: 0, y: 0 },
        text: "foo",
      },
    },
    {
      kind: "patch",
      id,
      key: "position",
      value: { old: { x: 0, y: 0 }, new: { x: 1, y: 1 } },
    },
    {
      kind: "delete",
      object: {
        id,
        kind: "text",
        position: { x: 1, y: 1 },
        text: "foo",
      },
    },
    {
      kind: "add",
      object: {
        id,
        kind: "text",
        position: { x: 1, y: 1 },
        text: "foo",
      },
    },
    {
      kind: "patch",
      id,
      key: "position",
      value: { old: { x: 1, y: 1 }, new: { x: 0, y: 0 } },
    },
    {
      kind: "delete",
      object: {
        id,
        kind: "text",
        position: { x: 0, y: 0 },
        text: "foo",
      },
    },
    {
      kind: "add",
      object: {
        id,
        kind: "text",
        position: { x: 0, y: 0 },
        text: "foo",
      },
    },
    {
      kind: "patch",
      id,
      key: "position",
      value: { old: { x: 0, y: 0 }, new: { x: 1, y: 1 } },
    },
    {
      kind: "delete",
      object: {
        id,
        kind: "text",
        position: { x: 1, y: 1 },
        text: "foo",
      },
    },
  ];
  it("do undo/redo text", async () => {
    const requests: RequestEventBody[] = [];
    const api = apiForActiveRoom((e) => requests.push(e));
    const state = createState(api);
    const effect = () => {};
    const u = (e: ApplicationEvent) => update(e, state, effect);
    await u({ kind: "room:init" });
    await u({ kind: "ws:open", websocket: new WebSocket(`ws://dummy`) });
    assert.strictEqual(state.shortcuts.isUndoDisabled(), true);
    assert.strictEqual(state.shortcuts.isRedoDisabled(), true);
    await addText(u, state, { x: 0, y: 0 }, "foo");
    assert.strictEqual(state.shortcuts.isUndoDisabled(), false);
    assert.strictEqual(state.shortcuts.isRedoDisabled(), true);
    const id = state.board.getAllObjects()[0].id;
    await select(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    await move(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    assert.strictEqual(state.shortcuts.isUndoDisabled(), false);
    assert.strictEqual(state.shortcuts.isRedoDisabled(), true);
    await select(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    await u({ kind: "key:delete" });
    assert.strictEqual(state.shortcuts.isUndoDisabled(), false);
    assert.strictEqual(state.shortcuts.isRedoDisabled(), true);
    await u({ kind: "key:undo" });
    assert.strictEqual(state.shortcuts.isUndoDisabled(), false);
    assert.strictEqual(state.shortcuts.isRedoDisabled(), false);
    await u({ kind: "key:undo" });
    assert.strictEqual(state.shortcuts.isUndoDisabled(), false);
    assert.strictEqual(state.shortcuts.isRedoDisabled(), false);
    await u({ kind: "key:undo" });
    assert.strictEqual(state.shortcuts.isUndoDisabled(), true);
    assert.strictEqual(state.shortcuts.isRedoDisabled(), false);
    await u({ kind: "key:redo" });
    assert.strictEqual(state.shortcuts.isUndoDisabled(), false);
    assert.strictEqual(state.shortcuts.isRedoDisabled(), false);
    await u({ kind: "key:redo" });
    assert.strictEqual(state.shortcuts.isUndoDisabled(), false);
    assert.strictEqual(state.shortcuts.isRedoDisabled(), false);
    await u({ kind: "key:redo" });
    assert.strictEqual(state.shortcuts.isUndoDisabled(), false);
    assert.strictEqual(state.shortcuts.isRedoDisabled(), true);
    assert.deepStrictEqual(requests, undoTextExpected(id));
  });
  it("do undo/redo text (touch device)", async () => {
    const requests: RequestEventBody[] = [];
    const api = apiForActiveRoom((e) => requests.push(e));
    const state = createState(api);
    const effect = () => {};
    const u = (e: ApplicationEvent) => update(e, state, effect);
    await u({ kind: "room:init" });
    await u({ kind: "ws:open", websocket: new WebSocket(`ws://dummy`) });
    assert.strictEqual(state.shortcuts.isUndoDisabled(), true);
    assert.strictEqual(state.shortcuts.isRedoDisabled(), true);
    await addTextTouch(u, state, { x: 0, y: 0 }, "foo");
    assert.strictEqual(state.shortcuts.isUndoDisabled(), false);
    assert.strictEqual(state.shortcuts.isRedoDisabled(), true);
    const id = state.board.getAllObjects()[0].id;
    await selectTouch(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    await moveTouch(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    assert.strictEqual(state.shortcuts.isUndoDisabled(), false);
    assert.strictEqual(state.shortcuts.isRedoDisabled(), true);
    await selectTouch(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    await u({ kind: "shortcut_button:delete" });
    assert.strictEqual(state.shortcuts.isUndoDisabled(), false);
    assert.strictEqual(state.shortcuts.isRedoDisabled(), true);
    await u({ kind: "shortcut_button:undo" });
    assert.strictEqual(state.shortcuts.isUndoDisabled(), false);
    assert.strictEqual(state.shortcuts.isRedoDisabled(), false);
    await u({ kind: "shortcut_button:undo" });
    assert.strictEqual(state.shortcuts.isUndoDisabled(), false);
    assert.strictEqual(state.shortcuts.isRedoDisabled(), false);
    await u({ kind: "shortcut_button:undo" });
    assert.strictEqual(state.shortcuts.isUndoDisabled(), true);
    assert.strictEqual(state.shortcuts.isRedoDisabled(), false);
    await u({ kind: "shortcut_button:redo" });
    assert.strictEqual(state.shortcuts.isUndoDisabled(), false);
    assert.strictEqual(state.shortcuts.isRedoDisabled(), false);
    await u({ kind: "shortcut_button:redo" });
    assert.strictEqual(state.shortcuts.isUndoDisabled(), false);
    assert.strictEqual(state.shortcuts.isRedoDisabled(), false);
    await u({ kind: "shortcut_button:redo" });
    assert.strictEqual(state.shortcuts.isUndoDisabled(), false);
    assert.strictEqual(state.shortcuts.isRedoDisabled(), true);
    assert.deepStrictEqual(requests, undoTextExpected(id));
  });
  const undoPathExpected = (id: ObjectId) => [
    {
      kind: "add",
      object: {
        id,
        kind: "path",
        d: "M0.0000,0.0000L1.0000,1.0000",
      },
    },
    {
      kind: "patch",
      id,
      key: "d",
      value: {
        old: "M0.0000,0.0000L1.0000,1.0000",
        new: "M1.0000,1.0000L2.0000,2.0000",
      },
    },
    {
      kind: "delete",
      object: {
        id,
        kind: "path",
        d: "M1.0000,1.0000L2.0000,2.0000",
      },
    },
    {
      kind: "add",
      object: {
        id,
        kind: "path",
        d: "M1.0000,1.0000L2.0000,2.0000",
      },
    },
    {
      kind: "patch",
      id,
      key: "d",
      value: {
        old: "M1.0000,1.0000L2.0000,2.0000",
        new: "M0.0000,0.0000L1.0000,1.0000",
      },
    },
    {
      kind: "delete",
      object: {
        id,
        kind: "path",
        d: "M0.0000,0.0000L1.0000,1.0000",
      },
    },
    {
      kind: "add",
      object: {
        id,
        kind: "path",
        d: "M0.0000,0.0000L1.0000,1.0000",
      },
    },
    {
      kind: "patch",
      id,
      key: "d",
      value: {
        old: "M0.0000,0.0000L1.0000,1.0000",
        new: "M1.0000,1.0000L2.0000,2.0000",
      },
    },
    {
      kind: "delete",
      object: {
        id,
        kind: "path",
        d: "M1.0000,1.0000L2.0000,2.0000",
      },
    },
  ];
  it("do undo/redo path", async () => {
    const requests: RequestEventBody[] = [];
    const api = apiForActiveRoom((e) => requests.push(e));
    const state = createState(api);
    const effect = () => {};
    const u = (e: ApplicationEvent) => update(e, state, effect);
    await u({ kind: "room:init" });
    await u({ kind: "ws:open", websocket: new WebSocket(`ws://dummy`) });
    assert.strictEqual(state.shortcuts.isUndoDisabled(), true);
    assert.strictEqual(state.shortcuts.isRedoDisabled(), true);
    await drawLine(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    assert.strictEqual(state.shortcuts.isUndoDisabled(), false);
    assert.strictEqual(state.shortcuts.isRedoDisabled(), true);
    const id = state.board.getAllObjects()[0].id;
    await select(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    await move(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    assert.strictEqual(state.shortcuts.isUndoDisabled(), false);
    assert.strictEqual(state.shortcuts.isRedoDisabled(), true);
    await select(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    await u({ kind: "key:delete" });
    assert.strictEqual(state.shortcuts.isUndoDisabled(), false);
    assert.strictEqual(state.shortcuts.isRedoDisabled(), true);
    await u({ kind: "key:undo" });
    assert.strictEqual(state.shortcuts.isUndoDisabled(), false);
    assert.strictEqual(state.shortcuts.isRedoDisabled(), false);
    await u({ kind: "key:undo" });
    assert.strictEqual(state.shortcuts.isUndoDisabled(), false);
    assert.strictEqual(state.shortcuts.isRedoDisabled(), false);
    await u({ kind: "key:undo" });
    assert.strictEqual(state.shortcuts.isUndoDisabled(), true);
    assert.strictEqual(state.shortcuts.isRedoDisabled(), false);
    await u({ kind: "key:redo" });
    assert.strictEqual(state.shortcuts.isUndoDisabled(), false);
    assert.strictEqual(state.shortcuts.isRedoDisabled(), false);
    await u({ kind: "key:redo" });
    assert.strictEqual(state.shortcuts.isUndoDisabled(), false);
    assert.strictEqual(state.shortcuts.isRedoDisabled(), false);
    await u({ kind: "key:redo" });
    assert.strictEqual(state.shortcuts.isUndoDisabled(), false);
    assert.strictEqual(state.shortcuts.isRedoDisabled(), true);
    assert.deepStrictEqual(requests, undoPathExpected(id));
  });
  it("do undo/redo path (touch device)", async () => {
    const requests: RequestEventBody[] = [];
    const api = apiForActiveRoom((e) => requests.push(e));
    const state = createState(api);
    const effect = () => {};
    const u = (e: ApplicationEvent) => update(e, state, effect);
    await u({ kind: "room:init" });
    await u({ kind: "ws:open", websocket: new WebSocket(`ws://dummy`) });
    assert.strictEqual(state.shortcuts.isUndoDisabled(), true);
    assert.strictEqual(state.shortcuts.isRedoDisabled(), true);
    await drawLineTouch(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    assert.strictEqual(state.shortcuts.isUndoDisabled(), false);
    assert.strictEqual(state.shortcuts.isRedoDisabled(), true);
    const id = state.board.getAllObjects()[0].id;
    await selectTouch(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    await moveTouch(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    assert.strictEqual(state.shortcuts.isUndoDisabled(), false);
    assert.strictEqual(state.shortcuts.isRedoDisabled(), true);
    await selectTouch(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    await u({ kind: "shortcut_button:delete" });
    assert.strictEqual(state.shortcuts.isUndoDisabled(), false);
    assert.strictEqual(state.shortcuts.isRedoDisabled(), true);
    await u({ kind: "shortcut_button:undo" });
    assert.strictEqual(state.shortcuts.isUndoDisabled(), false);
    assert.strictEqual(state.shortcuts.isRedoDisabled(), false);
    await u({ kind: "shortcut_button:undo" });
    assert.strictEqual(state.shortcuts.isUndoDisabled(), false);
    assert.strictEqual(state.shortcuts.isRedoDisabled(), false);
    await u({ kind: "shortcut_button:undo" });
    assert.strictEqual(state.shortcuts.isUndoDisabled(), true);
    assert.strictEqual(state.shortcuts.isRedoDisabled(), false);
    await u({ kind: "shortcut_button:redo" });
    assert.strictEqual(state.shortcuts.isUndoDisabled(), false);
    assert.strictEqual(state.shortcuts.isRedoDisabled(), false);
    await u({ kind: "shortcut_button:redo" });
    assert.strictEqual(state.shortcuts.isUndoDisabled(), false);
    assert.strictEqual(state.shortcuts.isRedoDisabled(), false);
    await u({ kind: "shortcut_button:redo" });
    assert.strictEqual(state.shortcuts.isUndoDisabled(), false);
    assert.strictEqual(state.shortcuts.isRedoDisabled(), true);
    assert.deepStrictEqual(requests, undoPathExpected(id));
  });
  it("send multiple commands at one undo/redo action", async () => {
    const requests: RequestEventBody[] = [];
    const api = apiForActiveRoom((e) => requests.push(e));
    const state = createState(api);
    const effect = () => {};
    const u = (e: ApplicationEvent) => update(e, state, effect);
    await u({ kind: "room:init" });
    await u({ kind: "ws:open", websocket: new WebSocket(`ws://dummy`) });
    assert.strictEqual(state.shortcuts.isUndoDisabled(), true);
    assert.strictEqual(state.shortcuts.isRedoDisabled(), true);
    await drawLine(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    await drawLine(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    await select(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    await u({ kind: "shortcut_button:delete" });
    await u({ kind: "key:undo" });
    await u({ kind: "key:redo" });
    assert.deepStrictEqual(
      requests.map((r) => r.kind),
      ["add", "add", "delete", "delete", "add", "add", "delete", "delete"]
    );
  });
  it("send skips undos that cannot be applied", async () => {
    const requests: RequestEventBody[] = [];
    const api = apiForActiveRoom((e) => requests.push(e));
    const state = createState(api);
    const effect = () => {};
    const u = (e: ApplicationEvent) => update(e, state, effect);
    await u({ kind: "room:init" });
    await u({ kind: "ws:open", websocket: new WebSocket(`ws://dummy`) });
    assert.strictEqual(state.shortcuts.isUndoDisabled(), true);
    assert.strictEqual(state.shortcuts.isRedoDisabled(), true);
    await drawLine(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    const firstId = state.board.getAllObjects()[0].id;
    await drawLine(u, { x: 3, y: 3 }, { x: 4, y: 4 });
    await select(u, { x: 3, y: 3 }, { x: 4, y: 4 });
    const secondId = state.board.getSelectedObjectIds()[0];
    await u({ kind: "ws:message", data: { kind: "delete", id: secondId } });
    assert.strictEqual(state.board.getAllObjects().length, 1);
    assert.strictEqual(state.undos.length, 2);
    assert.strictEqual(state.redos.length, 0);
    await u({ kind: "key:undo" });
    assert.strictEqual(state.board.getAllObjects().length, 0);
    assert.strictEqual(state.undos.length, 0);
    assert.strictEqual(state.redos.length, 1);
    // conflict
    await u({
      kind: "ws:message",
      data: {
        kind: "upsert",
        object: {
          id: firstId,
          kind: "path",
          d: "M7.0000,7.0000L8.0000,8.0000",
          lastEditedAt: 0,
          lastEditedBy: "",
        },
      },
    });
    await u({ kind: "key:redo" });
    assert.strictEqual(state.undos.length, 0);
    assert.strictEqual(state.redos.length, 0);
  });
  it("cancel selection if object is deleted while selecting (down -> move)", async () => {
    const requests: RequestEventBody[] = [];
    const api = apiForActiveRoom((e) => requests.push(e));
    const state = createState(api);
    const effect = () => {};
    const u = (e: ApplicationEvent) => update(e, state, effect);
    await u({ kind: "room:init" });
    await u({ kind: "ws:open", websocket: new WebSocket(`ws://dummy`) });
    await drawLine(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    const firstId = state.board.getAllObjects()[0].id;
    await drawLine(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    await u({
      kind: "board:mouse_down",
      position: { x: 0, y: 0 },
      isRight: true,
    });
    assert.strictEqual(state.board.getAllObjects().length, 2);
    assert.strictEqual(state.selector.isShown(), true);
    assert.strictEqual(state.editing.kind, "select");
    await u({ kind: "ws:message", data: { kind: "delete", id: firstId } });
    assert.strictEqual(state.board.getAllObjects().length, 1);
    assert.strictEqual(state.selected.length, 1);
    assert.strictEqual(state.selector.isShown(), true);
    assert.strictEqual(state.editing.kind, "select");
    await u({ kind: "board:mouse_move", position: { x: 1, y: 1 } });
    assert.strictEqual(state.board.getAllObjects().length, 1);
    assert.strictEqual(state.selected.length, 1);
    assert.strictEqual(state.selector.isShown(), true);
    assert.strictEqual(state.editing.kind, "select");
    await u({ kind: "board:mouse_up", position: { x: 1, y: 1 } });
    assert.strictEqual(state.board.getAllObjects().length, 1);
    assert.strictEqual(state.selected.length, 1);
    assert.strictEqual(state.selector.isShown(), false);
    assert.strictEqual(state.editing.kind, "none");
  });
  it("cancel selection if object is deleted while selecting (move -> up)", async () => {
    const requests: RequestEventBody[] = [];
    const api = apiForActiveRoom((e) => requests.push(e));
    const state = createState(api);
    const effect = () => {};
    const u = (e: ApplicationEvent) => update(e, state, effect);
    await u({ kind: "room:init" });
    await u({ kind: "ws:open", websocket: new WebSocket(`ws://dummy`) });
    await drawLine(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    const firstId = state.board.getAllObjects()[0].id;
    await drawLine(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    await u({
      kind: "board:mouse_down",
      position: { x: 0, y: 0 },
      isRight: true,
    });
    assert.strictEqual(state.board.getAllObjects().length, 2);
    assert.strictEqual(state.selector.isShown(), true);
    assert.strictEqual(state.editing.kind, "select");
    await u({ kind: "board:mouse_move", position: { x: 1, y: 1 } });
    assert.strictEqual(state.board.getAllObjects().length, 2);
    assert.strictEqual(state.selected.length, 2);
    assert.strictEqual(state.selector.isShown(), true);
    assert.strictEqual(state.editing.kind, "select");
    await u({ kind: "ws:message", data: { kind: "delete", id: firstId } });
    assert.strictEqual(state.board.getAllObjects().length, 1);
    assert.strictEqual(state.selected.length, 1);
    assert.strictEqual(state.selector.isShown(), true);
    assert.strictEqual(state.editing.kind, "select");
    await u({ kind: "board:mouse_up", position: { x: 1, y: 1 } });
    assert.strictEqual(state.board.getAllObjects().length, 1);
    assert.strictEqual(state.selected.length, 1);
    assert.strictEqual(state.selector.isShown(), false);
    assert.strictEqual(state.editing.kind, "none");
  });
  it("cancel selection if object is deleted while selecting (after up)", async () => {
    const requests: RequestEventBody[] = [];
    const api = apiForActiveRoom((e) => requests.push(e));
    const state = createState(api);
    const effect = () => {};
    const u = (e: ApplicationEvent) => update(e, state, effect);
    await u({ kind: "room:init" });
    await u({ kind: "ws:open", websocket: new WebSocket(`ws://dummy`) });
    await drawLine(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    const firstId = state.board.getAllObjects()[0].id;
    await drawLine(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    await u({
      kind: "board:mouse_down",
      position: { x: 0, y: 0 },
      isRight: true,
    });
    assert.strictEqual(state.board.getAllObjects().length, 2);
    assert.strictEqual(state.selector.isShown(), true);
    assert.strictEqual(state.editing.kind, "select");
    await u({ kind: "board:mouse_move", position: { x: 1, y: 1 } });
    assert.strictEqual(state.board.getAllObjects().length, 2);
    assert.strictEqual(state.selected.length, 2);
    assert.strictEqual(state.selector.isShown(), true);
    assert.strictEqual(state.editing.kind, "select");
    await u({ kind: "board:mouse_up", position: { x: 1, y: 1 } });
    assert.strictEqual(state.board.getAllObjects().length, 2);
    assert.strictEqual(state.selected.length, 2);
    assert.strictEqual(state.selector.isShown(), false);
    assert.strictEqual(state.editing.kind, "none");
    await u({ kind: "ws:message", data: { kind: "delete", id: firstId } });
    assert.strictEqual(state.board.getAllObjects().length, 1);
    assert.strictEqual(state.selected.length, 1);
    assert.strictEqual(state.selector.isShown(), false);
    assert.strictEqual(state.editing.kind, "none");
  });
  it("selects added object while selecting", async () => {
    const requests: RequestEventBody[] = [];
    const api = apiForActiveRoom((e) => requests.push(e));
    const state = createState(api);
    const effect = () => {};
    const u = (e: ApplicationEvent) => update(e, state, effect);
    await u({ kind: "room:init" });
    await u({ kind: "ws:open", websocket: new WebSocket(`ws://dummy`) });
    await drawLine(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    await u({
      kind: "board:mouse_down",
      position: { x: 0, y: 0 },
      isRight: true,
    });
    assert.strictEqual(state.board.getAllObjects().length, 1);
    assert.strictEqual(state.selector.isShown(), true);
    assert.strictEqual(state.editing.kind, "select");
    await u({
      kind: "ws:message",
      data: {
        kind: "upsert",
        object: {
          id: "a",
          kind: "path",
          d: "M0.0000,0.0000L1.0000,1.0000",
          lastEditedAt: 0,
          lastEditedBy: "",
        },
      },
    });
    await u({ kind: "board:mouse_move", position: { x: 1, y: 1 } });
    assert.strictEqual(state.board.getAllObjects().length, 2);
    assert.strictEqual(state.selected.length, 2);
    assert.strictEqual(state.selector.isShown(), true);
    assert.strictEqual(state.editing.kind, "select");
    await u({ kind: "board:mouse_up", position: { x: 1, y: 1 } });
    assert.strictEqual(state.board.getAllObjects().length, 2);
    assert.strictEqual(state.selected.length, 2);
    assert.strictEqual(state.selector.isShown(), false);
    assert.strictEqual(state.editing.kind, "none");
  });
  it("selects moved object while selecting", async () => {
    const requests: RequestEventBody[] = [];
    const api = apiForActiveRoom((e) => requests.push(e));
    const state = createState(api);
    const effect = () => {};
    const u = (e: ApplicationEvent) => update(e, state, effect);
    await u({ kind: "room:init" });
    await u({ kind: "ws:open", websocket: new WebSocket(`ws://dummy`) });
    await drawLine(u, { x: 8, y: 8 }, { x: 9, y: 9 });
    const id = state.board.getAllObjects()[0].id;
    await u({
      kind: "board:mouse_down",
      position: { x: 0, y: 0 },
      isRight: true,
    });
    assert.strictEqual(state.board.getAllObjects().length, 1);
    assert.strictEqual(state.selector.isShown(), true);
    assert.strictEqual(state.editing.kind, "select");
    await u({ kind: "board:mouse_move", position: { x: 1, y: 1 } });
    assert.strictEqual(state.board.getAllObjects().length, 1);
    assert.strictEqual(state.selected.length, 0);
    assert.strictEqual(state.selector.isShown(), true);
    assert.strictEqual(state.editing.kind, "select");
    await u({
      kind: "ws:message",
      data: {
        kind: "upsert",
        object: {
          id,
          kind: "path",
          d: "M1.0000,1.0000L2.0000,2.0000",
          lastEditedAt: 0,
          lastEditedBy: "",
        },
      },
    });
    await u({ kind: "board:mouse_move", position: { x: 2, y: 2 } });
    assert.strictEqual(state.board.getAllObjects().length, 1);
    assert.strictEqual(state.selected.length, 1);
    assert.strictEqual(state.selector.isShown(), true);
    assert.strictEqual(state.editing.kind, "select");
    await u({
      kind: "ws:message",
      data: {
        kind: "upsert",
        object: {
          id,
          kind: "path",
          d: "M7.0000,7.0000L8.0000,8.0000",
          lastEditedAt: 0,
          lastEditedBy: "",
        },
      },
    });
    await u({ kind: "board:mouse_move", position: { x: 3, y: 3 } });
    assert.strictEqual(state.board.getAllObjects().length, 1);
    assert.strictEqual(state.selected.length, 0);
    assert.strictEqual(state.selector.isShown(), true);
    assert.strictEqual(state.editing.kind, "select");
    await u({ kind: "board:mouse_up", position: { x: 3, y: 3 } });
    assert.strictEqual(state.board.getAllObjects().length, 1);
    assert.strictEqual(state.selected.length, 0);
    assert.strictEqual(state.selector.isShown(), false);
    assert.strictEqual(state.editing.kind, "none");
  });
  it("cancel selection if object is deleted while moving (before down)", async () => {
    const requests: RequestEventBody[] = [];
    const api = apiForActiveRoom((e) => requests.push(e));
    const state = createState(api);
    const effect = () => {};
    const u = (e: ApplicationEvent) => update(e, state, effect);
    await u({ kind: "room:init" });
    await u({ kind: "ws:open", websocket: new WebSocket(`ws://dummy`) });
    await drawLine(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    await select(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    const firstId = state.board.getSelectedObjectIds()[0];
    await u({ kind: "ws:message", data: { kind: "delete", id: firstId } });
    assert.strictEqual(state.board.getAllObjects().length, 0);
    assert.strictEqual(state.board.getSelectedObjectIds().length, 0);
    assert.strictEqual(state.editing.kind, "none");
    // this is a pen
    await u({
      kind: "board:mouse_down",
      position: { x: 0, y: 0 },
      isRight: false,
    });
    assert.strictEqual(state.board.getAllObjects().length, 0);
    assert.strictEqual(state.board.getSelectedObjectIds().length, 0);
    assert.strictEqual(state.editing.kind, "path");
    await u({ kind: "board:mouse_move", position: { x: 1, y: 1 } });
    assert.strictEqual(state.board.getAllObjects().length, 1);
    assert.strictEqual(state.selected.length, 0);
    assert.strictEqual(state.editing.kind, "path");
    await u({ kind: "board:mouse_up", position: { x: 1, y: 1 } });
    assert.strictEqual(state.board.getAllObjects().length, 1);
    assert.strictEqual(state.selected.length, 0);
    assert.strictEqual(state.editing.kind, "none");
  });
  it("cancel selection if object is deleted while moving (down -> move)", async () => {
    const requests: RequestEventBody[] = [];
    const api = apiForActiveRoom((e) => requests.push(e));
    const state = createState(api);
    const effect = () => {};
    const u = (e: ApplicationEvent) => update(e, state, effect);
    await u({ kind: "room:init" });
    await u({ kind: "ws:open", websocket: new WebSocket(`ws://dummy`) });
    await drawLine(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    await select(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    const firstId = state.board.getSelectedObjectIds()[0];
    await u({
      kind: "board:mouse_down",
      position: { x: 0, y: 0 },
      isRight: false,
    });
    assert.strictEqual(state.board.getAllObjects().length, 1);
    assert.strictEqual(state.board.getSelectedObjectIds().length, 1);
    assert.strictEqual(state.editing.kind, "move");
    await u({ kind: "ws:message", data: { kind: "delete", id: firstId } });
    assert.strictEqual(state.board.getAllObjects().length, 0);
    assert.strictEqual(state.board.getSelectedObjectIds().length, 0);
    assert.strictEqual(state.editing.kind, "move");
    await u({ kind: "board:mouse_move", position: { x: 1, y: 1 } });
    assert.strictEqual(state.board.getAllObjects().length, 0);
    assert.strictEqual(state.selected.length, 0);
    assert.strictEqual(state.editing.kind, "move");
    await u({ kind: "board:mouse_up", position: { x: 1, y: 1 } });
    assert.strictEqual(state.board.getAllObjects().length, 0);
    assert.strictEqual(state.selected.length, 0);
    assert.strictEqual(state.editing.kind, "none");
  });
  it("cancel selection if object is deleted while moving (move -> up)", async () => {
    const requests: RequestEventBody[] = [];
    const api = apiForActiveRoom((e) => requests.push(e));
    const state = createState(api);
    const effect = () => {};
    const u = (e: ApplicationEvent) => update(e, state, effect);
    await u({ kind: "room:init" });
    await u({ kind: "ws:open", websocket: new WebSocket(`ws://dummy`) });
    await drawLine(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    await select(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    const firstId = state.board.getSelectedObjectIds()[0];
    await u({
      kind: "board:mouse_down",
      position: { x: 0, y: 0 },
      isRight: false,
    });
    assert.strictEqual(state.board.getAllObjects().length, 1);
    assert.strictEqual(state.board.getSelectedObjectIds().length, 1);
    assert.strictEqual(state.editing.kind, "move");
    await u({ kind: "board:mouse_move", position: { x: 1, y: 1 } });
    assert.strictEqual(state.board.getAllObjects().length, 1);
    assert.strictEqual(state.selected.length, 1);
    assert.strictEqual(state.editing.kind, "move");
    await u({ kind: "ws:message", data: { kind: "delete", id: firstId } });
    assert.strictEqual(state.board.getAllObjects().length, 0);
    assert.strictEqual(state.board.getSelectedObjectIds().length, 0);
    assert.strictEqual(state.editing.kind, "move");
    await u({ kind: "board:mouse_up", position: { x: 1, y: 1 } });
    assert.strictEqual(state.board.getAllObjects().length, 0);
    assert.strictEqual(state.selected.length, 0);
    assert.strictEqual(state.editing.kind, "none");
  });
  it("updates path position if object is upserted while moving (before down)", async () => {
    const requests: RequestEventBody[] = [];
    const api = apiForActiveRoom((e) => requests.push(e));
    const state = createState(api);
    const effect = () => {};
    const u = (e: ApplicationEvent) => update(e, state, effect);
    await u({ kind: "room:init" });
    await u({ kind: "ws:open", websocket: new WebSocket(`ws://dummy`) });
    await drawLine(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    await select(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    const firstId = state.board.getSelectedObjectIds()[0];
    await u({
      kind: "ws:message",
      data: {
        kind: "upsert",
        object: {
          id: firstId,
          kind: "path",
          d: "M7.0000,0.0000L8.0000,1.0000", // to right
          lastEditedAt: 0,
          lastEditedBy: "",
        },
      },
    });
    assert.strictEqual(state.board.getAllObjects().length, 1);
    assert.strictEqual(state.board.getSelectedObjectIds().length, 1);
    assert.strictEqual(state.editing.kind, "none");
    {
      await u({
        kind: "board:mouse_down",
        position: { x: 0, y: 0 },
        isRight: false,
      });
      assert.strictEqual(state.board.getAllObjects().length, 1);
      const object = state.board.getAllObjects()[0];
      assert.ok(object.kind === "path");
      assert.strictEqual(object.d, "M7.0000,0.0000L8.0000,1.0000");
      assert.strictEqual(state.board.getSelectedObjectIds().length, 1);
      assert.strictEqual(state.editing.kind, "move");
    }
    {
      await u({ kind: "board:mouse_move", position: { x: 0, y: 5 } }); // to bottom
      assert.strictEqual(state.board.getAllObjects().length, 1);
      const object = state.board.getAllObjects()[0];
      assert.ok(object.kind === "path");
      assert.strictEqual(object.d, "M7.0000,5.0000L8.0000,6.0000");
      assert.strictEqual(state.selected.length, 1);
      assert.strictEqual(state.editing.kind, "move");
    }
    {
      await u({ kind: "board:mouse_up", position: { x: 0, y: 5 } });
      assert.strictEqual(state.board.getAllObjects().length, 1);
      const object = state.board.getAllObjects()[0];
      assert.ok(object.kind === "path");
      assert.strictEqual(object.d, "M7.0000,5.0000L8.0000,6.0000");
      assert.strictEqual(state.selected.length, 0);
      assert.strictEqual(state.editing.kind, "none");
    }
  });
  it("cancel selecting if object is upserted while moving (move -> move)", async () => {
    const requests: RequestEventBody[] = [];
    const api = apiForActiveRoom((e) => requests.push(e));
    const state = createState(api);
    const effect = () => {};
    const u = (e: ApplicationEvent) => update(e, state, effect);
    await u({ kind: "room:init" });
    await u({ kind: "ws:open", websocket: new WebSocket(`ws://dummy`) });
    await drawLine(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    await select(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    const firstId = state.board.getSelectedObjectIds()[0];
    {
      await u({
        kind: "board:mouse_down",
        position: { x: 0, y: 0 },
        isRight: false,
      });
      assert.strictEqual(state.board.getAllObjects().length, 1);
      const object = state.board.getAllObjects()[0];
      assert.ok(object.kind === "path");
      assert.strictEqual(object.d, "M0.0000,0.0000L1.0000,1.0000");
      assert.strictEqual(state.board.getSelectedObjectIds().length, 1);
      assert.strictEqual(state.editing.kind, "move");
    }
    {
      await u({ kind: "board:mouse_move", position: { x: 0, y: 2 } }); // to bottom (2)
      assert.strictEqual(state.board.getAllObjects().length, 1);
      const object = state.board.getAllObjects()[0];
      assert.ok(object.kind === "path");
      assert.strictEqual(object.d, "M0.0000,2.0000L1.0000,3.0000");
      assert.strictEqual(state.selected.length, 1);
      assert.strictEqual(state.editing.kind, "move");
    }
    {
      await u({
        kind: "ws:message",
        data: {
          kind: "upsert",
          object: {
            id: firstId,
            kind: "path",
            d: "M7.0000,0.0000L8.0000,1.0000", // to right (from original position)
            lastEditedAt: 0,
            lastEditedBy: "",
          },
        },
      });
      assert.strictEqual(state.board.getAllObjects().length, 1);
      assert.strictEqual(state.board.getSelectedObjectIds().length, 0);
      assert.strictEqual(state.editing.kind, "move");
    }
    {
      await u({ kind: "board:mouse_move", position: { x: 0, y: 5 } });
      assert.strictEqual(state.board.getAllObjects().length, 1);
      const object = state.board.getAllObjects()[0];
      assert.ok(object.kind === "path");
      assert.strictEqual(object.d, "M7.0000,0.0000L8.0000,1.0000");
      assert.strictEqual(state.selected.length, 0);
      assert.strictEqual(state.editing.kind, "move");
    }
    {
      await u({ kind: "board:mouse_up", position: { x: 0, y: 5 } });
      assert.strictEqual(state.board.getAllObjects().length, 1);
      const object = state.board.getAllObjects()[0];
      assert.ok(object.kind === "path");
      assert.strictEqual(object.d, "M7.0000,0.0000L8.0000,1.0000");
      assert.strictEqual(state.selected.length, 0);
      assert.strictEqual(state.editing.kind, "none");
    }
  });
  it("handle 'select_all' shortcut", async () => {
    const requests: RequestEventBody[] = [];
    const api = apiForActiveRoom((e) => requests.push(e));
    const state = createState(api);
    const effect = () => {};
    const u = (e: ApplicationEvent) => update(e, state, effect);
    await u({ kind: "room:init" });
    await u({ kind: "ws:open", websocket: new WebSocket(`ws://dummy`) });
    await drawLine(u, { x: 0, y: 0 }, { x: 1, y: 1 });
    await u({ kind: "key:select_all" });
    assert.strictEqual(state.selected.length, 1);
    assert.strictEqual(state.board.getSelectedObjectIds().length, 1);
    await u({ kind: "key:select_all" });
    assert.strictEqual(state.selected.length, 1);
    assert.strictEqual(state.board.getSelectedObjectIds().length, 1);
  });
});
function apiForActiveRoom(send: (event: RequestEventBody) => void): API {
  return {
    getRoomInfo: async () => {
      return {
        id: "a",
        active: true,
        createdAt: Date.now(),
        activeUntil: Date.now() + 1000,
        aliveUntil: Date.now() + 2000,
      };
    },
    getObjects: async () => {
      throw new Error();
    },
    createRoom: async () => {
      throw new Error();
    },
    createWebsocket: (wsRoot: string, roomId: string) => {
      return new WebSocket(`${wsRoot}/api/rooms/${roomId}/websocket`);
    },
    send: (ws: WebSocket, event: RequestEventBody) => {
      send(event);
    },
  };
}
async function drawLine(
  u: (e: ApplicationEvent) => void,
  start: Position,
  end: Position
) {
  await u({ kind: "board:mouse_down", position: start, isRight: false });
  await u({ kind: "board:mouse_move", position: end });
  await u({ kind: "board:mouse_up", position: end });
}
async function drawLineTouch(
  u: (e: ApplicationEvent) => void,
  start: Position,
  end: Position
) {
  await u({ kind: "board:touch_start", position: start });
  await u({ kind: "board:touch_move", position: end });
  await u({ kind: "board:touch_end", position: end });
}
async function addText(
  u: (e: ApplicationEvent) => void,
  state: State,
  position: Position,
  text: string
) {
  await u({ kind: "board:double_click", position });
  state.input.setText(text);
  await u({ kind: "input:enter" });
}
async function addTextTouch(
  u: (e: ApplicationEvent) => void,
  state: State,
  position: Position,
  text: string
) {
  await u({ kind: "board:touch_start_long", position });
  state.input.setText(text);
  await u({ kind: "input:enter" });
}
async function select(
  u: (e: ApplicationEvent) => void,
  start: Position,
  end: Position
) {
  await u({ kind: "board:mouse_down", position: start, isRight: true });
  await u({ kind: "board:mouse_move", position: end });
  await u({ kind: "board:mouse_up", position: end });
}
async function selectTouch(
  u: (e: ApplicationEvent) => void,
  start: Position,
  end: Position
) {
  await u({ kind: "shortcut_button:select" });
  await u({ kind: "board:touch_start", position: start });
  await u({ kind: "board:touch_move", position: end });
  await u({ kind: "board:touch_end", position: end });
}
async function move(
  u: (e: ApplicationEvent) => void,
  start: Position,
  end: Position
) {
  await u({ kind: "board:mouse_down", position: start, isRight: false });
  await u({ kind: "board:mouse_move", position: end });
  await u({ kind: "board:mouse_up", position: end });
}
async function moveTouch(
  u: (e: ApplicationEvent) => void,
  start: Position,
  end: Position
) {
  await u({ kind: "board:touch_start", position: start });
  await u({ kind: "board:touch_move", position: end });
  await u({ kind: "board:touch_end", position: end });
}
