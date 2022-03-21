import fetch from "node-fetch";
import { getEnv } from "./env";

type Config = {
  CLOUDFLARE_API_TOKEN: string;
  ACCOUNT_ID: string;
  SCRIPT_NAME: string;
  ORIGIN: string;
  ADMIN_KEY: string;
};

async function adminApi(
  config: Config,
  method: string,
  path: string,
  body: any
) {
  const res = await fetch(`${config.ORIGIN}/admin${path}`, {
    method: method,
    headers: {
      "Content-Type": "application/json",
      "WB-ADMIN_KEY": config.ADMIN_KEY,
      "WB-CLOUDFLARE_API_TOKEN": config.CLOUDFLARE_API_TOKEN,
      Accepts: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (res.status >= 400) {
    throw new Error(
      JSON.stringify({
        status: res.status,
        body: await res.text(),
      })
    );
  }
  return await res.json();
}

async function gc(config: Config): Promise<any[]> {
  return await adminApi(config, "DELETE", `/gc`, {
    accountId: config.ACCOUNT_ID,
    scriptName: config.SCRIPT_NAME,
  });
}
async function run(config: Config): Promise<void> {
  const result = await gc(config);
  console.log(result);
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
