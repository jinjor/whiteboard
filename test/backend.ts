import * as assert from "assert";
import { spawn, ChildProcess } from "child_process";
import fetch, { Response } from "node-fetch";
import { setTimeout } from "timers/promises";
import kill from "tree-kill";
import WebSocket from "ws";
import { Config } from "../src/backend/config";

const port = "8787";
const httpRoot = `http://localhost:${port}`;
const wsRoot = `ws://localhost:${port}`;
async function request(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: any
): Promise<Response> {
  const init: any = {
    method,
    headers: {
      "WB-TEST-USER": "test",
    },
  };
  if (body != null) {
    init.body = JSON.stringify(body);
  }
  return await fetch(httpRoot + path, init);
}
async function config(options: Partial<Config>): Promise<void> {
  const res = await request("PATCH", "/debug/config", options);
  assert.strictEqual(res.status, 200);
}
async function roomConfig(
  roomId: string,
  options: Partial<Config>
): Promise<void> {
  const res = await request("PATCH", `/debug/rooms/${roomId}/config`, options);
  assert.strictEqual(res.status, 200);
}
async function clean(): Promise<void> {
  const res = await request("POST", "/debug/clean");
  assert.strictEqual(res.status, 200);
}

async function createRoom(): Promise<string> {
  const res1 = await request("POST", "/api/rooms");
  assert.strictEqual(res1.status, 200);
  const roomInfo = await res1.json();
  assert.strictEqual(roomInfo.id.length, 64);
  assert.strictEqual(roomInfo.active, true);
  assert.notStrictEqual(roomInfo.createdAt, undefined);
  return roomInfo.id;
}

