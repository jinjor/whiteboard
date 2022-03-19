type Config = {
  accountTag: string;
  CLOUDFLARE_API_TOKEN: string;
};

async function send(config: Config, path: string) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${config.accountTag}${path}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.CLOUDFLARE_API_TOKEN}`,
        Accepts: "application/json",
      },
    }
  );
  if (res.status >= 400) {
    throw new Error(
      JSON.stringify({
        status: res.status,
        body: await res.text(),
      })
    );
  }
  const json: any = await res.json();
  if (!json.success) {
    throw new Error(JSON.stringify(json));
  }
  return json.result;
}

export async function getDurableObjectNamespaces(
  config: Config,
  scriptName: string
): Promise<any[]> {
  const namespaces = await send(config, `/workers/durable_objects/namespaces`);
  return namespaces.filter((ns: any) => ns.script === scriptName);
}
export async function getDurableObjects(
  config: Config,
  namespaceId: string
): Promise<any[]> {
  return send(
    config,
    `/workers/durable_objects/namespaces/${namespaceId}/objects`
  );
}
