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
  private sessions: Session[];
  private lastTimestamp: number;
  constructor(controller: any, env: Env) {
    this.storage = controller.storage;
    this.env = env;
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
  private newUniqueTimestamp(): number {
    // 単調増加になるように細工する
    const timestamp = Math.max(Date.now(), this.lastTimestamp + 1);
    this.lastTimestamp = timestamp;
    return timestamp;
  }
  async handleSession(webSocket: WebSocket, userId: string): Promise<void> {
    webSocket.accept();

    const limiterId = this.env.limiters.idFromName(userId);
    const limiter = new RateLimiterClient(
      () => this.env.limiters.get(limiterId),
      (err) => webSocket.close(1011, err.stack)
    );

    const session: Session = {
      webSocket,
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

        if (!limiter.checkLimit()) {
          webSocket.send(
            JSON.stringify({
              error: "You are being rate-limited, please try again later.",
            })
          );
          return;
        }
        const event = JSON.parse(msg.data as string);
        console.log("event", event);

        switch (event.kind) {
          case "add_text": {
            // バリデーション
            const objectId = event.id;
            if (objectId == null || objectId.length !== 32) {
              webSocket.send(
                JSON.stringify({ kind: "error", message: "invalid message" })
              );
              return;
            }
            const timestamp = this.newUniqueTimestamp();
            const newObject = {
              id: event.id,
              kind: "text",
              text: event.text,
              x: event.x,
              y: event.y,
              lastEditedAt: timestamp,
              lastEditedBy: session.name,
            };
            const objects: any = await this.storage.get("objects");
            objects[event.id] = newObject;
            await this.storage.put("objects", objects);
            this.broadcast(session.name, {
              kind: "new_object",
              object: newObject,
            });
            break;
          }
        }
      } catch (err: any) {
        console.log(err);
        webSocket.send(
          JSON.stringify({ kind: "error", message: "unexpected error" })
        );
      }
    });

    const closeOrErrorHandler = (evt: Event) => {
      session.quit = true;
      this.sessions = this.sessions.filter((member) => member !== session);
      this.broadcast(session.name, { kind: "quit", name: session.name });
    };
    webSocket.addEventListener("close", closeOrErrorHandler);
    webSocket.addEventListener("error", closeOrErrorHandler);

    let objects = await this.storage.get("objects");
    if (objects == null) {
      objects = {};
      await this.storage.put("objects", {});
    }
    const members = this.sessions.map((s) => s.name);
    webSocket.send(
      JSON.stringify({ kind: "init", objects: objects ?? {}, members })
    );
    this.broadcast(session.name, { kind: "join", name: session.name });
  }

  private broadcast(sender: string, message: any) {
    const quitters: Session[] = [];
    this.sessions = this.sessions.filter((session) => {
      try {
        if (session.name !== sender) {
          session.webSocket.send(JSON.stringify(message));
        }
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
      this.broadcast(quitter.name, { kind: "quit", name: quitter.name });
    });
  }
}

type Session = {
  name: string;
  quit: boolean;
  webSocket: WebSocket;
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
