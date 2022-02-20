import { Router } from "itty-router";
import { RateLimiterClient } from "./rate-limiter";
import { applyEvent, InvalidEvent, Objects, validateEvent } from "./object";

type Env = {
  limiters: DurableObjectNamespace;
};

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
    await state.handleSession(pair[1], userId);
    // 101 Switching Protocols
    return new Response(null, { status: 101, webSocket: pair[0] });
  })
  .all("*", () => new Response("Not found.", { status: 404 }));

type Session = {
  name: string;
  quit: boolean;
  webSocket: WebSocket;
};

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
      (err) => {
        console.log(err);
        webSocket.close(1011);
      }
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
        session.webSocket.close(1001);
        this.sessions.splice(i, 1);
      }
    }
    this.sessions.push(session);

    webSocket.addEventListener("message", async (msg: MessageEvent) => {
      try {
        if (session.quit) {
          throw new Error("unexpected session.quit");
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
        if (!validateEvent(event)) {
          throw new InvalidEvent();
        }
        const timestamp = this.newUniqueTimestamp();
        const objects: Objects = (await this.storage.get("objects"))!;
        const events = applyEvent(
          { ...event, uniqueTimestamp: timestamp, requestedBy: session.name },
          objects
        );
        await this.storage.put("objects", objects);
        for (const e of events) {
          switch (e.to) {
            case "self": {
              break;
            }
            case "others": {
              this.broadcast(session.name, e.event);
              break;
            }
          }
        }
      } catch (e: unknown) {
        if (e instanceof InvalidEvent) {
          webSocket.close(1007);
          return;
        }
        console.log(e);
        webSocket.close(1011, "Something went wrong.");
      }
    });
    webSocket.addEventListener("error", (e) => {
      console.log(e);
    });
    webSocket.addEventListener("close", () => {
      session.quit = true;
      this.sessions = this.sessions.filter((member) => member !== session);
      this.broadcast(session.name, { kind: "quit", name: session.name });
    });

    const objects: Objects = (await this.storage.get("objects")) ?? {};
    await this.storage.put("objects", objects);
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

export class ChatRoom implements DurableObject {
  private state: RoomState;
  constructor(controller: any, env: Env) {
    this.state = new RoomState(controller, env);
  }
  async fetch(request: Request) {
    return roomRouter.handle(request, this.state).catch((error: any) => {
      console.log(error.stack);
      return new Response("unexpected error", { status: 500 });
    });
  }
}
