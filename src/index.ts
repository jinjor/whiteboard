// @ts-ignore
import HTML from "./index.html";
import { Router } from "itty-router";
import Cookie from "cookie";
import { encrypt, decrypt } from "./crypto";

type Env = {
  manager: DurableObjectNamespace;
  rooms: DurableObjectNamespace;
  limiters: DurableObjectNamespace;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  GITHUB_ORG: string;
};
type User = {
  id: string;
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
    const atRes = await fetch(
      `https://github.com/login/oauth/access_token?client_id=${env.GITHUB_CLIENT_ID}&client_secret=${env.GITHUB_CLIENT_SECRET}&code=${code}`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
      }
    );
    const { access_token, scope } = await atRes.json();
    if (scope !== GITHUB_SCOPE) {
      return new Response("Not found.", { status: 404 });
    }
    const userRes = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github.v3+json",
        Authorization: `token ${access_token}`,
        "User-Agent": "node.js",
      },
    });
    const user: any = await userRes.json();
    const { login } = user;
    console.log("login:", login);
    const membershipRes = await fetch(
      `https://api.github.com/orgs/${env.GITHUB_ORG}/memberships/${login}`,
      {
        headers: {
          Accept: "application/vnd.github.v3+json",
          Authorization: `token ${access_token}`,
          "User-Agent": "node.js",
        },
      }
    );
    const isMemberOfOrg = membershipRes.status === 204;
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
      } else {
        return new Response(null, {
          status: 302,
          headers: {
            "Set-Cookie": Cookie.serialize("original_url", request.url, {
              path: "/",
              httpOnly: true,
              maxAge: 60,
              sameSite: "strict",
            }),
            Location: `https://github.com/login/oauth/authorize?client_id=${env.GITHUB_CLIENT_ID}&scope=${GITHUB_SCOPE}`,
          },
        });
      }
    } else {
      try {
        userId = await decrypt(COOKIE_SECRET, cookie.session);
      } catch (e) {
        return new Response(null, {
          status: 302,
          headers: {
            "Set-Cookie": Cookie.serialize("original_url", request.url, {
              path: "/",
              httpOnly: true,
              maxAge: 60,
              sameSite: "strict",
            }),
            Location: `https://github.com/login/oauth/authorize?client_id=${env.GITHUB_CLIENT_ID}&scope=${GITHUB_SCOPE}`,
          },
        });
      }
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

// =======================================================================================

type RoomInfo = {
  id: string;
  active: boolean;
  createdAt: number;
};
const MAX_ACTIVE_ROOMS = 10;
const LIVE_DURATION = 7 * 24 * 60 * 60 * 1000;
const ACTIVE_DURATION = 24 * 60 * 60 * 1000;
type RoomPatch = {
  id: string;
  active: boolean;
  alive: boolean;
};

class RoomManagerState {
  private storage: DurableObjectStorage;
  private MAX_ACTIVE_ROOMS;
  private LIVE_DURATION;
  private ACTIVE_DURATION;
  constructor(storage: DurableObjectStorage) {
    this.storage = storage;
    this.MAX_ACTIVE_ROOMS = MAX_ACTIVE_ROOMS;
    this.LIVE_DURATION = LIVE_DURATION;
    this.ACTIVE_DURATION = ACTIVE_DURATION;
  }
  async updateConfig(config: {
    MAX_ACTIVE_ROOMS?: number;
    LIVE_DURATION?: number;
    ACTIVE_DURATION?: number;
  }): Promise<void> {
    if (config.MAX_ACTIVE_ROOMS != null) {
      this.MAX_ACTIVE_ROOMS = config.MAX_ACTIVE_ROOMS;
    }
    if (config.LIVE_DURATION != null) {
      this.LIVE_DURATION = config.LIVE_DURATION;
    }
    if (config.ACTIVE_DURATION != null) {
      this.ACTIVE_DURATION = config.ACTIVE_DURATION;
    }
  }
  async getRoomInfo(roomId: string): Promise<RoomInfo | null> {
    const roomInfo = await this.storage.get(roomId);
    return (roomInfo ?? null) as RoomInfo | null;
  }
  async createRoomInfo(roomId: string): Promise<RoomInfo | null> {
    let activeRooms = 0;
    for (const roomInfo of await this.listRoomInfo()) {
      if (roomInfo.active) {
        activeRooms++;
      }
    }
    console.log("activeRooms:", activeRooms);
    if (activeRooms >= this.MAX_ACTIVE_ROOMS) {
      return null;
    }
    const roomInfo = {
      id: roomId,
      createdAt: Date.now(),
      active: true,
    };
    await this.setRoomInfo(roomInfo);
    return roomInfo;
  }
  async setRoomInfo(roomInfo: RoomInfo): Promise<void> {
    await this.storage.put(roomInfo.id, roomInfo);
  }
  async deleteRoomInfo(roomId: string): Promise<void> {
    await this.storage.delete(roomId);
  }
  async listRoomInfo(): Promise<RoomInfo[]> {
    const map = (await this.storage.list()) as Map<string, RoomInfo>;
    return [...map.values()];
  }
  async dryClean(): Promise<RoomPatch[]> {
    const list: RoomPatch[] = [];
    for (const roomInfo of await this.listRoomInfo()) {
      const now = Date.now();
      list.push({
        id: roomInfo.id,
        active: now - roomInfo.createdAt < this.ACTIVE_DURATION,
        alive: now - roomInfo.createdAt < this.LIVE_DURATION,
      });
    }
    return list;
  }
  async clean(patches: RoomPatch[]): Promise<void> {
    for (const patch of patches) {
      const roomInfo = await this.getRoomInfo(patch.id);
      if (roomInfo == null) {
        continue;
      }
      if (!patch.alive) {
        await this.deleteRoomInfo(roomInfo.id);
        continue;
      }
      if (!patch.active) {
        roomInfo.active = false;
        await this.setRoomInfo(roomInfo);
      }
    }
  }
  async reset(): Promise<void> {
    this.MAX_ACTIVE_ROOMS = MAX_ACTIVE_ROOMS;
    this.LIVE_DURATION = LIVE_DURATION;
    this.ACTIVE_DURATION = ACTIVE_DURATION;
    await this.storage.deleteAll();
  }
}

const roomManagerRouter = Router()
  .delete("/", async (request: Request, state: RoomManagerState) => {
    await state.reset();
    return new Response("null", { status: 200 });
  })
  .patch("/config", async (request: Request, state: RoomManagerState) => {
    const config = await request.json();
    await state.updateConfig(config as any);
    return new Response("null", { status: 200 });
  })
  .get("/clean", async (request: Request, state: RoomManagerState) => {
    const list = await state.dryClean();
    return new Response(JSON.stringify({ patches: list }), { status: 200 });
  })
  .post("/clean", async (request: Request, state: RoomManagerState) => {
    const { patches } = await request.json();
    await state.clean(patches);
    return new Response(JSON.stringify(null), { status: 200 });
  })
  .get(
    "/rooms/:roomId",
    async (
      request: Request & { params: { roomId: string } },
      state: RoomManagerState
    ) => {
      const roomId = request.params.roomId;
      const roomInfo = await state.getRoomInfo(roomId);
      if (roomInfo == null) {
        return new Response("Not found", { status: 404 });
      }
      return new Response(JSON.stringify(roomInfo), { status: 200 });
    }
  )
  .put(
    "/rooms/:roomId",
    async (
      request: Request & { params: { roomId: string } },
      state: RoomManagerState
    ) => {
      const roomId = request.params.roomId;
      const exsistingRoomInfo = await state.getRoomInfo(roomId);
      if (exsistingRoomInfo != null) {
        return new Response(JSON.stringify(exsistingRoomInfo), { status: 200 });
      }
      const newRoomInfo = await state.createRoomInfo(roomId);
      if (newRoomInfo == null) {
        return new Response("The maximum number of rooms has been reached.", {
          status: 403,
        });
      }
      return new Response(JSON.stringify(newRoomInfo), { status: 200 });
    }
  )
  .all("*", () => new Response("Not found.", { status: 404 }));

export class RoomManager implements DurableObject {
  private state: RoomManagerState;

  constructor(controller: any, env: Env) {
    this.state = new RoomManagerState(controller.storage);
  }
  async fetch(request: Request) {
    console.log("RoomManager's fetch(): " + request.method, request.url);
    return roomManagerRouter.handle(request, this.state).catch((error: any) => {
      return handleError(request, error);
    });
  }
}

// =======================================================================================

const MAX_ACTIVE_USERS = 10;

const roomRouter = Router()
  .post("/deactivate", async (request: Request, state: RoomState) => {
    await state.disconnectAllSessions();
    return new Response("null", { status: 200 });
  })
  .get("/websocket", async (request: Request, state: RoomState) => {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 400 });
    }
    const userId = request.headers.get("WB-USER-ID")!;
    if (!state.canStart(userId)) {
      return new Response("room is full", { status: 403 });
    }
    const pair = new WebSocketPair();

    // We're going to take pair[1] as our end, and return pair[0] to the client.
    await state.handleSession(pair[1], userId);

    // Now we return the other end of the pair to the client.
    // 101 Switching Protocols
    return new Response(null, { status: 101, webSocket: pair[0] });
  })
  .all("*", () => new Response("Not found.", { status: 404 }));

