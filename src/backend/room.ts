import { Router } from "itty-router";
import { RateLimiterClient } from "./rate-limiter";
import { applyEvent, InvalidEvent, validateEvent } from "./object";
import { Objects, SessionUser, UserId } from "../schema";
import { Config, defaultConfig } from "./config";

type Env = {
  limiters: DurableObjectNamespace;
};

const roomRouter = Router()
  .patch("/config", async (request: Request, state: RoomState) => {
    const config = await request.json();
    await state.updateConfig(config as any);
    return new Response("null");
  })
  .post("/deactivate", async (request: Request, state: RoomState) => {
    await state.disconnectAllSessions("room_got_inactive");
    return new Response("null");
  })
  .post("/cooldown", async (request: Request, state: RoomState) => {
    await state.cooldown();
    return new Response("null");
  })
  .get("/websocket", async (request: Request, state: RoomState) => {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 400 });
    }
    const userId = request.headers.get("WB-USER-ID")!;
    const userName = request.headers.get("WB-USER-NAME")!;
    const userImage = request.headers.get("WB-USER-IMAGE")!;
    const user: SessionUser = {
      id: userId,
      name: userName,
      image: userImage || null,
    };
    if (!state.canStart(userId)) {
      return new Response("room is full", { status: 403 });
    }
    const pair = new WebSocketPair();
    await state.handleSession(pair[1], user);
    // 101 Switching Protocols
    return new Response(null, { status: 101, webSocket: pair[0] });
  })
  .get("/objects", async (request: Request, state: RoomState) => {
    const objects = await state.getObjects();
    return new Response(JSON.stringify(objects));
  })
  .all("*", () => new Response("Not found.", { status: 404 }));

type Session = {
  user: SessionUser;
  quit: boolean;
  webSocket: WebSocket;
};

class RoomState {
  private storage: DurableObjectStorage;
  private env: Env;
  private sessions: Session[];
  private lastTimestamp: number;
  private HOT_DURATION!: number;
  private MAX_ACTIVE_USERS!: number;
  constructor(controller: any, env: Env) {
    this.storage = controller.storage;
    this.env = env;
    this.sessions = [];
    // 同時にメッセージが来てもタイムスタンプを単調増加にするための仕掛け
    this.lastTimestamp = Date.now();
    this.updateConfig(defaultConfig);
  }
  updateConfig(config: Partial<Config>): void {
    if (config.HOT_DURATION != null) {
      this.HOT_DURATION = config.HOT_DURATION;
    }
    if (config.MAX_ACTIVE_USERS != null) {
      this.MAX_ACTIVE_USERS = config.MAX_ACTIVE_USERS;
    }
  }
  async disconnectAllSessions(reasonCode: string) {
    while (this.sessions.length > 0) {
      const session = this.sessions.pop()!;
      session.webSocket.close(1001, reasonCode);
    }
  }
  async cooldown() {
    if (Date.now() - this.lastTimestamp > this.HOT_DURATION) {
      this.disconnectAllSessions("no_recent_activity");
    }
  }
  canStart(userId: string): boolean {
    if (this.sessions.some((session) => session.user.id === userId)) {
      return true;
    }
    return this.sessions.length < this.MAX_ACTIVE_USERS;
  }
  private newUniqueTimestamp(): number {
    // 単調増加になるように細工する
    const timestamp = Math.max(Date.now(), this.lastTimestamp + 1);
    this.lastTimestamp = timestamp;
    return timestamp;
  }
  async getObjects(): Promise<Objects> {
    const objects = await this.storage.get("objects");
    if (objects == null) {
      await this.storage.put("objects", {});
      return {};
    }
    return objects as Objects;
  }
  async handleSession(webSocket: WebSocket, user: SessionUser): Promise<void> {
    webSocket.accept();

    const limiterId = this.env.limiters.idFromName(user.id);
    const limiter = new RateLimiterClient(
      () => this.env.limiters.get(limiterId),
      (err) => {
        console.log(err);
        webSocket.close(1011, "rate_limit_exceeded");
      }
    );

    const session: Session = {
      webSocket,
      user,
      quit: false,
    };
    // 同じユーザーは複数の接続を開始できない
    for (let i = this.sessions.length - 1; i >= 0; i--) {
      const session = this.sessions[i];
      if (session.user.id === user.id) {
        session.webSocket.close(1001, "duplicated_self");
        this.sessions.splice(i, 1);
      }
    }
    this.sessions.push(session);

    webSocket.addEventListener("message", async (msg: MessageEvent) => {
      try {
        if (session.quit) {
          throw new Error("unexpected session.quit");
        }
        // TODO
        // if (!limiter.checkLimit()) {
        //   webSocket.send(
        //     JSON.stringify({
        //       error: "You are being rate-limited, please try again later.",
        //     })
        //   );
        //   return;
        // }
        const event = JSON.parse(msg.data as string);
        console.log("event", event);
        if (!validateEvent(event)) {
          throw new InvalidEvent();
        }
        const timestamp = this.newUniqueTimestamp();
        const objects = await this.getObjects();
        const events = applyEvent(
          {
            ...event,
            uniqueTimestamp: timestamp,
            requestedBy: session.user.id,
          },
          objects
        );
        await this.storage.put("objects", objects);
        for (const e of events) {
          switch (e.to) {
            case "self": {
              break;
            }
            case "others": {
              this.broadcast(session.user.id, e.event);
              break;
            }
          }
        }
      } catch (e) {
        if (e instanceof InvalidEvent) {
          webSocket.close(1007, "invalid_data");
          return;
        }
        console.log(e);
        webSocket.close(1011, "unexpected");
      }
    });
    webSocket.addEventListener("error", (e) => {
      console.log(e);
    });
    webSocket.addEventListener("close", () => {
      session.quit = true;
      this.sessions = this.sessions.filter((member) => member !== session);
      this.broadcast(session.user.id, { kind: "quit", id: session.user.id });
    });
    const objects = await this.getObjects();
    const members = this.sessions.map((s) => s.user);
    webSocket.send(
      JSON.stringify({
        kind: "init",
        objects: objects ?? {},
        members,
        self: session.user.id,
      })
    );
    this.broadcast(session.user.id, { kind: "join", user: session.user });
  }

  private broadcast(sender: UserId, message: any) {
    const quitters: Session[] = [];
    this.sessions = this.sessions.filter((session) => {
      try {
        if (session.user.id !== sender) {
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
      this.broadcast(quitter.user.id, { kind: "quit", id: quitter.user.id });
    });
  }
}

export class Room implements DurableObject {
  private state: RoomState;
  constructor(controller: any, env: Env) {
    this.state = new RoomState(controller, env);
  }
  async fetch(request: Request) {
    return roomRouter.handle(request, this.state).catch((error: unknown) => {
      console.log(error);
      return new Response("unexpected error", { status: 500 });
    });
  }
}
