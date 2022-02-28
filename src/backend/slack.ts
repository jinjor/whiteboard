import { User } from "../schema";
import { InvalidSession, OAuth, ReturnedScopeDoesNotMatch } from "./oauth";

const OAUTH_SCOPE = "identity.basic,identity.avatar";

export class SlackOAuth implements OAuth {
  private clientId: string;
  private clientSecret: string;

  constructor(env: {
    AUTH_TYPE: "slack";
    SLACK_CLIENT_ID: string;
    SLACK_CLIENT_SECRET: string;
  }) {
    this.clientId = env.SLACK_CLIENT_ID;
    this.clientSecret = env.SLACK_CLIENT_SECRET;
  }
  getAuthType(): string {
    return "slack";
  }
  async getUserFromSession(session: string): Promise<User> {
    let user: User;
    try {
      user = JSON.parse(session);
    } catch (e) {
      throw new InvalidSession();
    }
    if (user.id == null || user.image == null) {
      throw new InvalidSession();
    }
    if (!user.id.startsWith("sl/")) {
      throw new InvalidSession();
    }
    return user;
  }
  getFormUrl(request: Request): string {
    const url = new URL(request.url);
    const redirectUrl = `${url.origin}/callback/slack`;
    return makeFormUrl(this.clientId, OAUTH_SCOPE, redirectUrl);
  }
  getCodeFromCallback(request: Request): string | null {
    return new URL(request.url).searchParams.get("code");
  }
  async getAccessToken(code: string): Promise<string> {
    const { accessToken, scope } = await getAccessToken(
      this.clientId,
      this.clientSecret,
      code
    );
    if (scope !== OAUTH_SCOPE) {
      console.log("invalid scope", scope, OAUTH_SCOPE);
      throw new ReturnedScopeDoesNotMatch();
    }
    return accessToken;
  }
  async createInitialSession(accessToken: string): Promise<string> {
    const user = await getUser(accessToken);
    console.log("slack user:", user);
    const id = "sl/" + user.name;
    const image = user.image_48 || "not_found in " + JSON.stringify(user); // TODO: for debug
    return JSON.stringify({ id, image });
  }
}

function makeFormUrl(
  clientId: string,
  scope: string,
  redirect_uri: string
): string {
  // user_scope を使う必要がある
  return `https://slack.com/oauth/v2/authorize?client_id=${clientId}&user_scope=${scope}&redirect_uri=${encodeURIComponent(
    redirect_uri
  )}`;
}

// TODO: get id, name, avatar
// https://api.slack.com/methods/users.identity
async function getUser(accessToken: string): Promise<any> {
  const res = await fetch(`https://slack.com/api/users.identity`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const data: any = await res.json();
  if (data.ok) {
    return data.user;
  }
  throw new Error(JSON.stringify(data));
}

async function getAccessToken(
  clientId: string,
  clientSecret: string,
  code: string
): Promise<{ user_id: string; accessToken: string; scope: string }> {
  const atRes = await fetch(
    `https://slack.com/api/oauth.v2.access?client_id=${clientId}&client_secret=${clientSecret}&code=${code}`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    }
  );
  const data: any = await atRes.json();
  // {
  //   "ok": true,
  //   "app_id": "A0xxxxxx",
  //   "authed_user": {
  //     "id": "U8xxxxxx",
  //     "scope": "identity.basic",
  //     "access_token": "xoxp-xxxx",
  //     "token_type": "user"
  //   },
  //   "team": {
  //     "id": "T8xxxxxx"
  //   },
  //   "enterprise": null,
  //   "is_enterprise_install": false
  // }
  if (!data.ok) {
    throw new Error(JSON.stringify(data));
  }
  return {
    user_id: data.authed_user.id,
    accessToken: data.authed_user.access_token,
    scope: data.authed_user.scope,
  };
}
