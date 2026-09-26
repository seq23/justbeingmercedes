// Shared by every write (photos, descriptions, bio). No password, by the owner's choice (25 Sep 2026):
// a write must come from a page on this site (same Origin) and one connection gets WRITES_PER_HOUR.
import { key } from "./store.js";

export const WRITES_PER_HOUR = 30;

export const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  return !!origin && origin === new URL(request.url).origin;
}

// One small R2 object per (hashed) IP holds this hour's write count. Racy by a write or two; fine for its job.
async function overLimit(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("jbm:" + ip));
  const k = key(env, "ratelimit/" + [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join(""));
  const hour = String(Math.floor(Date.now() / 3_600_000));
  const cur = await env.PHOTOS.head(k);
  const count = cur?.customMetadata?.hour === hour ? Number(cur.customMetadata.count) || 0 : 0;
  if (count >= WRITES_PER_HOUR) return true;
  await env.PHOTOS.put(k, "", { customMetadata: { hour, count: String(count + 1) } });
  return false;
}

export async function guard(request, env) {
  if (!env.PHOTOS) return json(500, { ok: false, error: "Storage is not connected. Nothing was changed." });
  if (!sameOrigin(request)) return json(403, { ok: false, error: "Changes can only be made from the upload page on this site." });
  if (await overLimit(request, env)) return json(429, { ok: false, error: `That is more than ${WRITES_PER_HOUR} changes in an hour. Try again later.` });
  return null;
}
