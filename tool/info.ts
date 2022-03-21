import fetch from "node-fetch";
import { getEnv } from "./env";

export type Config = {
  CLOUDFLARE_API_TOKEN: string;
  ACCOUNT_ID: string;
  SCRIPT_NAME: string;
};

async function send(config: Config, path: string) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${config.ACCOUNT_ID}${path}`,
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
  const json = await res.json();
  if (!json.success) {
    throw new Error(JSON.stringify(json));
  }
  return json.result;
}

async function getDurableObjectNamespaces(config: Config): Promise<any[]> {
  const namespaces = await send(config, `/workers/durable_objects/namespaces`);
  return namespaces.filter((ns) => ns.script === config.SCRIPT_NAME);
}
async function getDurableObjects(
  config: Config,
  namespaceId: string
): Promise<any[]> {
  return send(
    config,
    `/workers/durable_objects/namespaces/${namespaceId}/objects`
  );
}

async function run(config: Config): Promise<void> {
  const namespaces = await getDurableObjectNamespaces(config);
  console.log("namespaces:", namespaces);
  for (const ns of namespaces) {
    const objects = await getDurableObjects(config, ns.id);
    console.log(`# of ${ns.class}:`, objects.length);
  }
}

const env = process.argv[2];
if (env == null) {
  throw new Error("arg not found");
}
const config = getEnv(env) as Config;
run(config).catch((e) => {
  console.log(e);
  process.exit(1);
});
