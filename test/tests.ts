import * as assert from "assert";
import { spawn, ChildProcess } from "child_process";
import fetch from "node-fetch";
import { setTimeout } from "timers/promises";
import kill from "tree-kill";

describe("Whiteboard", function () {
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
        await fetch("http://localhost:8787/", { timeout: 500 });
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
    const res = await fetch("http://localhost:8787/debug", {
      method: "DELETE",
    });
    assert.strictEqual(res.status, 200);
  });
  it("responds correct status", async function () {
    {
      const res = await fetch("http://localhost:8787/");
      assert.strictEqual(res.status, 200);
    }
    {
      const res = await fetch("http://localhost:8787/foo");
      assert.strictEqual(res.status, 404);
    }
    {
      const res = await fetch("http://localhost:8787/rooms");
      assert.strictEqual(res.status, 200);
    }
    {
      const res = await fetch("http://localhost:8787/rooms/foo");
      assert.strictEqual(res.status, 200);
    }
  });
  it("handles invalid rooms", async function () {
    {
      const res = await fetch("http://localhost:8787/api/rooms/short");
      assert.strictEqual(res.status, 404);
    }
    {
      const res = await fetch(
        "http://localhost:8787/api/rooms/" + "a".repeat(64)
      );
      assert.strictEqual(res.status, 404);
    }
  });
  it("creates rooms", async function () {
    const res = await fetch("http://localhost:8787/api/rooms", {
      method: "POST",
    });
    const id = await res.text();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(id.length, 64);
    {
      const res = await fetch("http://localhost:8787/api/rooms/" + id);
      assert.strictEqual(res.status, 200);
      const room = await res.json();
      assert.strictEqual(room.id, id);
    }
  });
  it("restrict number of active rooms", async function () {
    const MAX_ACTIVE_ROOMS = 2;
    const ACTIVE_DURATION = 1000;
    const createdRoomIds = [];
    {
      const res = await fetch("http://localhost:8787/debug/config", {
        method: "PATCH",
        body: JSON.stringify({
          MAX_ACTIVE_ROOMS: String(MAX_ACTIVE_ROOMS),
          ACTIVE_DURATION: String(ACTIVE_DURATION),
        }),
      });
      assert.strictEqual(res.status, 200);
    }
    for (let i = 0; i < MAX_ACTIVE_ROOMS; i++) {
      const res = await fetch("http://localhost:8787/api/rooms", {
        method: "POST",
      });
      const id = await res.text();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(id.length, 64);
      createdRoomIds.push(id);
    }
    {
      const res = await fetch("http://localhost:8787/api/rooms", {
        method: "POST",
      });
      assert.strictEqual(res.status, 403);
    }
    {
      await setTimeout(ACTIVE_DURATION);
      const res = await fetch("http://localhost:8787/debug/clean", {
        method: "POST",
      });
      assert.strictEqual(res.status, 200);
    }
    {
      const res = await fetch("http://localhost:8787/api/rooms", {
        method: "POST",
      });
      const id = await res.text();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(id.length, 64);
      createdRoomIds.push(id);
    }
    for (const id of createdRoomIds) {
      const res = await fetch("http://localhost:8787/api/rooms/" + id);
      assert.strictEqual(res.status, 200);
      const room = await res.json();
      assert.strictEqual(room.id, id);
    }
  });
  it("deletes outdated rooms", async function () {
    const LIVE_DURATION = 1000;
    const createdRoomIds = [];
    {
      const res = await fetch("http://localhost:8787/debug/config", {
        method: "PATCH",
        body: JSON.stringify({
          LIVE_DURATION: String(LIVE_DURATION),
        }),
      });
      assert.strictEqual(res.status, 200);
    }
    {
      const res = await fetch("http://localhost:8787/api/rooms", {
        method: "POST",
      });
      const id = await res.text();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(id.length, 64);
      createdRoomIds.push(id);
    }
    {
      await setTimeout(LIVE_DURATION);
      const res = await fetch("http://localhost:8787/debug/clean", {
        method: "POST",
      });
      assert.strictEqual(res.status, 200);
    }
    for (const id of createdRoomIds) {
      const res = await fetch("http://localhost:8787/api/rooms/" + id);
      assert.strictEqual(res.status, 404);
    }
  });
});
