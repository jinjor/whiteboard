// @ts-ignore
import { Router } from "itty-router";
import Cookie from "cookie";
import { digest, hmacSha256 } from "./crypto";
import { GitHubOAuth } from "./github";
import { SlackOAuth } from "./slack";
import { RoomPatch } from "./room-manager";
export { Room } from "./room";
export { RoomManager } from "./room-manager";
import { RoomInfo, SessionUser, User } from "../schema";
import { check, handleCallback, OAuth } from "./oauth";
import { Config } from "./config";
import {
  getDurableObjectNamespaces,
  getDurableObjects,
} from "./cloudflare-api";
import {
  DurableObjectClient,
  getAsset,
  immediatelyCloseWebSocket,
} from "./worker-util";

class RoomManagerClient extends DurableObjectClient {
  constructor(ns: DurableObjectNamespace) {
    super(ns, ns.idFromName("singleton"));
  }
}
class RoomClient extends DurableObjectClient {
  constructor(ns: DurableObjectNamespace, roomId: string) {
    super(ns, ns.idFromString(roomId));
  }
}
function isRoomIdValid(ns: DurableObjectNamespace, roomId: string): boolean {
  try {
    ns.idFromString(roomId);
  } catch (e) {
    return false;
  }
  return true;
}

type Env = {
  manager: DurableObjectNamespace;
  rooms: DurableObjectNamespace;

  DEBUG_API: "true" | "false";
  ADMIN_KEY: string;
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

async function respondNotFoundHtml(
  request: Request,
  env: Env,
  ctx: ExecutionContext
) {
  return getAsset(request, env, ctx, () => "/404.html", 404);
}

const debugRouter = Router({ base: "/debug" })
  .patch("/config", async (request: Request, env: Env) => {
    const config = await request.json();
    const managerClient = new RoomManagerClient(env.manager);
    return await managerClient.fetch("/config", {
      method: "PATCH",
      body: JSON.stringify(config),
    });
  })
  .patch(
    "/rooms/:roomId/config",
    async (request: Request & { params: { roomId: string } }, env: Env) => {
      const config = await request.json();
      const roomId = request.params.roomId;
      if (!isRoomIdValid(env.rooms, roomId)) {
        return new Response("Not found.", { status: 404 });
      }
      const roomClient = new RoomClient(env.rooms, roomId);
      return roomClient.fetch("/config", {
        method: "PATCH",
        body: JSON.stringify(config),
      });
    }
  )
  .post("/clean", async (request: Request, env: Env) => {
    await clean(env);
    return new Response();
  })
  .delete("/", async (request: Request, env: Env) => {
    const managerClient = new RoomManagerClient(env.manager);
    return await managerClient.fetch("/", {
      method: "DELETE",
    });
  });

const adminRouter = Router({ base: "/admin" }).delete(
  "/gc",
  async (request: Request, env: Env) => {
    const CLOUDFLARE_API_TOKEN = request.headers.get("WB-CLOUDFLARE_API_TOKEN");
    const body: any = await request.json();
    const { scriptName, accountId } = body;
    if (
      CLOUDFLARE_API_TOKEN == null ||
      scriptName == null ||
      accountId == null
    ) {
      return new Response("Invalid request", { status: 400 });
    }
    const config = {
      accountId,
      CLOUDFLARE_API_TOKEN,
    };
    const namespaces = await getDurableObjectNamespaces(config, scriptName);
    const roomNamespace = namespaces.find((ns) => ns.class === "Room");
    if (roomNamespace == null) {
      return new Response("Unexpected", { status: 500 });
    }
    const roomObjects = await getDurableObjects(config, roomNamespace.id);
    const deleted = [];
    for (const { id } of roomObjects) {
      const managerClient = new RoomManagerClient(env.manager);
      const res = await managerClient.fetch("/rooms/" + id);
      if (res.status === 404) {
        const roomClient = new RoomClient(env.rooms, id);
        const res = await roomClient.fetch("/", { method: "DELETE" });
        if (res.status !== 200) {
          throw new Error("failed to execute GC");
        }
        deleted.push(id);
      }
    }
    return new Response(JSON.stringify({ deleted }));
  }
);

const apiRouter = Router({ base: "/api" })
  .post("/rooms", async (request: Request, env: Env) => {
    const roomId = env.rooms.newUniqueId();
    const manager = new RoomManagerClient(env.manager);
    const res = await manager.fetch("/rooms/" + roomId, { method: "PUT" });
    if (res.status === 200) {
      const roomInfo = await res.json();
      return new Response(JSON.stringify(roomInfo));
    }
    if (res.status === 403) {
      return new Response("Cannot create a room this time.", { status: 403 });
    }
    const errorMessage = await res.text();
    console.log(errorMessage);
    return new Response("Internal server error", { status: 500 });
  })
  .get(
    "/rooms/:roomId",
    async (request: Request & { params: { roomId: string } }, env: Env) => {
      const roomId = request.params.roomId;
      const manager = new RoomManagerClient(env.manager);
      if (!isRoomIdValid(env.rooms, roomId)) {
        return new Response("Not found.", { status: 404 });
      }
      const res = await manager.fetch("/rooms/" + roomId);
      if (res.status === 200) {
        const room: RoomInfo = await res.json();
        return new Response(
          JSON.stringify({ id: roomId.toString(), active: room.active })
        );
      }
      return res;
    }
  )
  .get(
    "/rooms/:roomId/websocket",
    async (
      request: Request & { params: { roomId: string } },
      env: Env,
      context: ExecutionContext,
      user: User
    ) => {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("expected websocket", { status: 400 });
      }
      const roomId = request.params.roomId;
      if (!isRoomIdValid(env.rooms, roomId)) {
        return immediatelyCloseWebSocket(4000, "room_not_found");
      }
      const manager = new RoomManagerClient(env.manager);
      const res = await manager.fetch("/rooms/" + roomId);
      if (res.status !== 200) {
        return immediatelyCloseWebSocket(4000, "room_not_found");
      }
      const room: RoomInfo = await res.json();
      if (!room.active) {
        return immediatelyCloseWebSocket(4000, "room_not_active");
      }
      const roomClient = new RoomClient(env.rooms, roomId);
      return roomClient.fetch("/websocket", {
        headers: {
          Connection: "Upgrade",
          Upgrade: "websocket",
          "WB-USER-ID": user.id,
          "WB-USER-NAME": user.name,
          "WB-USER-IMAGE": user.image ?? "",
        },
      });
    }
  )
  .get(
    "/rooms/:roomId/objects",
    async (request: Request & { params: { roomId: string } }, env: Env) => {
      const roomId = request.params.roomId;
      if (!isRoomIdValid(env.rooms, roomId)) {
        return new Response("Not found.", { status: 404 });
      }
      const manager = new RoomManagerClient(env.manager);
      const res = await manager.fetch("/rooms/" + roomId);
      if (res.status !== 200) {
        return new Response("Not found.", { status: 404 });
      }
      const roomClient = new RoomClient(env.rooms, roomId);
      return roomClient.fetch("/objects");
    }
  );

