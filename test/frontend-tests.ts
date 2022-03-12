import * as assert from "assert";
import { JSDOM } from "jsdom";
import { API } from "../src/frontend/lib/api";
import { update, createState, ApplicationEvent } from "../src/frontend/logic";
import { RequestEventBody } from "../src/schema";
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
    const api = apiForActiveRoom(() => {});
    const state = createState(api);
    const effect = () => {};
    const u = (e: ApplicationEvent) => update(e, state, effect);
    await u({ kind: "room:init" });
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
  });
  it("creates a path (touch device)", async () => {
    const api = apiForActiveRoom(() => {});
    const state = createState(api);
    const effect = () => {};
    const u = (e: ApplicationEvent) => update(e, state, effect);
    await u({ kind: "room:init" });
    await u({
      kind: "board:touch_start",
      position: { x: 0, y: 0 },
    });
    await u({ kind: "board:touch_move", position: { x: 1, y: 1 } });
    await u({ kind: "board:touch_end", position: { x: 1, y: 1 } });
    const objects = state.board.getAllObjects();
    assert.strictEqual(objects.length, 1);
    const object = objects[0];
    assert.ok(object.kind === "path");
    assert.strictEqual(object.d, "M0.0000,0.0000L1.0000,1.0000");
  });
  it("creates a text", async () => {
    const api = apiForActiveRoom(() => {});
    const state = createState(api);
    const effect = () => {};
    const u = (e: ApplicationEvent) => update(e, state, effect);
    await u({ kind: "room:init" });
    await u({
      kind: "ws:open",
      websocket: new WebSocket(`ws://dummy`),
    });
    await u({ kind: "board:double_click", position: { x: 0, y: 0 } });
    state.input.setText("foo");
    await u({ kind: "input:enter" });
    const objects = state.board.getAllObjects();
    assert.strictEqual(objects.length, 1);
    const object = objects[0];
    assert.ok(object.kind === "text");
    assert.strictEqual(object.text, "foo");
  });
  it("creates a text (touch device)", async () => {
    const api = apiForActiveRoom(() => {});
    const state = createState(api);
    const effect = () => {};
    const u = (e: ApplicationEvent) => update(e, state, effect);
    await u({ kind: "room:init" });
    await u({
      kind: "ws:open",
      websocket: new WebSocket(`ws://dummy`),
    });
    await u({ kind: "board:touch_start_long", position: { x: 0, y: 0 } });
    state.input.setText("foo");
    await u({ kind: "input:enter" });
    const objects = state.board.getAllObjects();
    assert.strictEqual(objects.length, 1);
    const object = objects[0];
    assert.ok(object.kind === "text");
    assert.strictEqual(object.text, "foo");
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
