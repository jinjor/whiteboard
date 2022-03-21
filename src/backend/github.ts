import { User } from "../schema";
import {
  InvalidSession,
  NotAMemberOfOrg,
  OAuth,
  ReturnedScopeDoesNotMatch,
} from "./oauth";

export class GitHubOAuth implements OAuth {
  private org: string | null;
  private clientId: string;
  private clientSecret: string;
  constructor(env: {
    AUTH_TYPE: "github";
    GITHUB_CLIENT_ID: string;
    GITHUB_CLIENT_SECRET: string;
    GITHUB_ORG?: string;
  }) {
    this.org = env.GITHUB_ORG ?? null;
    this.clientId = env.GITHUB_CLIENT_ID;
    this.clientSecret = env.GITHUB_CLIENT_SECRET;
  }
  getAuthType(): string {
    return "github";
  }
  private getScope(): string {
    return this.org != null ? "read:org" : "";
  }
  async checkUser(user: User): Promise<void> {
    if (!user.id.startsWith("gh/")) {
      throw new InvalidSession();
    }
    if (user.id === "gh/_guest") {
      throw new NotAMemberOfOrg();
    }
  }
  async getUserFromSession(session: string): Promise<User> {
    let user: User;
    try {
      user = JSON.parse(session);
    } catch (e) {
      throw new InvalidSession();
    }
    if (user.id == null || user.name == null || user.image == null) {
      throw new InvalidSession();
    }
    if (!user.id.startsWith("gh/")) {
      throw new InvalidSession();
    }
    if (user.id === "gh/_guest") {
      throw new NotAMemberOfOrg();
    }
    return user;
  }
  getFormUrl(): string {
    return makeFormUrl(this.clientId, this.getScope());
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
    if ((scope ?? "") !== this.getScope()) {
      throw new ReturnedScopeDoesNotMatch();
    }
    return accessToken;
  }
  async getUser(accessToken: string): Promise<User> {
    let login = await getUserLogin(accessToken);
    if (this.org) {
      const ok = await isUserMemberOfOrg(accessToken, login, this.org);
      if (!ok) {
        login = "_guest"; // "_guest" is an invalid github name
      }
    }
    const id = "gh/" + login;
    const name = login;
    const image = `https://github.com/${login}.png`;
    return { id, name, image };
  }
}

function makeFormUrl(clientId: string, scope: string): string {
  return `https://github.com/login/oauth/authorize?client_id=${clientId}&scope=${scope}`;
}

async function getUserLogin(accessToken: string): Promise<string> {
  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github.v3+json",
      Authorization: `token ${accessToken}`,
      "User-Agent": "node.js",
    },
  });
  const { login } = await userRes.json();
  return login;
}

async function isUserMemberOfOrg(
  accessToken: string,
  login: string,
  org: string
): Promise<boolean> {
  const membershipRes = await fetch(
    `https://api.github.com/orgs/${org}/memberships/${login}`,
    {
      headers: {
        Accept: "application/vnd.github.v3+json",
        Authorization: `token ${accessToken}`,
        "User-Agent": "node.js",
      },
    }
  );
  return membershipRes.status === 200;
}

async function getAccessToken(
  clientId: string,
  clientSecret: string,
  code: string
): Promise<{ accessToken: string; scope: string }> {
  const atRes = await fetch(
    `https://github.com/login/oauth/access_token?client_id=${clientId}&client_secret=${clientSecret}&code=${code}`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    }
  );
  const { access_token, scope } = await atRes.json();
  return { accessToken: access_token, scope };
}
