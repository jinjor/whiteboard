// @ts-ignore
import manifest from "__STATIC_CONTENT_MANIFEST";
// @ts-ignore
import { Router } from "itty-router";
import Cookie from "cookie";
import { encrypt, decrypt, digest, hmacSha256 } from "./crypto";
import * as github from "./github";
import * as slack from "./slack";
import { RoomPatch } from "./room-manager";
export { RateLimiter } from "./rate-limiter";
export { ChatRoom } from "./room";
export { RoomManager } from "./room-manager";
import {
  getAssetFromKV,
  MethodNotAllowedError,
  NotFoundError,
} from "@cloudflare/kv-asset-handler";
import { RoomInfo } from "../schema";

type Env = {
  manager: DurableObjectNamespace;
  rooms: DurableObjectNamespace;
  limiters: DurableObjectNamespace;

  DEBUG_API: "true" | "false";
} & (
  | {
      AUTH_TYPE: "header";
    }
  | {
      AUTH_TYPE: "user_agent";
    }
  | {
      AUTH_TYPE: "github";
      GITHUB_CLIENT_ID: string;
      GITHUB_CLIENT_SECRET: string;
      GITHUB_ORG: string;
      COOKIE_SECRET: string;
    }
  | {
      AUTH_TYPE: "slack";
      SLACK_CLIENT_ID: string;
      SLACK_CLIENT_SECRET: string;
      COOKIE_SECRET: string;
    }
) &
  (
    | {
        SLACK_APP: "true";
        SLACK_SIGNING_SECRET: string;
      }
    | {
        SLACK_APP: "false";
      }
  );

async function getAsset(
  request: Request,
  env: Env,
  context: ExecutionContext,
  modifyPath: (path: string) => string
): Promise<Response> {
  try {
    return await getAssetFromKV(
      {
        request,
        waitUntil(promise) {
          return context.waitUntil(promise);
        },
      },
      {
        ASSET_NAMESPACE: (env as any).__STATIC_CONTENT,
        ASSET_MANIFEST: manifest,
        // [mf:wrn] Cache operations will have no impact if you deploy to a workers.dev subdomain!
        cacheControl: {
          bypassCache: true,
        },
        mapRequestToAsset: (req) => {
          const url = new URL(req.url);
          url.pathname = modifyPath(url.pathname);
          return new Request(url.toString(), req);
        },
      }
    );
  } catch (e) {
    if (e instanceof NotFoundError || e instanceof MethodNotAllowedError) {
      return new Response("Not found.", { status: 404 });
    }
    throw e;
  }
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
    if (res.status === 200) {
      const roomInfo = await res.json();
      return new Response(JSON.stringify(roomInfo));
    }
    if (res.status === 403) {
      return new Response("Cannot create a room this time.", { status: 403 });
    }
    const errorMessage = await res.text();
    console.log(errorMessage);
    return new Response("Internal server error", {
      status: 500,
    });
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
      context: ExecutionContext,
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
      const roomStub = env.rooms.get(roomId);
      return roomStub.fetch("https://dummy-url/websocket", {
        headers: {
          Connection: "Upgrade",
          Upgrade: "websocket",
          "WB-USER-ID": userId,
        },
      });
    }
  )
  .get(
    "/rooms/:roomName/objects",
    async (
      request: Request & { params: { roomName: string } },
      env: Env,
      context: ExecutionContext,
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
      const roomStub = env.rooms.get(roomId);
      return roomStub.fetch("https://dummy-url/objects");
    }
  );

const router = Router()
  .all(
    "/debug/*",
    (req: Request, env: Env) => {
      if (env.DEBUG_API !== "true") {
        return new Response("Not found.", { status: 404 });
      }
    },
    debugRouter.handle
  )
  .all("/api/*", apiRouter.handle)
  .get("/assets/*", async (req: Request, env: Env, ctx: ExecutionContext) => {
    return getAsset(req, env, ctx, (path) => path.replace("/assets/", "/"));
  })
  .get("/", async (req: Request, env: Env, ctx: ExecutionContext) => {
    return getAsset(req, env, ctx, () => "/index.html");
  })
  .get("/rooms/:id", async (req: Request, env: Env, ctx: ExecutionContext) => {
    return getAsset(req, env, ctx, () => "/room.html");
  })
  .all("*", () => new Response("Not found.", { status: 404 }));

const GITHUB_SCOPE = "read:org";
const SLACK_SCOPE = "identity.basic";