class RoomState {
  private storage: DurableObjectStorage;
  private env: Env;
  private sessions: ChatSession[];
  private lastTimestamp: number;
  constructor(controller: any, env: Env) {
    this.storage = controller.storage;
    this.env = env;
    // 各クライアントの WebSocket object とメタデータ
    this.sessions = [];
    // 同時にメッセージが来てもタイムスタンプを単調増加にするための仕掛け
    this.lastTimestamp = 0;
  }

  async disconnectAllSessions() {
    while (this.sessions.length > 0) {
      const session = this.sessions.pop()!;
      session.webSocket.close(1000);
    }
  }
  canStart(userId: string): boolean {
    if (this.sessions.some((session) => session.name === userId)) {
      return true;
    }
    return this.sessions.length < MAX_ACTIVE_USERS;
  }
  async handleSession(webSocket: WebSocket, userId: string): Promise<void> {
    webSocket.accept();

    const limiterId = this.env.limiters.idFromName(userId);
    const limiter = new RateLimiterClient(
      () => this.env.limiters.get(limiterId),
      (err) => webSocket.close(1011, err.stack)
    );

    // クライアントから info が送られてくるまで blockedMessages にキューしておく
    const session: ChatSession = {
      webSocket,
      blockedMessages: [],
      name: userId,
      quit: false,
    };
    // 同じユーザーは複数の接続を開始できない
    for (let i = this.sessions.length - 1; i >= 0; i--) {
      const session = this.sessions[i];
      if (session.name === userId) {
        session.webSocket.close(1000); // TODO: quit メッセージが送信されてしまう
      }
    }
    this.sessions.push(session);

    // 他のユーザの名前を詰めておく
    this.sessions.forEach((otherSession) => {
      session.blockedMessages.push(
        JSON.stringify({ joined: otherSession.name })
      );
    });

    // 最終 100 メッセージを詰めておく
    const storage = await this.storage.list({ reverse: true, limit: 100 });
    const backlog = [...storage.values()] as any[];
    backlog.reverse();
    backlog.forEach((value) => {
      session.blockedMessages.push(value);
    });

    let initialized = false;
    webSocket.addEventListener("message", async (msg: MessageEvent) => {
      try {
        if (session.quit) {
          // Whoops, when trying to send to this WebSocket in the past, it threw an exception and
          // we marked it broken. But somehow we got another message? I guess try sending a
          // close(), which might throw, in which case we'll try to send an error, which will also
          // throw, and whatever, at least we won't accept the message. (This probably can't
          // actually happen. This is defensive coding.)
          // 何を言ってるのかよく分からないが、とにかく普通ここには来ないらしい
          // 1011: Internal Error
          webSocket.close(1011, "WebSocket broken.");
          return;
        }

        // Check if the user is over their rate limit and reject the message if so.
        if (!limiter.checkLimit()) {
          webSocket.send(
            JSON.stringify({
              error: "Your IP is being rate-limited, please try again later.",
            })
          );
          return;
        }

        // I guess we'll use JSON.
        let data = JSON.parse(msg.data as string);

        if (!initialized) {
          // 溜めといたやつを送る
          session.blockedMessages.forEach((queued) => {
            webSocket.send(queued);
          });
          session.blockedMessages = [];

          // 名前を知らせる
          this.broadcast({ joined: session.name });

          webSocket.send(JSON.stringify({ ready: true }));

          initialized = true;
          return;
        }

        // Construct sanitized message for storage and broadcast.
        data = { name: session.name, message: "" + data.message };

        // クライアントでもチェックしているが迂回された場合
        if (data.message.length > 256) {
          webSocket.send(JSON.stringify({ error: "Message too long." }));
          return;
        }

        // タイムスタンプを単調増加に
        data.timestamp = Math.max(Date.now(), this.lastTimestamp + 1);
        this.lastTimestamp = data.timestamp;

        // Broadcast the message to all other WebSockets.
        const dataStr = JSON.stringify(data);
        this.broadcast(dataStr);

        // Save message.
        const key = new Date(data.timestamp).toISOString();
        await this.storage.put(key, dataStr);
      } catch (err: any) {
        // stack 返しているので本番ではやめる
        webSocket.send(JSON.stringify({ error: err.stack }));
      }
    });

    const closeOrErrorHandler = (evt: Event) => {
      session.quit = true;
      this.sessions = this.sessions.filter((member) => member !== session);
      this.broadcast({ quit: session.name });
    };
    webSocket.addEventListener("close", closeOrErrorHandler);
    webSocket.addEventListener("error", closeOrErrorHandler);
  }

