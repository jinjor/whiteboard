export function makeFormUrl(clientId: string, scope: string): string {
  return `https://github.com/login/oauth/authorize?client_id=${clientId}&scope=${scope}`;
}

export async function getUserLogin(accessToken: string): Promise<string> {
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

export async function isUserBelongsOrg(
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

export async function getAccessToken(
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
