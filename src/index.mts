import HTML from "./html.mjs";

const MAX_ACTIVE_ROOMS = 10;
const LIVE_DURATION = 7 * 24 * 60 * 60 * 1000;
const ACTIVE_DURATION = 24 * 60 * 60 * 1000;

type Env = {
  manager: DurableObjectNamespace;
  rooms: DurableObjectNamespace;
  limiters: DurableObjectNamespace;
};

// エラーを 500 にする
async function handleErrors(request: Request, func: Function) {
  try {
    return await func();
  } catch (err: any) {
    if (request.headers.get("Upgrade") == "websocket") {
      // Annoyingly, if we return an HTTP error in response to a WebSocket request, Chrome devtools
      // won't show us the response body! So... let's send a WebSocket response with an error
      // frame instead.
      const pair = new WebSocketPair();
      pair[1].accept();
      pair[1].send(JSON.stringify({ error: err.stack }));
      pair[1].close(1011, "Uncaught exception during session setup");
      return new Response(null, { status: 101, webSocket: pair[0] });
    } else {
      // stack 表示するため本番では消したい
      return new Response(err.stack, { status: 500 });
    }
  }
}

export default {
  async fetch(request: Request, env: Env) {
    return await handleErrors(request, async () => {
      const url = new URL(request.url);
      const path = url.pathname.slice(1).split("/");

      if (!path[0]) {
        // Serve our HTML at the root path.
        return new Response(HTML.slice(0), {
          headers: { "Content-Type": "text/html;charset=UTF-8" },
        });
      }

      switch (path[0]) {
        case "rooms":
          return new Response(HTML.slice(0), {
            headers: { "Content-Type": "text/html;charset=UTF-8" },
          });
        case "api":
          return handleApiRequest(path.slice(1), request, env);
        default:
          return new Response("Not found", { status: 404 });
      }
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

async function handleApiRequest(path: string[], request: Request, env: Env) {
  switch (path[0]) {
    case "rooms": {
      if (!path[1]) {
        if (request.method == "POST") {
          // POST /api/rooms

          // TODO: ここでアクティブな部屋数の上限に達していたら 403

          // room 名前空間内で一意な ID
          const id = env.rooms.newUniqueId();

          // TODO: ここで managed rooms に id を登録する

          return new Response(id.toString(), {
            headers: { "Access-Control-Allow-Origin": "*" },
          });
        } else {
          // GET はサポートしない
          return new Response("Method not allowed", { status: 405 });
        }
      }

      // `/api/room/<name>/...`
      const name = path[1];
      if (!name.match(/^[0-9a-f]{64}$/)) {
        return new Response("Invalid room name", { status: 400 });
      }
      const id = env.rooms.idFromString(name);

      // TODO: ここで id を作成済みであることを確認する必要がある
      // managed rooms に存在しない場合は 404

      console.log("name: " + name);
      console.log("id: " + id);

      // スタブ（クライアント）が即時に作られる。リモートでは ID が最初に使われた時に必要に応じて作られる。
      const roomObject = env.rooms.get(id);

      // `/api/room/<name>/...` の ... 部分
      const newUrl = new URL(request.url);
      newUrl.pathname = "/" + path.slice(2).join("/");
      return roomObject.fetch(newUrl as any, request); // 型定義がおかしい？
    }

    default:
      return new Response("Not found", { status: 404 });
  }
}

// =======================================================================================

export class RoomManager implements DurableObject {
  private storage: any;
  private env: Env;

  constructor(controller: any, env: Env) {
    this.storage = controller.storage;
    this.env = env;
  }

  async fetch(request: Request) {
    return await handleErrors(request, async () => {
      const url = new URL(request.url);
      console.log("RoomManager's fetch(): " + request.method, request.url);

      const path = url.pathname.slice(1).split("/");

      switch (path[0]) {
        case "rooms": {
          // `/rooms`
          if (!path[1]) {
            return new Response("Not found", { status: 404 });
          }
          if (path[3]) {
            return new Response("Not found", { status: 404 });
          }
          // `/rooms/{id}`
          const id = path[2];

          if (request.method === "GET") {
            const roomInfo = await this.storage.get(id);
            return new Response(JSON.stringify(roomInfo), { status: 500 });
          }
          if (request.method === "PUT") {
            const map = await this.storage.list();
            let activeRooms = 0;
            for (const [id, roomInfo] of map.entries()) {
              if (roomInfo.active) {
                activeRooms++;
              }
            }
            if (activeRooms >= MAX_ACTIVE_ROOMS) {
              return new Response(
                "The maximum number of rooms has been reached.",
                { status: 403 }
              );
            }
            const roomInfo = {
              id,
              createdAt: Date.now(),
              active: true,
            };
            await this.storage.put(id, roomInfo);
            return new Response(JSON.stringify(roomInfo), { status: 200 });
          }
          return new Response("Not found", { status: 404 });
        }
        case "clean": {
          if (request.method === "POST") {
            // タイムスタンプ見てガベコレ
            const map = await this.storage.list();
            for (const [id, roomInfo] of map.entries()) {
              const now = Date.now();
              if (now - roomInfo.createdAt > LIVE_DURATION) {
                await this.storage.delete(id);
                continue;
              }
              if (now - roomInfo.createdAt > ACTIVE_DURATION) {
                roomInfo.active = false;
                await this.storage.put(id, roomInfo);
                continue;
              }
            }
            return new Response("", { status: 200 });
          }
          return new Response("Not found", { status: 404 });
        }
        default: {
          return new Response("Not found", { status: 404 });
        }
      }
    });
  }
}

// =======================================================================================

type ChatSession = {
  name?: string;
  quit?: boolean;
  webSocket: WebSocket;
  blockedMessages: string[];
};

export class ChatRoom implements DurableObject {
  private storage: any;
  private env: Env;
  private sessions: ChatSession[];
  private lastTimestamp: number;
  constructor(controller: any, env: Env) {
    // get()/put() を持つ Durable Storage
    this.storage = controller.storage;
    this.env = env;

    // 各クライアントの WebSocket object とメタデータ
    this.sessions = [];

    // 同時にメッセージが来てもタイムスタンプを単調増加にするための仕掛け
    this.lastTimestamp = 0;
  }

  async fetch(request: Request) {
    return await handleErrors(request, async () => {
      const url = new URL(request.url);
      console.log("ChatRoom's fetch(): " + request.method, request.url);

      switch (url.pathname) {
        case "/websocket": {
          if (request.headers.get("Upgrade") != "websocket") {
            return new Response("expected websocket", { status: 400 });
          }
          // TODO: ip は今回多分使わない
          const ip = request.headers.get("CF-Connecting-IP")!;
          const pair = new WebSocketPair();

          // We're going to take pair[1] as our end, and return pair[0] to the client.
          await this.handleSession(pair[1], ip);

          // Now we return the other end of the pair to the client.
          // 101 Switching Protocols
          return new Response(null, { status: 101, webSocket: pair[0] });
        }

        default:
          return new Response("Not found", { status: 404 });
      }
    });
  }

  // handleSession() implements our WebSocket-based chat protocol.
  private async handleSession(webSocket: WebSocket, ip: string) {
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
    const backlog = [...storage.values()];
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

// =======================================================================================

// IP アドレス毎にインスタンスが作られる。このレートリミットはグローバル（部屋を跨ぐ）
export class RateLimiter implements DurableObject {
  private nextAllowedTime: number;
  constructor(controller: any, env: Env) {
    this.nextAllowedTime = 0;
  }

  // POST はアクションがあった時。GET は単に取得するとき。
  // 両方とも次のアクションまでの待ち時間を返す
  async fetch(request: Request) {
    return await handleErrors(request, async () => {
      let now = Date.now() / 1000;

      this.nextAllowedTime = Math.max(now, this.nextAllowedTime);

      if (request.method == "POST") {
        // ５秒に１回アクションを起こして良い
        this.nextAllowedTime += 5;
      }

      // 最初の 20 秒は素早くアクションを起こしても許容する
      const cooldown = Math.max(0, this.nextAllowedTime - now - 20);
      return new Response(String(cooldown));
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
