import { Router } from "itty-router";
import { RateLimiterClient } from "./rate-limiter";

type Env = {
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
