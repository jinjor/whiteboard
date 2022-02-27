import {
  InvalidSession,
  NotAMemberOfOrg,
  OAuth,
  ReturnedScopeDoesNotMatch,
} from "./oauth";

const OAUTH_SCOPE = "read:org";

export class GitHubOAuth implements OAuth {
  private org: string;
  private clientId: string;
  private clientSecret: string;
  constructor(env: {
    AUTH_TYPE: "github";
    GITHUB_CLIENT_ID: string;
    GITHUB_CLIENT_SECRET: string;
    GITHUB_ORG: string;
  }) {
    this.org = env.GITHUB_ORG;
    this.clientId = env.GITHUB_CLIENT_ID;
    this.clientSecret = env.GITHUB_CLIENT_SECRET;
  }
  getAuthType(): string {
    return "github";
  }
  async getUserIdFromSession(session: string): Promise<string> {
    if (!session.startsWith("gh/")) {
      throw new InvalidSession();
    }
    if (session === "gh/_guest") {
      throw new NotAMemberOfOrg();
    }
    return session;
  }
  getFormUrl(): string {
    return makeFormUrl(this.clientId, OAUTH_SCOPE);
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
    const login = await getUserLogin(accessToken);
    console.log("login:", login);
    const isMemberOfOrg = await isUserMemberOfOrg(accessToken, login, this.org);
    console.log("isMemberOfOrg:", isMemberOfOrg);
    // const userId = isMemberOfOrg ? "gh/" + login : "gh/_guest"; // "_guest" is an invalid github name
    const userId = "gh/" + login; // TODO: for debug
    return userId;
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
  return membershipRes.status === 204;
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
