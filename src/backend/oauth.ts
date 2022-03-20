import Cookie from "cookie";
import { User } from "../schema";
import { decrypt, encrypt } from "./crypto";

export class SessionExpired extends Error {}
export class InvalidSession extends Error {}
export class NotAMemberOfOrg extends Error {}
export class InvalidCallback extends Error {}
export class ReturnedScopeDoesNotMatch extends Error {}

async function getDecryptedSessionFromCookie(
  request: Request,
  cookieSecret: string
): Promise<string | null> {
  const cookie = Cookie.parse(request.headers.get("Cookie") ?? "");
  if (cookie.session == null) {
    return null;
  }
  try {
    return await decrypt(cookieSecret, cookie.session);
  } catch (e) {
    return null;
  }
}

export async function check(
  request: Request,
  oauth: OAuth,
  cookieSecret: string
): Promise<{ ok: true; user: User } | { ok: false; response: Response }> {
  const rawSession = await getDecryptedSessionFromCookie(request, cookieSecret);
  if (rawSession == null) {
    return {
      ok: false,
      response: createRedirectToFormResponse(request, oauth),
    };
  }
  try {
    let parsed;
    try {
      parsed = JSON.parse(rawSession);
    } catch (e) {
      throw new InvalidSession();
    }
    const user = parsed.user;
    const expiresAt = parsed.expiresAt;
    if (user == null || typeof expiresAt !== "number") {
      throw new InvalidSession();
    }
    if (user.id == null || user.name == null || user.image == null) {
      throw new InvalidSession();
    }
    await oauth.checkUser(user);
    if (expiresAt < Date.now()) {
      throw new SessionExpired();
    }
    return {
      ok: true,
      user,
    };
  } catch (e: unknown) {
    if (e instanceof InvalidSession || e instanceof SessionExpired) {
      return {
        ok: false,
        response: createRedirectToFormResponse(request, oauth),
      };
    }
    if (e instanceof NotAMemberOfOrg) {
      return {
        ok: false,
        response: new Response("Not found.", { status: 404 }),
      };
    }
    throw e;
  }
}
function createRedirectToFormResponse(
  request: Request,
  oauth: OAuth
): Response {
  return new Response(null, {
    status: 302,
    headers: {
      "Set-Cookie": Cookie.serialize("original_url", request.url, {
        path: "/",
        httpOnly: true,
        maxAge: 60,
        secure: true,
        sameSite: "lax", // strict だと直後に cookie を送信してくれない
      }),
      Location: oauth.getFormUrl(request),
    },
  });
}

export async function handleCallback(
  request: Request,
  oauth: OAuth,
  cookieSecret: string
): Promise<Response> {
  try {
    const pathname = new URL(request.url).pathname;
    if (pathname !== "/callback/" + oauth.getAuthType()) {
      console.log("invalid path");
      throw new InvalidCallback();
    }
    const cookie = Cookie.parse(request.headers.get("Cookie") ?? "");
    const code = oauth.getCodeFromCallback(request);
    if (code == null) {
      console.log("code not found");
      throw new InvalidCallback();
    }
    const accessToken = await oauth.getAccessToken(code);
    const user = await oauth.getUser(accessToken);
    const maxAge = 60 * 60 * 24 * 7; // 1 week
    const rawSession = JSON.stringify({
      user,
      expiresAt: Date.now() + maxAge * 1000,
    });
    const session = await encrypt(cookieSecret, rawSession);
    const res = new Response(null, {
      status: 302,
      headers: {
        "Set-Cookie": Cookie.serialize("session", session, {
          path: "/",
          httpOnly: true,
          maxAge,
          secure: true,
          sameSite: "lax", // strict だと直後に cookie を送信してくれない
        }),
        Location: cookie.original_url ?? `/`,
      },
    });
    return res;
  } catch (e: unknown) {
    if (
      e instanceof InvalidCallback ||
      e instanceof ReturnedScopeDoesNotMatch ||
      e instanceof NotAMemberOfOrg
    ) {
      return new Response("Not found.", { status: 404 });
    }
    throw e;
  }
}
export type OAuth = {
  getAuthType: () => string;
  checkUser(user: User): Promise<void>;
  getFormUrl(request: Request): string;
  getCodeFromCallback: (request: Request) => string | null;
  getAccessToken: (code: string) => Promise<string>;
  getUser: (accessToken: string) => Promise<User>;
};
