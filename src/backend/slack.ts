import { User } from "../schema";
import {
  InvalidSession,
  NotAMemberOfOrg,
  OAuth,
  ReturnedScopeDoesNotMatch,
} from "./oauth";

const OAUTH_SCOPE = "identity.basic,identity.avatar,openid,email,profile";

export class SlackOAuth implements OAuth {
  private teamDomain: string | null;
  private clientId: string;
  private clientSecret: string;

  constructor(env: {
    AUTH_TYPE: "slack";
    SLACK_CLIENT_ID: string;
    SLACK_CLIENT_SECRET: string;
    SLACK_TEAM_DOMAIN?: string;
  }) {
    this.teamDomain = env.SLACK_TEAM_DOMAIN ?? null;
    this.clientId = env.SLACK_CLIENT_ID;
    this.clientSecret = env.SLACK_CLIENT_SECRET;
  }
  getAuthType(): string {
    return "slack";
  }
  async checkUser(user: User): Promise<void> {
    if (!user.id.startsWith("sl/")) {
      throw new InvalidSession();
    }
    if (user.id === "sl/") {
      throw new NotAMemberOfOrg();
    }
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
  async getUser(accessToken: string): Promise<User> {
    const [slackUser, slackTeam] = await getUserAndTeam(accessToken);
    let name = slackUser.name;
    if (this.teamDomain) {
      const ok = slackTeam.domain === this.teamDomain;
      if (!ok) {
        name = ""; // "" should be an invalid name
      }
    }
    const id = "sl/" + name;
    const image = slackUser.image_48;
    return { id, name, image };
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

// https://api.slack.com/methods/users.identity
async function getUserAndTeam(accessToken: string): Promise<[any, any]> {
  const res = await fetch(`https://slack.com/api/users.identity`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const data: any = await res.json();
  if (data.ok) {
    return [data.user, data.team];
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
  if (!data.ok) {
    throw new Error(JSON.stringify(data));
  }
  return {
    user_id: data.authed_user.id,
    accessToken: data.authed_user.access_token,
    scope: data.authed_user.scope,
  };
}