  // broadcast() broadcasts a message to all clients.
  private broadcast(message: any) {
    // Apply JSON if we weren't given a string to start with.
    if (typeof message !== "string") {
      message = JSON.stringify(message);
    }

    // Iterate over all the sessions sending them messages.
    const quitters: ChatSession[] = [];
    this.sessions = this.sessions.filter((session) => {
      try {
        session.webSocket.send(message);
        return true;
      } catch (err) {
        // Whoops, this connection is dead. Remove it from the list and arrange to notify
        // everyone below.
        session.quit = true;
        quitters.push(session);
        return false;
      }
    });
    quitters.forEach((quitter) => {
      this.broadcast({ quit: quitter.name });
    });
  }
}

type ChatSession = {
  name: string;
  quit: boolean;
  webSocket: WebSocket;
  blockedMessages: string[];
};

export class ChatRoom implements DurableObject {
  private state: RoomState;
  constructor(controller: any, env: Env) {
    this.state = new RoomState(controller, env);
  }
  async fetch(request: Request) {
    return roomRouter.handle(request, this.state).catch((error: any) => {
      return handleError(request, error);
    });
  }
}

// =======================================================================================

class RateLimiterState {
  private nextAllowedTime: number;
  constructor() {
    this.nextAllowedTime = 0;
  }
  update(didAction: boolean): number {
    const now = Date.now() / 1000;
    this.nextAllowedTime = Math.max(now, this.nextAllowedTime);
    if (didAction) {
      // ５秒に１回アクションを起こして良い
      this.nextAllowedTime += 5;
    }
    return Math.max(0, this.nextAllowedTime - now - 20);
  }
}

