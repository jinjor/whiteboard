// @ts-ignore
import manifest from "__STATIC_CONTENT_MANIFEST";
import {
  getAssetFromKV,
  MethodNotAllowedError,
  NotFoundError,
} from "@cloudflare/kv-asset-handler";

export async function getAsset(
  request: Request,
  env: any,
  context: ExecutionContext,
  modifyPath: (path: string) => string,
  status = 200
): Promise<Response> {
  try {
    const res = await getAssetFromKV(
      {
        request,
        waitUntil(promise) {
          return context.waitUntil(promise);
        },
      },
      {
        ASSET_NAMESPACE: env.__STATIC_CONTENT,
        ASSET_MANIFEST: manifest,
        // [mf:wrn] Cache operations will have no impact if you deploy to a workers.dev subdomain!
        cacheControl: {
          bypassCache: true,
        },
        mapRequestToAsset: (req) => {
          const url = new URL(req.url);
          url.pathname = modifyPath(url.pathname);
          return new Request(url.toString(), req);
        },
      }
    );
    return new Response(res.body, { status });
  } catch (e) {
    if (e instanceof NotFoundError || e instanceof MethodNotAllowedError) {
      return new Response("Not found.", { status: 404 });
    }
    throw e;
  }
}

export function immediatelyCloseWebSocket(code: number, reason: string) {
  const pair = new WebSocketPair();
  pair[1].accept();
  setTimeout(() => {
    pair[1].close(code, reason);
  });
  return new Response(null, { status: 101, webSocket: pair[0] });
}

export class DurableObjectClient {
  private stub: DurableObjectStub;
  constructor(ns: DurableObjectNamespace, id: DurableObjectId) {
    this.stub = ns.get(id);
  }
  async fetch(...originalArgs: Parameters<typeof fetch>): Promise<Response> {
    const [url, ...rest] = originalArgs;
    const args = [
      typeof url === "string" ? "http://dummy-url" + url : url,
      ...rest,
    ] as const;
    return this.stub.fetch(...args);
  }
}
