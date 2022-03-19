import fetch from "node-fetch";

const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const accountTag = "7e155f728b0311833218e72046aaa90a";
const scriptName = "whiteboard";

async function send(path: string) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountTag}${path}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
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

type DateRange = {
  firstDate: string;
  lastDate: string;
};

async function getDurableObjectNamespaces(): Promise<any[]> {
  const namespaces = await send(`/workers/durable_objects/namespaces`);
  return namespaces.filter((ns) => ns.script === scriptName);
}
async function getDurableObjects(namespaceId: string): Promise<any[]> {
  return send(`/workers/durable_objects/namespaces/${namespaceId}/objects`);
}

async function run(): Promise<void> {
  const namespaces = await getDurableObjectNamespaces();
  console.log("namespaces:", namespaces);
  for (const ns of namespaces) {
    const objects = await getDurableObjects(ns.id);
    console.log(`# of ${ns.class}:`, objects.length);
  }
}

run().catch((e) => {
  console.log(e);
  process.exit(1);
});