const rateLimitRouter = Router()
  .get("*", (request: Request, state: RateLimiterState) => {
    const cooldown = state.update(false);
    return new Response(String(cooldown));
  })
  .post("*", (request: Request, state: RateLimiterState) => {
    const cooldown = state.update(true);
    return new Response(String(cooldown));
  });

// IP アドレス毎にインスタンスが作られる。このレートリミットはグローバル（部屋を跨ぐ）
export class RateLimiter implements DurableObject {
  private state: RateLimiterState;
  constructor(controller: any, env: Env) {
    this.state = new RateLimiterState();
  }
  async fetch(request: Request) {
    return rateLimitRouter.handle(request, this.state).catch((error: any) => {
      return handleError(request, error);
    });
  }
}

class RateLimiterClient {
  // The constructor takes two functions:
  // * getLimiterStub() returns a new Durable Object stub for the RateLimiter object that manages
  //   the limit. This may be called multiple times as needed to reconnect, if the connection is
  //   lost.
  // * reportError(err) is called when something goes wrong and the rate limiter is broken. It
  //   should probably disconnect the client, so that they can reconnect and start over.
  private getLimiterStub: () => DurableObjectStub;
  private reportError: (e: Error) => void;
  private limiter: any;
  private inCooldown: boolean;

  constructor(
    getLimiterStub: () => DurableObjectStub,
    reportError: (e: Error) => void
  ) {
    this.getLimiterStub = getLimiterStub;
    this.reportError = reportError;

    // Call the callback to get the initial stub.
    this.limiter = getLimiterStub();

    // 待ち中
    this.inCooldown = false;
  }

  // `false` を返したら reject
  checkLimit() {
    if (this.inCooldown) {
      return false;
    }
    this.inCooldown = true;
    this.callLimiter();
    return true;
  }

  // callLimiter() is an internal method which talks to the rate limiter.
  private async callLimiter() {
    try {
      let response;
      try {
        // `fetch` インターフェイスのためダミー URL が必要
        response = await this.limiter.fetch("https://dummy-url", {
          method: "POST",
        });
      } catch (err) {
        // `fetch()` threw an exception. This is probably because the limiter has been
        // disconnected. Stubs implement E-order semantics, meaning that calls to the same stub
        // are delivered to the remote object in order, until the stub becomes disconnected, after
        // which point all further calls fail. This guarantee makes a lot of complex interaction
        // patterns easier, but it means we must be prepared for the occasional disconnect, as
        // networks are inherently unreliable.
        //
        // Anyway, get a new limiter and try again. If it fails again, something else is probably
        // wrong.
        this.limiter = this.getLimiterStub();
        response = await this.limiter.fetch("https://dummy-url", {
          method: "POST",
        });
      }

      // 待ち時間
      const cooldown = +(await response.text());
      await new Promise((resolve) =>
        setTimeout(resolve as any, cooldown * 1000)
      );
      this.inCooldown = false;
    } catch (err: any) {
      this.reportError(err);
    }
  }
}
