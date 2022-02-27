import { InvalidSession, OAuth, ReturnedScopeDoesNotMatch } from "./oauth";

const OAUTH_SCOPE = "identity.basic";

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
    return "github";
  }
  async getUserIdFromSession(session: string): Promise<string> {
    if (!session.startsWith("sl/")) {
      throw new InvalidSession();
    }
    return session;
  }
  getFormUrl(): string {
    const host = "whiteboard.jinjor.workers.dev"; // TODO
    const redirectUrl = `https://${host}/callback/slack`;
    // const redirectUrl = `http://localhost:8787/callback/slack`;
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
      throw new ReturnedScopeDoesNotMatch();
    }
    return accessToken;
  }
  async createInitialSession(accessToken: string): Promise<string> {
    const name = await getUserName(accessToken);
    console.log("slack user name:", name);
    const userId = "sl/" + name;
    return userId;
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
async function getUserName(accessToken: string): Promise<string> {
  const res = await fetch(`https://slack.com/api/users.identity`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const data: any = await res.json();
  // console.log(data);
  if (data.ok) {
    return data.user.name;
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
