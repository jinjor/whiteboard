import Cookie from "cookie";
import { decrypt, encrypt } from "./crypto";

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
): Promise<Response | string> {
  const session = await getDecryptedSessionFromCookie(request, cookieSecret);
  if (session == null) {
    return new Response(null, {
      status: 302,
      headers: {
        "Set-Cookie": Cookie.serialize("original_url", request.url, {
          path: "/",
          httpOnly: true,
          maxAge: 60,
          secure: true, // TODO: switch
          sameSite: "strict",
        }),
        Location: oauth.getFormUrl(request),
      },
    });
  }
  try {
    return await oauth.getUserIdFromSession(session);
  } catch (e: unknown) {
    if (e instanceof InvalidSession) {
      return new Response("Not found.", { status: 404 });
    }
    if (e instanceof NotAMemberOfOrg) {
      return new Response("Not a member of org.", { status: 403 });
    }
    throw e;
  }
}
export async function handleCallback(
  request: Request,
  oauth: OAuth,
  cookieSecret: string
): Promise<Response> {
  try {
    const pathname = new URL(request.url).pathname;
    if (pathname !== "/callback/" + oauth.getAuthType) {
      throw new InvalidCallback();
    }
    const cookie = Cookie.parse(request.headers.get("Cookie") ?? "");
    const code = oauth.getCodeFromCallback(request);
    if (code == null) {
      throw new InvalidCallback();
    }
    const accessToken = await oauth.getAccessToken(code);
    const rawSession = await oauth.createInitialSession(accessToken);
    const session = await encrypt(cookieSecret, rawSession);
    const res = new Response(null, {
      status: 302,
      headers: {
        "Set-Cookie": Cookie.serialize("session", session, {
          path: "/",
          httpOnly: true,
          maxAge: 60 * 60 * 24 * 7, // 1 week
          secure: true, // TODO: switch
          sameSite: "lax", // strict だと直後に cookie を送信してくれない
        }),
        Location: cookie.original_url ?? `/`,
      },
    });
    return res;
  } catch (e: unknown) {
    if (
      e instanceof InvalidCallback ||
      e instanceof ReturnedScopeDoesNotMatch
    ) {
      return new Response("Not found.", { status: 404 });
    }
    if (e instanceof NotAMemberOfOrg) {
      return new Response("Not a member of org.", { status: 403 });
    }
    throw e;
  }
}
export type OAuth = {
  getAuthType: () => string;
  getUserIdFromSession(session: string): Promise<string>;
  getFormUrl(request: Request): string;
  getCodeFromCallback: (request: Request) => string | null;
  getAccessToken: (code: string) => Promise<string>;
  createInitialSession: (accessToken: string) => Promise<string>;
};
