// GET/HEAD /photos/<slot>[?size=thumb]
// Serves Mercedes' uploaded replacement from R2 when there is one, else 302s to the static photo in /assets.
import { SLOTS } from "../_lib/slots.js";

const CACHE = "public, max-age=300";

export async function onRequest({ request, params, env }) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  const slot = SLOTS[params.slot];
  if (!slot) return new Response("No such photo", { status: 404 });

  const obj = env.PHOTOS ? await env.PHOTOS.get(params.slot) : null;
  if (obj) {
    const headers = new Headers({
      "Content-Type": obj.httpMetadata?.contentType || "application/octet-stream",
      "Cache-Control": CACHE,
      ETag: obj.httpEtag,
      "X-Photo-Source": "upload",
    });
    return new Response(request.method === "HEAD" ? null : obj.body, { headers });
  }
  const size = new URL(request.url).searchParams.get("size") === "thumb" ? "thumb" : "full";
  return new Response(null, {
    status: 302,
    headers: { Location: slot[size], "Cache-Control": CACHE, "X-Photo-Source": "original" },
  });
}
