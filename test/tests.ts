import * as assert from "assert";
import { spawn, ChildProcess } from "child_process";
import fetch, { Response } from "node-fetch";
import { setTimeout } from "timers/promises";
import kill from "tree-kill";
import WebSocket from "ws";

const port = "8787";
const httpRoot = `http://localhost:${port}`;
const wsRoot = `ws://localhost:${port}`;
async function request(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: any
): Promise<Response> {
  const init: any = { method };
  if (body != null) {
    init.body = JSON.stringify(body);
  }
  return await fetch(httpRoot + path, init);
}
async function config(options: {
  MAX_ACTIVE_ROOMS?: number;
  ACTIVE_DURATION?: number;
  LIVE_DURATION?: number;
}): Promise<void> {
  const res = await request("PATCH", "/debug/config", options);
  assert.strictEqual(res.status, 200);
}
async function clean(): Promise<void> {
  const res = await request("POST", "/debug/clean");
  assert.strictEqual(res.status, 200);
}

describe("Whiteboard", function () {
  this.timeout(10 * 1000);
  let p: ChildProcess;
  before(async function () {
    p = spawn("npx", ["miniflare"], {
      stdio: "inherit",
    });
    p.on("error", (err) => {
      console.log("error:", err);
    });
    p.on("close", () => {
      console.log("closed");
    });
    for (let i = 0; i < 10; i++) {
      try {
        await fetch(httpRoot, { timeout: 500 });
        return;
      } catch (e) {
        await setTimeout(500);
      }
    }
    throw new Error("Server didn't start.");
  });
  after(async function () {
    if (p != null) {
      kill(p.pid!);
    }
  });
  beforeEach(async function () {
    const res = await request("DELETE", "/debug");
    assert.strictEqual(res.status, 200);
  });
  it("responds correct status", async function () {
    {
      const res = await request("GET", "/");
      assert.strictEqual(res.status, 200);
    }
    {
      const res = await request("GET", "/foo");
      assert.strictEqual(res.status, 404);
    }
    {
      const res = await request("GET", "/rooms");
      assert.strictEqual(res.status, 200);
    }
    {
      const res = await request("GET", "/rooms/foo");
      assert.strictEqual(res.status, 200);
    }
  });
  it("handles invalid rooms", async function () {
    {
      const res = await request("GET", "/api/rooms/short");
      assert.strictEqual(res.status, 404);
    }
    {
      const res = await request("GET", "/api/rooms/" + "a".repeat(64));
      assert.strictEqual(res.status, 404);
    }
  });
  it("creates rooms", async function () {
    const res = await request("POST", "/api/rooms");
    const id = await res.text();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(id.length, 64);
    {
      const res = await request("GET", "/api/rooms/" + id);
      assert.strictEqual(res.status, 200);
      const room = await res.json();
      assert.strictEqual(room.id, id);
    }
  });
  it("restrict number of active rooms", async function () {
    const MAX_ACTIVE_ROOMS = 2;
    const ACTIVE_DURATION = 1000;
    const createdRoomIds = [];
    await config({
      MAX_ACTIVE_ROOMS,
      ACTIVE_DURATION,
    });
    for (let i = 0; i < MAX_ACTIVE_ROOMS; i++) {
      const res = await request("POST", "/api/rooms");
      const id = await res.text();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(id.length, 64);
      createdRoomIds.push(id);
    }
    {
      const res = await request("POST", "/api/rooms");
      assert.strictEqual(res.status, 403);
    }
    await setTimeout(ACTIVE_DURATION);
    await clean();
    {
      const res = await request("POST", "/api/rooms");
      const id = await res.text();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(id.length, 64);
      createdRoomIds.push(id);
    }
    for (const id of createdRoomIds) {
      const res = await request("GET", "/api/rooms/" + id);
      assert.strictEqual(res.status, 200);
      const room = await res.json();
      assert.strictEqual(room.id, id);
    }
  });
  it("deletes outdated rooms", async function () {
    const ACTIVE_DURATION = 1000;
    const LIVE_DURATION = 2000;
    const createdRoomIds = [];
    await config({
      ACTIVE_DURATION,
      LIVE_DURATION,
    });
    {
      const res = await request("POST", "/api/rooms");
      const id = await res.text();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(id.length, 64);
      createdRoomIds.push(id);
    }
    await setTimeout(ACTIVE_DURATION);
    await clean();
    for (const id of createdRoomIds) {
      const res = await request("GET", "/api/rooms/" + id);
      assert.strictEqual(res.status, 200);
      const room = await res.json();
      assert.strictEqual(room.active, false);
    }
    await setTimeout(LIVE_DURATION - ACTIVE_DURATION);
    await clean();
    for (const id of createdRoomIds) {
      const res = await request("GET", "/api/rooms/" + id);
      assert.strictEqual(res.status, 404);
    }
  });
  it("accepts websocket connection to a room", async function () {
    const res = await request("POST", "/api/rooms");
    const id = await res.text();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(id.length, 64);
    await useWebsocket("tester", `/api/rooms/${id}/websocket`, async () => {});
  });
  it("does not accept websocket connection to invalid rooms", async function () {
    // TODO: なぜか Miniflare が 500 を返す
    await assert.rejects(async () => {
      await useWebsocket("a", `/foo`, async () => {});
    });
    await assert.rejects(async () => {
      await useWebsocket("a", `/api/rooms/foo/websocket`, async () => {});
    });
    const ACTIVE_DURATION = 1000;
    const LIVE_DURATION = 2000;
    await config({
      ACTIVE_DURATION,
      LIVE_DURATION,
    });
    const res = await request("POST", "/api/rooms");
    const id = await res.text();
    assert.strictEqual(res.status, 200);
    await setTimeout(ACTIVE_DURATION);
    await clean();
    await assert.rejects(async () => {
      await useWebsocket("a", `/api/rooms/${id}/websocket`, async () => {});
    });
    await setTimeout(LIVE_DURATION - ACTIVE_DURATION);
    await clean();
    await assert.rejects(async () => {
      await useWebsocket("a", `/api/rooms/${id}/websocket`, async () => {});
    });
  });
  it("closes all connections when a room is deactivated", async function () {
    const ACTIVE_DURATION = 1000;
    await config({
      ACTIVE_DURATION,
    });
    const res = await request("POST", "/api/rooms");
    assert.strictEqual(res.status, 200);
    const id = await res.text();
    const queue = [];
    await useWebsocket("a", `/api/rooms/${id}/websocket`, async () => {
      await setTimeout(ACTIVE_DURATION);
      await clean();
      await setTimeout(500);
      queue.push("b");
    });
    queue.push("a");
    while (queue.length < 2) {
      await setTimeout(100);
    }
    assert.deepStrictEqual(queue, ["a", "b"]);
  });
  it("closes all connections when a room is deleted", async function () {
    const LIVE_DURATION = 1000; // < ACTIVE_DURATION
    await config({
      LIVE_DURATION,
    });
    const res = await request("POST", "/api/rooms");
    assert.strictEqual(res.status, 200);
    const id = await res.text();
    const queue = [];
    await useWebsocket("a", `/api/rooms/${id}/websocket`, async () => {
      await setTimeout(LIVE_DURATION);
      await clean();
      await setTimeout(500);
      queue.push("b");
    });
    queue.push("a");
    while (queue.length < 2) {
      await setTimeout(100);
    }
    assert.deepStrictEqual(queue, ["a", "b"]);
  });
  it("does not allow users to make multiple connections in a room", async function () {
    const res = await request("POST", "/api/rooms");
    assert.strictEqual(res.status, 200);
    const id = await res.text();
    const queue = [];
    await useWebsocket("a", `/api/rooms/${id}/websocket`, async () => {
      await useWebsocket("a", `/api/rooms/${id}/websocket`, async () => {
        await setTimeout(500);
        queue.push("b");
      });
      await setTimeout(500);
      queue.push("c");
    });
    queue.push("a");
    while (queue.length < 3) {
      await setTimeout(100);
    }
    assert.deepStrictEqual(queue, ["a", "b", "c"]);
  });
  it("allows users to make another connections in another room", async function () {
    let id1, id2: string;
    {
      const res = await request("POST", "/api/rooms");
      assert.strictEqual(res.status, 200);
      id1 = await res.text();
    }
    {
      const res = await request("POST", "/api/rooms");
      assert.strictEqual(res.status, 200);
      id2 = await res.text();
    }
    const queue = [];
    await useWebsocket("a", `/api/rooms/${id1}/websocket`, async () => {
      await useWebsocket("a", `/api/rooms/${id2}/websocket`, async () => {
        await setTimeout(500);
        queue.push("a");
      });
      await setTimeout(500);
      queue.push("b");
    });
    queue.push("c");
    while (queue.length < 3) {
      await setTimeout(100);
    }
    assert.deepStrictEqual(queue, ["a", "b", "c"]);
  });
  it("does not allow more than 10 users to enter a room at the same time", async function () {
    const res = await request("POST", "/api/rooms");
    assert.strictEqual(res.status, 200);
    const id = await res.text();
    const queue = [];

    const success: number[] = [];
    const failure: number[] = [];
    const promises: Promise<void>[] = [];
    [...Array(10).keys()].forEach((i) => {
      // i = 0...9
      promises.push(
        useWebsocket(String(i), `/api/rooms/${id}/websocket`, async () => {
          await setTimeout(2000);
        })
          .then(() => {
            success.push(i);
          })
          .catch(() => {
            failure.push(i);
          })
      );
    });
    await setTimeout(1000);
    [...Array(10).keys()].forEach((i) => {
      i += 10;
      // i = 10...19
      promises.push(
        useWebsocket(String(i), `/api/rooms/${id}/websocket`, async () => {})
          .then(() => {
            success.push(i);
          })
          .catch(() => {
            failure.push(i);
          })
      );
    });
    await Promise.all(promises);
    assert.strictEqual(success.length, 10);
    assert.strictEqual(failure.length, 10);
    assert.strictEqual(
      success.some((i) => i >= 10),
      false
    );
    assert.strictEqual(
      failure.some((i) => i < 10),
      false
    );
  });
});
function useWebsocket<T>(
  testUserId: string,
  path: string,
  f: (ws: WebSocket) => Promise<T>
): Promise<T> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsRoot + path, {
      perMessageDeflate: false,
      headers: {
        "WB-TEST-USER": testUserId,
      },
    });
    let error: unknown;
    let result: T | undefined;
    let closed = false;
    ws.on("open", () => {
      console.log(`open ${testUserId}`);
      f(ws)
        .then((r) => {
          result = r;
        })
        .catch((e) => {
          error = e;
        })
        .finally(() => {
          if (!closed) {
            ws.close();
          }
        });
    });
    ws.on("error", (e) => {
      console.log(`error ${testUserId}:`, e.message);
      error = e;
    });
    ws.on("close", () => {
      console.log(`close ${testUserId}`);
      closed = true;
      if (error == null) {
        resolve(result!);
      } else {
        reject(error);
      }
    });
  });
}
