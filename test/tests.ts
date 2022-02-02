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
  it("works", async function () {
    const res = await fetch("http://localhost:8787/");
    assert.strictEqual(res.status, 200);
  });
});