const router = Router()
  .all(
    "/debug/*",
    async (request: Request, env: Env, ctx: ExecutionContext) => {
      if (env.DEBUG_API !== "true") {
        return respondNotFoundHtml(request, env, ctx);
      }
    },
    debugRouter.handle
  )
  .all("/api/*", apiRouter.handle)
  .get(
    "/rooms/:roomId",
    async (
      request: Request & { params: { roomId: string } },
      env: Env,
      ctx: ExecutionContext
    ) => {
      const roomId = request.params.roomId;
      if (!isRoomIdValid(env.rooms, roomId)) {
        return respondNotFoundHtml(request, env, ctx);
      }
      const manager = new RoomManagerClient(env.manager);
      const res = await manager.fetch("/rooms/" + roomId);
      if (res.status === 200) {
        return getAsset(request, env, ctx, () => "/room.html");
      }
      return respondNotFoundHtml(request, env, ctx);
    }
  )
  .all("*", async (request: Request, env: Env, ctx: ExecutionContext) => {
    return respondNotFoundHtml(request, env, ctx);
  });

const authRouter = Router()
  .get("/", async (req: Request, env: Env, ctx: ExecutionContext) => {
    const res = await getAsset(req, env, ctx, () => "/index.html");
    return preserveSession(req, res);
  })
  .get("/assets/*", async (req: Request, env: Env, ctx: ExecutionContext) => {
    return getAsset(req, env, ctx, (path) => path.replace("/assets/", "/"));
  })
  .all(
    "/admin/*",
    async (request: Request, env: Env, ctx: ExecutionContext) => {
      if (
        env.ADMIN_KEY == null ||
        env.ADMIN_KEY != request.headers.get("WB-ADMIN_KEY")
      ) {
        return respondNotFoundHtml(request, env, ctx);
      }
    },
    adminRouter.handle
  )
  .get("/callback/*", async (request: Request, env: Env) => {
    let auth: OAuth;
    switch (env.AUTH_TYPE) {
      case "github": {
        auth = new GitHubOAuth(env);
        break;
      }
      case "slack": {
        auth = new SlackOAuth(env);
        break;
      }
      default: {
        return new Response("Not found.", { status: 404 });
      }
    }
    return await handleCallback(request, auth, env.COOKIE_SECRET);
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
      console.log("signature does not match");
      return new Response("invalid request", { status: 403 });
    }
    const params = new URLSearchParams(body);
    const text = (params.get("text") ?? "").trim();
    // Note: `mrkdwn` format
    // https://api.slack.com/reference/surfaces/formatting
    switch (text) {
      case "": {
        const roomId = env.rooms.newUniqueId();
        const manager = new RoomManagerClient(env.manager);
        const res = await manager.fetch("/rooms/" + roomId, {
          method: "PUT",
        });
        const blocks = [];
        if (res.status === 200) {
          const url = `${new URL(request.url).origin}/rooms/${roomId}`;
          blocks.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: `Here you are: <${url}|*Enter*>`,
            },
          });
        } else if (res.status === 403) {
          blocks.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: `The number of active rooms has reached the limit. Type \`/wb status\` to check the situation.`,
            },
          });
        } else {
          blocks.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: `Filed to create a room...`,
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
        const manager = new RoomManagerClient(env.manager);
        const configRes = await manager.fetch("/config");
        const config = (await configRes.json()) as Partial<Config>;
        const roomsRes = await manager.fetch("/rooms");
        const rooms = (await roomsRes.json()) as RoomInfo[];
        const activeRooms = rooms
          .filter((room) => room.active)
          .sort((r1, r2) => {
            return r1.activeUntil - r2.activeUntil;
          });
        const now = Date.now();
        const message = [
          `Total rooms: ${rooms.length}`,
          `Active rooms: *${activeRooms.length} / ${config.MAX_ACTIVE_ROOMS}*`,
          ...activeRooms.map((room, i) => {
            const left = (room.activeUntil - now) / 1000; // seconds
            const formatted =
              left >= 3600
                ? Math.floor(left / 3600) + " hours"
                : Math.floor(left / 60) + " minutes";
            return `[${i}] ${formatted} left`;
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
    let user: SessionUser;
    if (env.AUTH_TYPE === "header") {
      const userId = request.headers.get("WB-TEST-USER");
      if (userId == null) {
        throw new Error("missing WB-TEST-USER");
      }
      user = { id: userId, name: userId, image: null };
    } else if (env.AUTH_TYPE === "user_agent") {
      const uaHash = await getUserAgentHash(request);
      const userId = "ua/" + uaHash.slice(0, 7);
      user = { id: userId, name: userId, image: null };
    } else {
      let oauth: OAuth;
      switch (env.AUTH_TYPE) {
        case "github": {
          oauth = new GitHubOAuth(env);
          break;
        }
        case "slack": {
          oauth = new SlackOAuth(env);
          break;
        }
      }
      const result = await check(request, oauth, env.COOKIE_SECRET);
      if (!result.ok) {
        return result.response;
      }
      const uaHash = await getUserAgentHash(request);
      user = {
        id: result.user.id + "/" + uaHash,
        name: result.user.name,
        image: result.user.image,
      };
    }
    console.log("user:", user);
    if (user == null) {
      throw new Error("assertion error");
    }
    const res: Response = await router.handle(request, env, context, user);
    return preserveSession(request, res);
  });

async function getUserAgentHash(request: Request) {
  const userAgent = request.headers.get("User-Agent") ?? "";
  const hash = await digest(userAgent);
  return hash.slice(0, 7);
}

function preserveSession(req: Request, res: Response): Response {
  const cookie = Cookie.parse(req.headers.get("Cookie") ?? "");
  if (cookie.session == null) {
    return res;
  }
  res = new Response(res.body, res);
  res.headers.set(
    "Set-Cookie",
    Cookie.serialize("session", cookie.session, {
      path: "/",
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 7, // 1 week
      secure: true,
      sameSite: "strict",
    })
  );
  return res;
}

function isEnvValid(env: Env): boolean {
  let ok = true;
  if (!["true", "false"].includes(env.DEBUG_API)) {
    ok = false;
    console.log("DEBUG_API not valid");
  }
  if (!["header", "user_agent", "github", "slack"].includes(env.AUTH_TYPE)) {
    ok = false;
    console.log("AUTH_TYPE not valid");
  }
  if (env.AUTH_TYPE === "github") {
    if (!env.GITHUB_CLIENT_ID) {
      ok = false;
      console.log("GITHUB_CLIENT_ID not found");
    }
    if (!env.GITHUB_CLIENT_SECRET) {
      ok = false;
      console.log("GITHUB_CLIENT_SECRET not found");
    }
    if (!env.GITHUB_ORG) {
      ok = false;
      console.log("GITHUB_ORG not found");
    }
    if (!env.COOKIE_SECRET) {
      ok = false;
      console.log("COOKIE_SECRET not found");
    }
  }
  if (env.AUTH_TYPE === "slack") {
    if (!env.SLACK_CLIENT_ID) {
      ok = false;
      console.log("SLACK_CLIENT_ID not found");
    }
    if (!env.SLACK_CLIENT_SECRET) {
      ok = false;
      console.log("SLACK_CLIENT_SECRET not found");
    }
    if (!env.COOKIE_SECRET) {
      ok = false;
      console.log("COOKIE_SECRET not found");
    }
  }
  if (!["true", "false"].includes(env.SLACK_APP)) {
    ok = false;
    console.log("SLACK_APP not valid");
  }
  if (env.SLACK_APP === "true") {
    if (!env.SLACK_SIGNING_SECRET) {
      ok = false;
      console.log("SLACK_SIGNING_SECRET not found");
    }
  }
  return ok;
}

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext) {
    console.log("Root's fetch(): " + request.method, request.url);
    if (!isEnvValid(env)) {
      return new Response("Configuration Error", { status: 500 });
    }
    return await authRouter
      .handle(request, env, context)
      .catch((error: unknown) => {
        console.log(error);
        return new Response("unexpected error", { status: 500 });
      });
  },
  async scheduled(event: { cron: string; scheduledTime: number }, env: Env) {
    await clean(env);
  },
};
async function clean(env: Env) {
  const manager = new RoomManagerClient(env.manager);
  const res = await manager.fetch("/clean");
  if (res.status !== 200) {
    throw new Error("failed to clean");
  }
  const { patches }: { patches: RoomPatch[] } = await res.json();
  for (const patch of patches) {
    const roomClient = new RoomClient(env.rooms, patch.id);
    if (!patch.active) {
      const res = await roomClient.fetch("/deactivate", { method: "POST" });
      if (res.status !== 200) {
        throw new Error("failed to clean");
      }
    }
    if (!patch.alive) {
      const res = await roomClient.fetch("/", { method: "DELETE" });
      if (res.status !== 200) {
        throw new Error("failed to clean");
      }
    }
    if (patch.active && patch.alive) {
      const res = await roomClient.fetch("/cooldown", { method: "POST" });
      if (res.status !== 200) {
        throw new Error("failed to clean");
      }
    }
  }
  return manager.fetch("/clean", {
    method: "POST",
    body: JSON.stringify({
      patches,
    }),
  });
}
