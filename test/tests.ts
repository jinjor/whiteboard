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
  it("responds correct status", async function () {
    {
      const res = await fetch("http://localhost:8787/");
      assert.strictEqual(res.status, 200);
    }
    {
      const res = await fetch("http://localhost:8787/foo");
      assert.strictEqual(res.status, 404);
    }
    // TODO: 以下再考
    // {
    //   const res = await fetch("http://localhost:8787/rooms");
    //   assert.strictEqual(res.status, 404);
    // }
    // {
    //   const res = await fetch("http://localhost:8787/rooms/foo");
    //   assert.strictEqual(res.status, 404);
    // }
  });
  it("creates rooms", async function () {
    const res = await fetch("http://localhost:8787/api/rooms", {
      headers: {
        "WB-TEST-MAX_ACTIVE_ROOMS": String(2),
        "WB-TEST-LIVE_DURATION": String(5000),
        "WB-TEST-ACTIVE_DURATION": String(1000),
      },
      method: "POST",
    });
    const id = await res.text();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(id.length, 64);
    // TODO: GET 要らない？
    // {
    //   const res = await fetch("http://localhost:8787/api/rooms/" + id, {
    //     headers: {
    //       "WB-TEST-MAX_ACTIVE_ROOMS": String(2),
    //       "WB-TEST-LIVE_DURATION": String(5000),
    //       "WB-TEST-ACTIVE_DURATION": String(1000),
    //     },
    //     method: "GET",
    //   });
    //   const room = await res.text();
    //   assert.strictEqual(res.status, 200);
    //   console.log(room);
    // }
  });
});