describe("backend", function () {
  this.timeout(10 * 1000);
  let p: ChildProcess;
  before(async function () {
    p = spawn("npx", ["miniflare", "-e", ".env.test"], {
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
        await fetch(httpRoot, {
          timeout: 500,
          headers: {
            "WB-TEST-USER": "test",
          },
        });
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
      assert.strictEqual(res.status, 404);
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
    const id = await createRoom();
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
      const id = await createRoom();
      createdRoomIds.push(id);
    }
    {
      const res = await request("POST", "/api/rooms");
      assert.strictEqual(res.status, 403);
    }
    await setTimeout(ACTIVE_DURATION);
    await clean();
    {
      const id = await createRoom();
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
      const id = await createRoom();
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
    const id = await createRoom();
    await useWebsocket("tester", `/api/rooms/${id}/websocket`, async () => {});
  });
  it("does not accept websocket connection to invalid rooms", async function () {
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
    const id = await createRoom();
    await setTimeout(ACTIVE_DURATION);
    await clean();
    await assert.rejects(async () => {
      await useWebsocket("a", `/api/rooms/${id}/websocket`, async () => {
        await setTimeout(100);
      });
    });
    await setTimeout(LIVE_DURATION - ACTIVE_DURATION);
    await clean();
    await assert.rejects(async () => {
      await useWebsocket("a", `/api/rooms/${id}/websocket`, async () => {
        await setTimeout(100);
      });
    });
  });
  it("closes all connections with 1001 when a room is deactivated", async function () {
    const ACTIVE_DURATION = 1000;
    await config({
      ACTIVE_DURATION,
    });
    const id = await createRoom();
    const queue = [];
    const code = await useWebsocket(
      "a",
      `/api/rooms/${id}/websocket`,
      async () => {
        await setTimeout(ACTIVE_DURATION);
        await clean();
        await setTimeout(500);
        queue.push("b");
      }
    ).catch((e) => {
      const { code } = JSON.parse(e.message);
      return code;
    });
    queue.push("a");
    while (queue.length < 2) {
      await setTimeout(100);
    }
    assert.deepStrictEqual(queue, ["a", "b"]);
    assert.strictEqual(code, 1001);
  });
  it("closes all connections with 1001 when a room is deleted", async function () {
    const LIVE_DURATION = 1000; // < ACTIVE_DURATION
    await config({
      LIVE_DURATION,
    });
    const id = await createRoom();
    const queue = [];
    const code = await useWebsocket(
      "a",
      `/api/rooms/${id}/websocket`,
      async () => {
        await setTimeout(LIVE_DURATION);
        await clean();
        await setTimeout(500);
        queue.push("b");
      }
    ).catch((e) => {
      const { code } = JSON.parse(e.message);
      return code;
    });
    queue.push("a");
    while (queue.length < 2) {
      await setTimeout(100);
    }
    assert.deepStrictEqual(queue, ["a", "b"]);
    assert.strictEqual(code, 1001);
  });
  it("does not allow users to make multiple connections in a room", async function () {
    const id = await createRoom();
    const queue = [];
    await useWebsocket("a", `/api/rooms/${id}/websocket`, async () => {
      await useWebsocket("a", `/api/rooms/${id}/websocket`, async () => {
        await setTimeout(500);
        queue.push("b");
      });
      await setTimeout(500);
      queue.push("c");
    }).catch(() => {});
    queue.push("a");
    while (queue.length < 3) {
      await setTimeout(100);
    }
    assert.deepStrictEqual(queue, ["a", "b", "c"]);
  });
  it("allows users to make another connections in another room", async function () {
    const id1 = await createRoom();
    const id2 = await createRoom();
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
    const id = await createRoom();

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
        useWebsocket(String(i), `/api/rooms/${id}/websocket`, async () => {
          await setTimeout(500);
        })
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
  it("send `init` event first, not followed by `join` event", async function () {
    const id = await createRoom();
    const received: any[] = [];
    await useWebsocket(
      "a",
      `/api/rooms/${id}/websocket`,
      async (ws: WebSocket) => {
        ws.on("message", (event: string) => {
          received.push(JSON.parse(event));
        });
        await setTimeout(500);
      }
    );
    assert.deepStrictEqual(received, [
      {
        kind: "init",
        objects: {},
        members: [{ id: "a", name: "a", image: null }],
        self: "a",
      },
    ]);
  });
  it("correctly tracks members", async function () {
    const id1 = await createRoom();
    const p1 = useWebsocket(
      "a",
      `/api/rooms/${id1}/websocket`,
      async (ws: WebSocket) => {
        const received: any[] = [];
        ws.on("message", (event: string) => {
          received.push(JSON.parse(event));
        });
        await setTimeout(1000);
        return received;
      }
    );
    await setTimeout(500);
    const p2 = useWebsocket(
      "b",
      `/api/rooms/${id1}/websocket`,
      async (ws: WebSocket) => {
        const received: any[] = [];
        ws.on("message", (event: string) => {
          received.push(JSON.parse(event));
        });
        await setTimeout(1000);
        return received;
      }
    );
    const [mes1, mes2] = await Promise.all([p1, p2]);
    assert.deepStrictEqual(mes1, [
      {
        kind: "init",
        objects: {},
        members: [{ id: "a", name: "a", image: null }],
        self: "a",
      },
      {
        kind: "join",
        user: { id: "b", name: "b", image: null },
      },
    ]);
    assert.deepStrictEqual(mes2, [
      {
        kind: "init",
        objects: {},
        members: [
          { id: "a", name: "a", image: null },
          { id: "b", name: "b", image: null },
        ],
        self: "b",
      },
      {
        kind: "quit",
        id: "a",
      },
    ]);
  });
  it("closes websocket with 1001 when another connection from same user is requested", async function () {
    const id1 = await createRoom();
    const mes1: any[] = [];
    const p1 = useWebsocket(
      "a",
      `/api/rooms/${id1}/websocket`,
      async (ws: WebSocket) => {
        ws.on("message", (event: string) => {
          mes1.push(JSON.parse(event));
        });
        await setTimeout(1000);
      }
    ).catch((e) => {
      const { code } = JSON.parse(e.message);
      return code;
    });
    await setTimeout(500);
    const mes2: any[] = [];
    const p2 = useWebsocket(
      "a",
      `/api/rooms/${id1}/websocket`,
      async (ws: WebSocket) => {
        ws.on("message", (event: string) => {
          mes2.push(JSON.parse(event));
        });
        await setTimeout(1000);
      }
    );
    const [code] = await Promise.all([p1, p2]);
    assert.deepStrictEqual(mes1, [
      {
        kind: "init",
        objects: {},
        members: [{ id: "a", name: "a", image: null }],
        self: "a",
      },
    ]);
    assert.deepStrictEqual(mes2, [
      {
        kind: "init",
        objects: {},
        members: [{ id: "a", name: "a", image: null }],
        self: "a",
      },
    ]);
    assert.strictEqual(code, 1001);
  });
  it("closes connection with 1007 when receiving invalid data (add)", async function () {
    const roomId = await createRoom();
    const invalidCommands = [
      {
        kind: "add",
        object: {
          id: "a".repeat(36),
          kind: "text",
          text: "foo",
          position: { x: 0 }, // missing `y`
        },
      },
      {
        kind: "add",
        object: {
          id: "a".repeat(36),
          kind: "text",
          text: "foo",
          position: { x: 0, y: 0, z: 0 },
        },
      },
      {
        kind: "add",
        object: {
          id: "a".repeat(36),
          kind: "text",
          text: "a".repeat(1001),
          position: { x: 0, y: 0 },
        },
      },
    ];
    for (const command of invalidCommands) {
      const code = await useWebsocket(
        "a",
        `/api/rooms/${roomId}/websocket`,
        async (ws: WebSocket) => {
          ws.send(JSON.stringify(command));
          await setTimeout(100);
        }
      ).catch((e) => {
        const { code } = JSON.parse(e.message);
        return code;
      });
      assert.strictEqual(code, 1007);
    }
  });
  it("closes connection with 1007 when receiving invalid data (patch)", async function () {
    const roomId = await createRoom();
    const code = await useWebsocket(
      "a",
      `/api/rooms/${roomId}/websocket`,
      async (ws: WebSocket) => {
        ws.send(
          JSON.stringify({
            kind: "add",
            object: {
              id: "a".repeat(36),
              kind: "text",
              text: "foo",
              position: { x: 0, y: 0 }, // missing `y`
            },
          })
        );
        await setTimeout(100);
        ws.send(
          JSON.stringify({
            kind: "patch",
            id: "a".repeat(36),
            key: "text",
            value: { old: "foo", new: "a".repeat(1001) },
          })
        );
        await setTimeout(100);
      }
    ).catch((e) => {
      const { code } = JSON.parse(e.message);
      return code;
    });
    assert.strictEqual(code, 1007);
  });
  it("broadcasts updates to everyone in the room except for their sender", async function () {
    const id1 = await createRoom();
    const id2 = await createRoom();
    const senderId = "a";
    const receiverId = "b";
    const p1 = useWebsocket(
      senderId,
      `/api/rooms/${id1}/websocket`,
      async (ws: WebSocket) => {
        const received: any[] = [];
        ws.on("message", (event: string) => {
          received.push(JSON.parse(event));
        });
        await setTimeout(500);
        ws.send(
          JSON.stringify({
            kind: "add",
            object: {
              id: "a".repeat(36),
              kind: "text",
              text: "a",
              position: { x: 0, y: 0 },
            },
          })
        );
        await setTimeout(500);
        return received;
      }
    );
    const p2 = useWebsocket(
      receiverId,
      `/api/rooms/${id1}/websocket`,
      async (ws: WebSocket) => {
        const received: any[] = [];
        ws.on("message", (event: string) => {
          received.push(JSON.parse(event));
        });
        await setTimeout(1000);
        return received;
      }
    );
    const p3 = useWebsocket(
      receiverId,
      `/api/rooms/${id2}/websocket`,
      async (ws: WebSocket) => {
        const received: any[] = [];
        ws.on("message", (event: string) => {
          received.push(JSON.parse(event));
        });
        await setTimeout(1000);
        return received;
      }
    );
    const [mes1, mes2, mes3] = await Promise.all([p1, p2, p3]);
    console.log(mes1, mes2, mes3);
    assert.strictEqual(mes1.filter((m) => m.kind === "upsert").length, 0);
    assert.strictEqual(mes2.filter((m) => m.kind === "upsert").length, 1);
    assert.strictEqual(mes3.filter((m) => m.kind === "upsert").length, 0);
  });
  it("provides objects from a room", async function () {
    {
      const res = await request("GET", `/api/rooms/${"a".repeat(64)}/objects`);
      assert.strictEqual(res.status, 404);
    }
    const id = await createRoom();
    {
      const res = await request("GET", `/api/rooms/${id}/objects`);
      assert.strictEqual(res.status, 200);
      const objects = await res.json();
      assert.deepStrictEqual(objects, {});
    }
    const senderId = "a";
    const object = {
      id: "a".repeat(36),
      kind: "text",
      text: "a",
      position: { x: 0, y: 0 },
    };
    await useWebsocket(
      senderId,
      `/api/rooms/${id}/websocket`,
      async (ws: WebSocket) => {
        ws.send(
          JSON.stringify({
            kind: "add",
            object,
          })
        );
        await setTimeout(500);
      }
    );
    {
      const res = await request("GET", `/api/rooms/${id}/objects`);
      assert.strictEqual(res.status, 200);
      const objects = await res.json();
      assert.deepStrictEqual(objects, {
        [object.id]: object,
      });
    }
    // TODO: deactivate, kill
  });
  it("closes all connections with 1001 when room becomes not hot", async function () {
    const roomId = await createRoom();
    await roomConfig(roomId, {
      HOT_DURATION: 1000,
    });
    let i = 0;
    const sendSomething = (ws: WebSocket) => {
      ws.send(
        JSON.stringify({
          kind: "add",
          object: {
            id: String(++i).padStart(36, "0"),
            kind: "text",
            text: "foo",
            position: { x: 0, y: 0 },
          },
        })
      );
    };
    const received: any[] = [];
    const p1 = useWebsocket(
      "receiver",
      `/api/rooms/${roomId}/websocket`,
      async (ws: WebSocket) => {
        ws.on("message", (event: string) => {
          received.push(JSON.parse(event));
        });
        await setTimeout(5000);
      }
    ).catch((e) => {
      const { code } = JSON.parse(e.message);
      return code;
    });
    const p2 = useWebsocket(
      "sender",
      `/api/rooms/${roomId}/websocket`,
      async (ws: WebSocket) => {
        await setTimeout(100);
        sendSomething(ws); // 1
        await setTimeout(500);
        await clean();
        sendSomething(ws); // 2
        await setTimeout(500);
        await clean();
        sendSomething(ws); // 3
        await setTimeout(500);
        await clean();
        sendSomething(ws); // 4
        await setTimeout(500);
        await clean();
        sendSomething(ws); // 5
        await setTimeout(2000);
        await clean();
        sendSomething(ws); // 6
        await setTimeout(500);
      }
    ).catch((e) => {
      const { code } = JSON.parse(e.message);
      return code;
    });
    const [code1, code2] = await Promise.all([p1, p2]);
    assert.strictEqual(code1, 1001);
    assert.strictEqual(code2, 1001);
    assert.strictEqual(filterEditingEvents(received).length, 5);
  });

  describe("`add` event", function () {
    const event = {
      kind: "add",
      object: {
        id: "a".repeat(36),
        kind: "text",
        text: "foo",
        position: { x: 0, y: 0 },
      },
    };
    it("broadcasts updates and updates objects at server-side", async function () {
      await assertReceivedEditingEventsAndFinalObjects([event], {
        events: [
          {
            kind: "upsert",
            object: event.object,
          },
        ],
        objects: {
          [event.object.id]: event.object,
        },
      });
    });
    it("does nothing if conflicts found", async function () {
      await assertReceivedEditingEventsAndFinalObjects(
        [
          event,
          {
            kind: "add",
            object: {
              id: event.object.id,
              kind: "text",
              text: "foo",
              position: { x: 1, y: 1 },
            },
          },
        ],
        {
          events: [
            {
              kind: "upsert",
              object: event.object,
            },
          ],
          objects: {
            [event.object.id]: event.object,
          },
        }
      );
    });
  });
  describe("`delete` event", function () {
    const addEvent = {
      kind: "add",
      object: {
        id: "a".repeat(36),
        kind: "text",
        text: "foo",
        position: { x: 0, y: 0 },
      },
    };
    const deleteEvent = {
      kind: "delete",
      object: addEvent.object,
    };
    it("broadcasts updates and updates objects at server-side", async function () {
      await assertReceivedEditingEventsAndFinalObjects(
        [addEvent, deleteEvent],
        {
          events: [
            {
              kind: "upsert",
              object: addEvent.object,
            },
            {
              kind: "delete",
              id: addEvent.object.id,
            },
          ],
          objects: {},
        }
      );
    });
    it("does nothing if conflicts found", async function () {
      await assertReceivedEditingEventsAndFinalObjects([deleteEvent], {
        events: [],
        objects: {},
      });
    });
    it("does nothing if conflicts found (another case)", async function () {
      await assertReceivedEditingEventsAndFinalObjects(
        [
          addEvent,
          {
            kind: "delete",
            object: {
              id: "a".repeat(36),
              kind: "text",
              text: "foo",
              position: { x: 0, y: 1 },
            },
          },
        ],
        {
          events: [
            {
              kind: "upsert",
              object: addEvent.object,
            },
          ],
          objects: {
            [addEvent.object.id]: addEvent.object,
          },
        }
      );
    });
  });
  describe("`patch` event", function () {
    const addEvent = {
      kind: "add",
      object: {
        id: "a".repeat(36),
        kind: "text",
        text: "foo",
        position: { x: 0, y: 0 },
      },
    };
    const patchEvent = {
      kind: "patch",
      id: addEvent.object.id,
      key: "text",
      value: { old: addEvent.object.text, new: "hello" },
    };
    it("broadcasts updates and updates objects at server-side", async function () {
      await assertReceivedEditingEventsAndFinalObjects([addEvent, patchEvent], {
        events: [
          {
            kind: "upsert",
            object: addEvent.object,
          },
          {
            kind: "upsert",
            object: {
              ...addEvent.object,
              [patchEvent.key]: patchEvent.value.new,
            },
          },
        ],
        objects: {
          [addEvent.object.id]: {
            ...addEvent.object,
            [patchEvent.key]: patchEvent.value.new,
          },
        },
      });
    });
    it("does nothing if conflicts found", async function () {
      await assertReceivedEditingEventsAndFinalObjects([patchEvent], {
        events: [],
        objects: {},
      });
    });
    it("does nothing if conflicts found (another case)", async function () {
      await assertReceivedEditingEventsAndFinalObjects(
        [
          addEvent,
          {
            kind: "patch",
            id: addEvent.object.id,
            key: "text",
            value: { old: "bar", new: "hello" },
          },
        ],
        {
          events: [
            {
              kind: "upsert",
              object: addEvent.object,
            },
          ],
          objects: {
            [addEvent.object.id]: addEvent.object,
          },
        }
      );
    });
    it("handles invalid patch (unknown key)", async function () {
      const roomId = await createRoom();
      await useWebsocket(
        "a",
        `/api/rooms/${roomId}/websocket`,
        async (ws: WebSocket) => {
          ws.send(
            JSON.stringify({
              kind: "add",
              object: {
                id: "a".repeat(36),
                kind: "text",
                text: "foo",
                position: { x: 0, y: 0 },
              },
            })
          );
          await setTimeout(100);
        }
      );
      const code = await useWebsocket(
        "a",
        `/api/rooms/${roomId}/websocket`,
        async (ws: WebSocket) => {
          ws.send(
            JSON.stringify({
              kind: "patch",
              id: "a".repeat(36),
              key: "unknown",
              value: { old: 0, new: 1 },
            })
          );
          await setTimeout(100);
        }
      ).catch((e) => {
        const { code } = JSON.parse(e.message);
        return code;
      });
      assert.strictEqual(code, 1007);
    });
    it("handles invalid patch (invalid new value)", async function () {
      const roomId = await createRoom();
      await useWebsocket(
        "a",
        `/api/rooms/${roomId}/websocket`,
        async (ws: WebSocket) => {
          ws.send(
            JSON.stringify({
              kind: "add",
              object: {
                id: "a".repeat(36),
                kind: "text",
                text: "foo",
                position: { x: 0, y: 0 },
              },
            })
          );
          await setTimeout(100);
        }
      );
      const code = await useWebsocket(
        "a",
        `/api/rooms/${roomId}/websocket`,
        async (ws: WebSocket) => {
          ws.send(
            JSON.stringify({
              kind: "patch",
              id: "a".repeat(36),
              key: "text",
              value: { old: "foo", new: 1 },
            })
          );
          await setTimeout(100);
        }
      ).catch((e) => {
        const { code } = JSON.parse(e.message);
        return code;
      });
      assert.strictEqual(code, 1007);
    });
  });

  function filterEditingEvents(events: any[]) {
    return events.filter((m) => ["upsert", "delete"].includes(m.kind));
  }
  async function sendEditingEventsToAnother(
    roomId: string,
    senderId: string,
    receiverId: string,
    events: any[]
  ): Promise<any[]> {
    const p1 = useWebsocket(
      senderId,
      `/api/rooms/${roomId}/websocket`,
      async (ws: WebSocket) => {
        const received: any[] = [];
        ws.on("message", (event: string) => {
          received.push(JSON.parse(event));
        });
        await setTimeout(500);
        for (const event of events) {
          ws.send(JSON.stringify(event));
          await setTimeout(10); // なぜか必要？
        }
        await setTimeout(500);
        return received;
      }
    );
    const p2 = useWebsocket(
      receiverId,
      `/api/rooms/${roomId}/websocket`,
      async (ws: WebSocket) => {
        const received: any[] = [];
        ws.on("message", (event: string) => {
          received.push(JSON.parse(event));
        });
        await setTimeout(1000);
        return received;
      }
    );
    return await Promise.all([p1, p2]);
  }
  async function getCurrentObjects(
    roomId: string,
    userId: string
  ): Promise<any> {
    const mes = await useWebsocket(
      userId,
      `/api/rooms/${roomId}/websocket`,
      async (ws: WebSocket) => {
        const received: any[] = [];
        ws.on("message", (event: string) => {
          received.push(JSON.parse(event));
        });
        await setTimeout(1000);
        return received;
      }
    );
    return mes[0].objects;
  }
  async function assertReceivedEditingEventsAndFinalObjects(
    events: any[],
    expected: {
      events: any[];
      objects: any;
    }
  ) {
    const roomId = await createRoom();
    const senderId = "a";
    const receiverId = "b";
    const [mes1, mes2] = await sendEditingEventsToAnother(
      roomId,
      senderId,
      receiverId,
      events
    );
    const edits1 = filterEditingEvents(mes1);
    const edits2 = filterEditingEvents(mes2);
    assert.strictEqual(edits1.length, 0);
    assert.strictEqual(
      edits2.length,
      expected.events.length,
      JSON.stringify(edits2)
    );
    for (let i = 0; i < edits2.length; i++) {
      assert.deepStrictEqual(edits2[i], expected.events[i]);
    }
    const objects = await getCurrentObjects(roomId, receiverId);
    assert.deepStrictEqual(objects, expected.objects);
  }
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
            ws.close(1000);
          }
        });
    });
    ws.on("error", (e) => {
      console.log(`error ${testUserId}:`, e.message);
      error = e;
    });
    ws.on("close", (code: number) => {
      console.log(`close ${testUserId}:`, code);
      closed = true;
      if (code !== 1000) {
        error = new Error(JSON.stringify({ code }));
      }
      if (error == null) {
        resolve(result!);
      } else {
        reject(error);
      }
    });
  });
}
