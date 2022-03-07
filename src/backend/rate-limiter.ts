import { Router } from "itty-router";

class RateLimiterState {
  private nextAllowedTime: number;
  constructor() {
    this.nextAllowedTime = 0;
  }
  update(didAction: boolean): number {
    const now = Date.now() / 1000;
    this.nextAllowedTime = Math.max(now, this.nextAllowedTime);
    if (didAction) {
      // TODO: 設定可能にする
      // １秒に１回アクションを起こして良い
      this.nextAllowedTime += 1;
    }
    return Math.max(0, this.nextAllowedTime - now - 40);
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

// ユーザー毎にインスタンスが作られる。このレートリミットはグローバル（部屋を跨ぐ）
export class RateLimiter implements DurableObject {
  private state: RateLimiterState;
  constructor() {
    this.state = new RateLimiterState();
  }
  async fetch(request: Request) {
    return rateLimitRouter
      .handle(request, this.state)
      .catch((error: unknown) => {
        console.log("RateLimiter:", error);
        return new Response("unexpected error", { status: 500 });
      });
  }
}

export class RateLimiterClient {
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