const authRouter = Router()
  .get("/callback/github", async (request: Request, env: Env) => {
    if (env.AUTH_TYPE !== "github") {
      return new Response("Not found.", { status: 404 });
    }
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
    // const userId = isMemberOfOrg ? "gh/" + login : "_guest"; // "_guest" is an invalid github name
    const userId = "gh/" + login; // TODO: for debug

    const res = new Response(null, {
      status: 302,
      headers: {
        "Set-Cookie": Cookie.serialize(
          "session",
          await encrypt(env.COOKIE_SECRET, userId),
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
  .get("/callback/slack", async (request: Request, env: Env) => {
    if (env.AUTH_TYPE !== "slack") {
      return new Response("Not found.", { status: 404 });
    }
    const cookie = Cookie.parse(request.headers.get("Cookie") ?? "");
    const code = new URL(request.url).searchParams.get("code");
    if (code == null) {
      return new Response("Not found.", { status: 404 });
    }
    const { accessToken, scope } = await slack.getAccessToken(
      env.SLACK_CLIENT_ID,
      env.SLACK_CLIENT_SECRET,
      code
    );
    if (scope !== SLACK_SCOPE) {
      return new Response("Not found.", { status: 404 });
    }
    const name = await slack.getUserName(accessToken);
    console.log("login:", name);
    const isMemberOfOrg = true; // TODO: ?
    console.log("isMemberOfOrg:", isMemberOfOrg);
    // const userId = isMemberOfOrg ? "sl/" + login : "_guest"; // "_guest" is an invalid slack name <--- really?
    const userId = "sl/" + name; // TODO: for debug

    const res = new Response(null, {
      status: 302,
      headers: {
        "Set-Cookie": Cookie.serialize(
          "session",
          await encrypt(env.COOKIE_SECRET, userId),
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
  .post("/app/slack", async (request: Request, env: Env) => {
    if (env.SLACK_APP !== "true") {
      return new Response("Not found.", { status: 404 });
    }
    const timestamp = request.headers.get("X-Slack-Request-Timestamp");
    if (timestamp == null) {
      return new Response("invalid request", { status: 400 });
    }
    const ts = parseInt(timestamp);
    if (isNaN(ts)) {
      return new Response("invalid request", { status: 400 });
    }
    if (Date.now() / 1000 - ts > 10) {
      return new Response("invalid request", { status: 403 });
    }
    const actualSignature = request.headers.get("X-Slack-Signature");
    if (actualSignature == null) {
      return new Response("invalid request", { status: 400 });
    }
    const body = await request.text();
    const sigBaseString = `v0:${timestamp}:${body}`;
    const digest = await hmacSha256(sigBaseString, env.SLACK_SIGNING_SECRET);
    const expectedSignature = `v0=${digest}`;
    if (actualSignature !== expectedSignature) {
      console.log(
        "signature does not match",
        actualSignature,
        expectedSignature
      );
      return new Response("invalid request", { status: 403 });
    }
    const params = new URLSearchParams(body);
    const text = (params.get("text") ?? "").trim();
    switch (text) {
      case "": {
        const roomId = env.rooms.newUniqueId();
        const singletonId = env.manager.idFromName("singleton");
        const managerStub = env.manager.get(singletonId);
        const res = await managerStub.fetch(
          "https://dummy-url/rooms/" + roomId.toString(),
          {
            method: "PUT",
          }
        );
        const blocks = [];
        if (res.status === 200) {
          const host = "whiteboard.jinjor.workers.dev"; // TODO
          const url = `https://${host}/rooms/${roomId}`;
          blocks.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: `どうぞ！ ${url}`,
            },
          });
        } else if (res.status === 403) {
          blocks.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: `部屋がいっぱいです`,
            },
          });
        } else {
          blocks.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: `部屋の作成に失敗しました`,
            },
          });
        }
        return new Response(
          JSON.stringify({
            blocks,
            response_type: "in_channel",
          }),
          { headers: { "Content-type": "application/json" } }
        );
      }
      case "status": {
        const singletonId = env.manager.idFromName("singleton");
        const managerStub = env.manager.get(singletonId);
        const res = await managerStub.fetch("https://dummy-url/rooms");
        const rooms = (await res.json()) as RoomInfo[];
        const activeRooms = rooms
          .filter((room) => room.active)
          .sort((r1, r2) => {
            return r1.activeUntil - r2.activeUntil;
          });
        const maxActiveRooms = 10; // TODO: use variable
        const now = Date.now();
        const message = [
          `Total rooms: ${rooms.length}`,
          `Active rooms: ${activeRooms.length} / ${maxActiveRooms}`,
          ...activeRooms.map((room, i) => {
            const left = (room.activeUntil - now) / 1000; // seconds
            const formatted =
              left >= 3600
                ? Math.floor(left / 3600) + " hours"
                : Math.floor(left / 60) + " minutes";
            return `${i}: ${formatted} left`;
          }),
        ].join("\n");
        const blocks = [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: message,
            },
          },
        ];
        return new Response(
          JSON.stringify({
            blocks,
            response_type: "in_channel",
          }),
          { headers: { "Content-type": "application/json" } }
        );
      }
    }
  })
  .all("*", async (request: Request, env: Env, context: ExecutionContext) => {
    let userId;
    if (env.AUTH_TYPE === "header") {
      userId = request.headers.get("WB-TEST-USER");
      if (userId == null) {
        throw new Error("missing WB-TEST-USER");
      }
    } else if (env.AUTH_TYPE === "user_agent") {
      const userAgent = request.headers.get("User-Agent");
      if (!userAgent) {
        throw new Error("assertion error");
      }
      const hash = await digest(userAgent);
      userId = "ua/" + hash.slice(0, 7);
    } else if (env.AUTH_TYPE === "github") {
      const cookie = Cookie.parse(request.headers.get("Cookie") ?? "");
      console.log("cookie:", cookie);
      if (cookie.session != null) {
        try {
          const decrypted = await decrypt(env.COOKIE_SECRET, cookie.session);
          if (decrypted.startsWith("gh/")) {
            userId = decrypted;
          }
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
              secure: true, // TODO: switch
              sameSite: "strict",
            }),
            Location: github.makeFormUrl(env.GITHUB_CLIENT_ID, GITHUB_SCOPE),
          },
        });
      }
      if (userId === "_guest") {
        return new Response("Not a member of org.", { status: 403 });
      }
    } else if (env.AUTH_TYPE === "slack") {
      const cookie = Cookie.parse(request.headers.get("Cookie") ?? "");
      console.log("cookie:", cookie);
      if (cookie.session != null) {
        try {
          const decrypted = await decrypt(env.COOKIE_SECRET, cookie.session);
          if (decrypted.startsWith("sl/")) {
            userId = decrypted;
          }
        } catch (e) {}
      }
      if (userId == null) {
        const host = "whiteboard.jinjor.workers.dev"; // TODO
        const redirectUrl = `https://${host}/callback/slack`;
        // const redirectUrl = `http://localhost:8787/callback/slack`;
        return new Response(null, {
          status: 302,
          headers: {
            "Set-Cookie": Cookie.serialize("original_url", request.url, {
              path: "/",
              httpOnly: true,
              maxAge: 60,
              secure: true, // TODO: switch
              sameSite: "strict",
            }),
            Location: slack.makeFormUrl(
              env.SLACK_CLIENT_ID,
              SLACK_SCOPE,
              redirectUrl
            ),
          },
        });
      }
      if (userId === "_guest") {
        return new Response("Not a member of org.", { status: 403 });
      }
    }
    console.log("userId:", userId);
    if (userId == null) {
      throw new Error("assertion error");
    }
    const res: Response = await router.handle(request, env, context, userId);
    if (env.AUTH_TYPE === "github") {
      res.headers.set(
        "Set-Cookie",
        Cookie.serialize("session", await encrypt(env.COOKIE_SECRET, userId), {
          path: "/",
          httpOnly: true,
          maxAge: 60 * 60 * 24 * 7, // 1 week
          sameSite: "strict",
        })
      );
    }
    return res;
  });

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext) {
    console.log("Root's fetch(): " + request.method, request.url);
    console.log("AUTH_TYPE: " + env.AUTH_TYPE);
    let preconditionOk = true;
    if (!["true", "false"].includes(env.DEBUG_API)) {
      preconditionOk = false;
      console.log("DEBUG_API not valid");
    }
    if (!["header", "user_agent", "github", "slack"].includes(env.AUTH_TYPE)) {
      preconditionOk = false;
      console.log("AUTH_TYPE not valid");
    }
    if (env.AUTH_TYPE === "github") {
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
      if (!env.COOKIE_SECRET) {
        preconditionOk = false;
        console.log("COOKIE_SECRET not found");
      }
    }
    if (env.AUTH_TYPE === "slack") {
      if (!env.SLACK_CLIENT_ID) {
        preconditionOk = false;
        console.log("SLACK_CLIENT_ID not found");
      }
      if (!env.SLACK_CLIENT_SECRET) {
        preconditionOk = false;
        console.log("SLACK_CLIENT_SECRET not found");
      }
      if (!env.COOKIE_SECRET) {
        preconditionOk = false;
        console.log("COOKIE_SECRET not found");
      }
    }
    if (!["true", "false"].includes(env.SLACK_APP)) {
      preconditionOk = false;
      console.log("SLACK_APP not valid");
    }
    if (env.SLACK_APP === "true") {
      if (!env.SLACK_SIGNING_SECRET) {
        preconditionOk = false;
        console.log("SLACK_SIGNING_SECRET not found");
      }
    }
    if (!preconditionOk) {
      return new Response("Configuration Error", { status: 500 });
    }
    return await authRouter
      .handle(request, env, context)
      .catch((error: any) => {
        console.log(error.stack);
        return new Response("unexpected error", { status: 500 });
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
