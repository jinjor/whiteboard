// @ts-ignore
import HTML from "./index.html";
import { Router } from "itty-router";

const MAX_ACTIVE_ROOMS = 10;
const LIVE_DURATION = 7 * 24 * 60 * 60 * 1000;
const ACTIVE_DURATION = 24 * 60 * 60 * 1000;

type Env = {
  manager: DurableObjectNamespace;
  rooms: DurableObjectNamespace;
  limiters: DurableObjectNamespace;
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

const apiRouter = Router({ base: "/api" })
  .post("/rooms", async (request: Request, env: Env) => {
    // TODO: ここでアクティブな部屋数の上限に達していたら 403

    const roomId = env.rooms.newUniqueId();
    const singletonId = env.manager.idFromName("singleton");
    const managerStub = env.manager.get(singletonId);
    const res = await managerStub.fetch(
      "https://dummy-url/rooms/" + roomId.toString(),
      {
        method: "PUT",
      }
      // TODO: request を渡す
    );
    if (res.status !== 200) {
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
      if (!roomName.match(/^[0-9a-f]{64}$/)) {
        return new Response("Invalid room name", { status: 400 });
      }
      const singletonId = env.manager.idFromName("singleton");
      const managerStub = env.manager.get(singletonId);
      const roomId = env.rooms.idFromString(roomName);
      const res = await managerStub.fetch(
        "https://dummy-url/rooms/" + roomId.toString(),
        request
      );
      if (res.status === 200) {
        return new Response(JSON.stringify({ id: roomId.toString() }));
      }
      return new Response("Not found.", { status: 404 });
    }
  )
  .all(
    "/rooms/:roomName/websocket",
    async (request: Request & { params: { roomName: string } }, env: Env) => {
      // TODO: ここでアクティブな部屋数の上限に達していたら 403

      const roomName = request.params.roomName;
      if (!roomName.match(/^[0-9a-f]{64}$/)) {
        return new Response("Invalid room name", { status: 400 });
      }
      const roomId = env.rooms.idFromString(roomName);

      const singletonId = env.manager.idFromName("singleton");
      const managerStub = env.manager.get(singletonId);
      const res = await managerStub.fetch("https://dummy-url/rooms/" + roomId);

      if (res.status !== 200) {
        return new Response("Not found.", { status: 404 });
      }

      // スタブ（クライアント）が即時に作られる。リモートでは ID が最初に使われた時に必要に応じて作られる。
      const roomStub = env.rooms.get(roomId);

      // TODO: 正確なインターフェイスが知りたい
      return roomStub.fetch(
        new URL("https://dummy-url/websocket") as any,
        request
      );
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
  .all("*", () => new Response("Not found.", { status: 404 }));

export default {
  async fetch(request: Request, env: Env) {
    console.log("Root's fetch(): " + request.method, request.url);
    return router.handle(request, env).catch((error: any) => {
      return handleError(request, error);
    });
  },
  async scheduled(event: { cron: string; scheduledTime: number }, env: Env) {
    const singletonId = env.manager.idFromName("singleton");
    const managerStub = env.manager.get(singletonId);
    const res = await managerStub.fetch("https://dummy-url/clean", {
      method: "POST",
    });
    // TODO: room の実体も clean する必要がある
  },
};

// =======================================================================================

class RoomManagerState {
  storage: DurableObjectStorage;
  constructor(storage: DurableObjectStorage) {
    this.storage = storage;
  }
}

const roomManagerRouter = Router()
  .get(
    "/rooms/:roomId",
    async (
      request: Request & { params: { roomId: string } },
      state: RoomManagerState
    ) => {
      const roomId = request.params.roomId;
      const roomInfo = await state.storage.get(roomId);
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
      const map = await state.storage.list();
      let activeRooms = 0;
      for (const [id, roomInfo] of map.entries() as any) {
        if (roomInfo.active) {
          activeRooms++;
        }
      }
      if (activeRooms >= MAX_ACTIVE_ROOMS) {
        return new Response("The maximum number of rooms has been reached.", {
          status: 403,
        });
      }
      const roomInfo = {
        roomId,
        createdAt: Date.now(),
        active: true,
      };
      await state.storage.put(roomId, roomInfo);
      return new Response(JSON.stringify(roomInfo), { status: 200 });
    }
  )
  .post(
    "/clean",
    async (
      request: Request & { params: { roomId: string } },
      state: RoomManagerState
    ) => {
      const roomId = request.params.roomId;
      const map = (await state.storage.list()) as any;
      for (const [id, roomInfo] of map.entries()) {
        const now = Date.now();
        if (now - roomInfo.createdAt > LIVE_DURATION) {
          await state.storage.delete(id);
          continue;
        }
        if (now - roomInfo.createdAt > ACTIVE_DURATION) {
          roomInfo.active = false;
          await state.storage.put(id, roomInfo);
          continue;
        }
      }
      return new Response("null", { status: 200 });
    }
  )
  .all("*", () => new Response("Not found.", { status: 404 }));

export class RoomManager implements DurableObject {
  private state: RoomManagerState;

  constructor(controller: any, env: Env) {
    this.state = new RoomManagerState(controller.storage);
  }
  async fetch(request: Request) {
    console.log("Root's fetch(): " + request.method, request.url);
    return roomManagerRouter.handle(request, this.state).catch((error: any) => {
      return handleError(request, error);
    });
  }
}

// =======================================================================================

const roomRouter = Router()
  .all("/websocket", async (request: Request, state: RoomState) => {
    if (request.headers.get("Upgrade") != "websocket") {
      return new Response("expected websocket", { status: 400 });
    }
    // TODO: ip は今回多分使わない
    const ip = request.headers.get("CF-Connecting-IP")!;
    const pair = new WebSocketPair();

    // We're going to take pair[1] as our end, and return pair[0] to the client.
    await state.handleSession(pair[1], ip);

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

  // handleSession() implements our WebSocket-based chat protocol.
  async handleSession(webSocket: WebSocket, ip: string) {
    // Accept our end of the WebSocket. This tells the runtime that we'll be terminating the
    // WebSocket in JavaScript, not sending it elsewhere.
    webSocket.accept();

    // Set up our rate limiter client.
    const limiterId = this.env.limiters.idFromName(ip);
    const limiter = new RateLimiterClient(
      () => this.env.limiters.get(limiterId),
      (err) => webSocket.close(1011, err.stack)
    );

    // クライアントから info が送られてくるまで blockedMessages にキューしておく
    const session: ChatSession = { webSocket, blockedMessages: [] };
    this.sessions.push(session);

    // 他のユーザの名前を詰めておく
    this.sessions.forEach((otherSession) => {
      if (otherSession.name) {
        session.blockedMessages.push(
          JSON.stringify({ joined: otherSession.name })
        );
      }
    });

    // 最終 100 メッセージを詰めておく
    const storage = await this.storage.list({ reverse: true, limit: 100 });
    const backlog = [...storage.values()] as any[];
    backlog.reverse();
    backlog.forEach((value) => {
      session.blockedMessages.push(value);
    });

    // Set event handlers to receive messages.
    let receivedUserInfo = false;
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

        if (!receivedUserInfo) {
          // 初回はユーザー情報を受け取る
          session.name = "" + (data.name || "anonymous");

          // 1009: Message too big
          if (session.name.length > 32) {
            webSocket.send(JSON.stringify({ error: "Name too long." }));
            webSocket.close(1009, "Name too long.");
            return;
          }

          // 溜めといたやつを送る
          session.blockedMessages.forEach((queued) => {
            webSocket.send(queued);
          });
          session.blockedMessages = [];

          // 名前を知らせる
          this.broadcast({ joined: session.name });

          webSocket.send(JSON.stringify({ ready: true }));

          receivedUserInfo = true;

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

    // On "close" and "error" events, remove the WebSocket from the sessions list and broadcast
    // a quit message.
    const closeOrErrorHandler = (evt: Event) => {
      session.quit = true;
      this.sessions = this.sessions.filter((member) => member !== session);
      if (session.name) {
        this.broadcast({ quit: session.name });
      }
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
      if (session.name) {
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
      } else {
        // This session hasn't sent the initial user info message yet, so we're not sending them
        // messages yet (no secret lurking!). Queue the message to be sent later.
        session.blockedMessages.push(message);
        return true;
      }
    });

    quitters.forEach((quitter) => {
      if (quitter.name) {
        this.broadcast({ quit: quitter.name });
      }
    });
  }
}

type ChatSession = {
  name?: string;
  quit?: boolean;
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
