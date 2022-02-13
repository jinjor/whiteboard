// @ts-ignore
import HTML from "./index.html";
import { Router } from "itty-router";
import Cookie from "cookie";
import { encrypt, decrypt } from "./crypto";
import * as github from "./github";
import { RoomInfo, RoomPatch } from "./room-manager";
export { RateLimiter } from "./rate-limiter";
export { ChatRoom } from "./room";
export { RoomManager } from "./room-manager";

type Env = {
  manager: DurableObjectNamespace;
  rooms: DurableObjectNamespace;
  limiters: DurableObjectNamespace;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  GITHUB_ORG: string;
};

function handleError(request: Request, error: any) {
  console.log(error.stack);
  if (request.headers.get("Upgrade") == "websocket") {
    // Annoyingly, if we return an HTTP error in response to a WebSocket request, Chrome devtools
    // won't show us the response body! So... let's send a WebSocket response with an error
    // frame instead.
    const pair = new WebSocketPair();
    pair[1].accept();
    pair[1].send(JSON.stringify({ error: error.stack }));
    pair[1].close(1011, "Uncaught exception during session setup");
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  // stack 表示するため本番では消したい
  return new Response(error.stack, { status: 500 });
}
const debugRouter = Router({ base: "/debug" })
  .patch("/config", async (request: Request, env: Env) => {
    const config = await request.json();
    const singletonId = env.manager.idFromName("singleton");
    const managerStub = env.manager.get(singletonId);
    return await managerStub.fetch("https://dummy-url/config", {
      method: "PATCH",
      body: JSON.stringify(config),
    });
  })
  .post("/clean", async (request: Request, env: Env) => {
    await clean(env);
    return new Response();
  })
  .delete("/", async (request: Request, env: Env) => {
    const singletonId = env.manager.idFromName("singleton");
    const managerStub = env.manager.get(singletonId);
    return await managerStub.fetch("https://dummy-url", {
      method: "DELETE",
    });
  });
const apiRouter = Router({ base: "/api" })
  .post("/rooms", async (request: Request, env: Env) => {
    const roomId = env.rooms.newUniqueId();
    const singletonId = env.manager.idFromName("singleton");
    const managerStub = env.manager.get(singletonId);
    const res = await managerStub.fetch(
      "https://dummy-url/rooms/" + roomId.toString(),
      {
        method: "PUT",
      }
    );
    if (res.status !== 200) {
      // TODO: ?
      return new Response(roomId.toString(), {
        status: res.status,
      });
    }
    return new Response(roomId.toString());
  })
  .get(
    "/rooms/:roomName",
    async (request: Request & { params: { roomName: string } }, env: Env) => {
      const roomName = request.params.roomName;
      const singletonId = env.manager.idFromName("singleton");
      const managerStub = env.manager.get(singletonId);
      let roomId;
      try {
        roomId = env.rooms.idFromString(roomName);
      } catch (e) {
        return new Response("Not found.", { status: 404 });
      }
      const res = await managerStub.fetch(
        "https://dummy-url/rooms/" + roomId.toString(),
        request
      );
      if (res.status === 200) {
        const room: RoomInfo = await res.json();
        return new Response(
          JSON.stringify({ id: roomId.toString(), active: room.active })
        );
      }
      return res;
      // return new Response("Not found.", { status: 404 });
    }
  )
  .get(
    "/rooms/:roomName/websocket",
    async (
      request: Request & { params: { roomName: string } },
      env: Env,
      userId: string
    ) => {
      const roomName = request.params.roomName;
      let roomId;
      try {
        roomId = env.rooms.idFromString(roomName);
      } catch (e) {
        return new Response("Not found.", { status: 404 });
      }
      const singletonId = env.manager.idFromName("singleton");
      const managerStub = env.manager.get(singletonId);
      const res = await managerStub.fetch("https://dummy-url/rooms/" + roomId);
      if (res.status !== 200) {
        return new Response("Not found.", { status: 404 });
      }
      const room: RoomInfo = await res.json();
      if (!room.active) {
        // TODO: テスト
        console.log(room);
        return new Response("Cannot connect to an inactive room.", {
          status: 403,
        });
      }
      // スタブ（クライアント）が即時に作られる。リモートでは ID が最初に使われた時に必要に応じて作られる。
      const roomStub = env.rooms.get(roomId);

      return roomStub.fetch("https://dummy-url/websocket", {
        headers: {
          Connection: "Upgrade",
          Upgrade: "websocket",
          "WB-USER-ID": userId,
        },
      });
    }
  );

const router = Router()
  .get("/", () => {
    return new Response(HTML.slice(0), {
      headers: { "Content-Type": "text/html;charset=UTF-8" },
    });
  })
  .get("/rooms", () => {
    return new Response(HTML.slice(0), {
      headers: { "Content-Type": "text/html;charset=UTF-8" },
    });
  })
  .get("/rooms/:roomName", () => {
    return new Response(HTML.slice(0), {
      headers: { "Content-Type": "text/html;charset=UTF-8" },
    });
  })
  .all("/api/*", apiRouter.handle)
  // TODO: テストの場合のみに制限
  .all("/debug/*", debugRouter.handle)
  .all("*", () => new Response("Not found.", { status: 404 }));

const GITHUB_SCOPE = "read:org";
const COOKIE_SECRET = "test"; // TODO

const authRouter = Router()
  .get("/callback/github", async (request: Request, env: Env) => {
    const cookie = Cookie.parse(request.headers.get("Cookie") ?? "");
    const code = new URL(request.url).searchParams.get("code");
    if (code == null) {
      return new Response("Not found.", { status: 404 });
    }
    const { accessToken, scope } = await github.getAccessToken(
      env.GITHUB_CLIENT_ID,
      env.GITHUB_CLIENT_SECRET,
      code
    );
    if (scope !== GITHUB_SCOPE) {
      return new Response("Not found.", { status: 404 });
    }
    const login = await github.getUserLogin(accessToken);
    console.log("login:", login);
    const isMemberOfOrg = await github.isUserBelongsOrg(
      accessToken,
      login,
      env.GITHUB_ORG
    );
    console.log("isMemberOfOrg:", isMemberOfOrg);
    // const userId = isMemberOfOrg ? login : "_guest"; // "_guest" is an invalid github name
    const userId = login; // TODO: for debug

    const res = new Response(null, {
      status: 302,
      headers: {
        "Set-Cookie": Cookie.serialize(
          "session",
          await encrypt(COOKIE_SECRET, userId),
          {
            path: "/",
            httpOnly: true,
            maxAge: 60 * 60 * 24 * 7, // 1 week
            sameSite: "strict",
          }
        ),
        Location: cookie.original_url ?? `/`,
      },
    });
    return res;
  })
  .all("*", async (request: Request, env: Env) => {
    const cookie = Cookie.parse(request.headers.get("Cookie") ?? "");
    console.log("cookie:", cookie);
    let userId;
    if (cookie.session == null) {
      const testUserId = request.headers.get("WB-TEST-USER");
      if (testUserId != null) {
        userId = testUserId;
      }
    } else {
      try {
        userId = await decrypt(COOKIE_SECRET, cookie.session);
      } catch (e) {}
    }
    if (userId == null) {
      return new Response(null, {
        status: 302,
        headers: {
          "Set-Cookie": Cookie.serialize("original_url", request.url, {
            path: "/",
            httpOnly: true,
            maxAge: 60,
            sameSite: "strict",
          }),
          Location: github.makeFormUrl(env.GITHUB_CLIENT_ID, GITHUB_SCOPE),
        },
      });
    }
    console.log("userId:", userId);
    if (userId === "_guest") {
      return new Response("Not a member of org.", { status: 403 });
    }
    const res: Response = await router
      .handle(request, env, userId)
      .catch((error: any) => {
        return handleError(request, error);
      });
    res.headers.set(
      "Set-Cookie",
      Cookie.serialize("session", await encrypt(COOKIE_SECRET, userId), {
        path: "/",
        httpOnly: true,
        maxAge: 60 * 60 * 24 * 7, // 1 week
        sameSite: "strict",
      })
    );
    return res;
  });

export default {
  async fetch(request: Request, env: Env) {
    console.log("Root's fetch(): " + request.method, request.url);
    console.log(env);
    let preconditionOk = true;
    if (!env.GITHUB_CLIENT_ID) {
      preconditionOk = false;
      console.log("GITHUB_CLIENT_ID not found");
    }
    if (!env.GITHUB_CLIENT_SECRET) {
      preconditionOk = false;
      console.log("GITHUB_CLIENT_SECRET not found");
    }
    if (!env.GITHUB_ORG) {
      preconditionOk = false;
      console.log("GITHUB_ORG not found");
    }
    if (!preconditionOk) {
      // TODO: CI が落ちないようにする
      // return new Response("Configuration Error", { status: 500 });
    }
    return await authRouter.handle(request, env).catch((error: any) => {
      return handleError(request, error);
    });
  },
  async scheduled(event: { cron: string; scheduledTime: number }, env: Env) {
    await clean(env);
  },
};

async function clean(env: Env) {
  const singletonId = env.manager.idFromName("singleton");
  const managerStub = env.manager.get(singletonId);
  const res = await managerStub.fetch("https://dummy-url/clean");
  if (res.status !== 200) {
    throw new Error("failed to clean");
  }
  const { patches }: { patches: RoomPatch[] } = await res.json();
  for (const patch of patches) {
    // TODO: 消す方法
    if (!patch.active || !patch.alive) {
      const roomId = env.rooms.idFromString(patch.id);
      const roomStub = env.rooms.get(roomId);
      const res = await roomStub.fetch("https://dummy-url/deactivate", {
        method: "POST",
      });
      if (res.status !== 200) {
        throw new Error("failed to clean");
      }
    }
  }
  return managerStub.fetch("https://dummy-url/clean", {
    method: "POST",
    body: JSON.stringify({
      patches,
    }),
  });
}
