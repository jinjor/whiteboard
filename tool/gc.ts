import fetch from "node-fetch";

const ADMIN_KEY = process.env.ADMIN_KEY;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.ACCOUNT_ID;
const scriptName = process.env.SCRIPT_NAME;
const ORIGIN = process.env.ORIGIN;

async function adminApi(method: string, path: string, body: any) {
  const res = await fetch(`${ORIGIN}/admin${path}`, {
    method: method,
    headers: {
      "Content-Type": "application/json",
      "WB-ADMIN_KEY": ADMIN_KEY,
      "WB-CLOUDFLARE_API_TOKEN": CLOUDFLARE_API_TOKEN,
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

async function gc(): Promise<any[]> {
  return await adminApi("DELETE", `/gc`, {
    accountId,
    scriptName,
  });
}
async function run(): Promise<void> {
  const result = await gc();
  console.log(result);
}

run().catch((e) => {
  console.log(e);
  process.exit(1);
});
