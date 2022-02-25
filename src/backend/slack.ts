export function makeFormUrl(
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
export async function getUserName(accessToken: string): Promise<string> {
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

export async function getAccessToken(
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
