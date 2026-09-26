// GET/HEAD /og-image.jpg — the link-preview picture (og:image) for the current big photo.
// A JPEG rendition of Mercedes' uploaded hero when there is one, else a 302 to the original.
// The main page links it as /og-image.jpg?v=<upload time>, so unfurlers see a new URL per new photo.
import { OG_KEY, key } from "./_lib/store.js";

const CACHE = "public, max-age=300";
const ORIGINAL = "/assets/selfie.jpg";

export async function onRequest({ request, env }) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  const obj = env.PHOTOS ? await env.PHOTOS.get(key(env, OG_KEY)).catch(() => null) : null;
  if (!obj) return new Response(null, { status: 302, headers: { Location: ORIGINAL, "Cache-Control": CACHE, "X-Photo-Source": "original" } });
  const headers = new Headers({ "Content-Type": "image/jpeg", "Cache-Control": CACHE, ETag: obj.httpEtag, "X-Photo-Source": "upload" });
  return new Response(request.method === "HEAD" ? null : obj.body, { headers });
}
