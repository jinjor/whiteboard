import fetch from "node-fetch";

const ADMIN_KEY = process.env.ADMIN_KEY;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ORIGIN = process.env.ORIGIN;
const accountTag = "7e155f728b0311833218e72046aaa90a";
const scriptName = "whiteboard";

async function adminApi(method: string, path: string, body: any) {
  console.log(`${ORIGIN}/admin${path}`);
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
    accountTag,
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
