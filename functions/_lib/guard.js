// Shared by every write (photos, descriptions, bio). No password, by the owner's choice (25 Sep 2026);
// since 3 Nov 2026 a write needs a PAIRED DEVICE (signed HttpOnly cookie from a one-time pairing link,
// functions/_lib/device.js), must come from a page on this site (same Origin), and fits under
// WRITES_PER_HOUR per connection and WRITES_PER_DAY for the whole site.
import { key } from "./store.js";
import { isPairedDevice } from "./device.js";

export const WRITES_PER_HOUR = 30;
export const WRITES_PER_DAY = 200; // whole site; env.WRITES_PER_DAY may lower it (the e2e test does)

export const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  return !!origin && origin === new URL(request.url).origin;
}

// One small R2 object per counter holds its window and count. Racy by a write or two; fine for its job.
async function bump(env, name, window, max) {
  const k = key(env, "ratelimit/" + name);
  const cur = await env.PHOTOS.head(k);
  const count = cur?.customMetadata?.window === window ? Number(cur.customMetadata.count) || 0 : 0;
  if (count >= max) return true;
  await env.PHOTOS.put(k, "", { customMetadata: { window, count: String(count + 1) } });
  return false;
}

async function ipName(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("jbm:" + ip));
  return [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function dailyCap(env) {
  const n = Number(env.WRITES_PER_DAY);
  return Number.isFinite(n) && n > 0 ? Math.min(n, WRITES_PER_DAY) : WRITES_PER_DAY;
}

export async function guard(request, env) {
  if (!env.PHOTOS) return json(500, { ok: false, error: "Storage is not connected. Nothing was changed." });
  // NAMED STOP: without the signing secret no device can be paired, so every write is refused (fail closed).
  if (!env.DEVICE_SECRET) return json(503, { ok: false, error: "Changes are switched off until the site's DEVICE_SECRET is set. Nothing was changed." });
  if (!(await isPairedDevice(request, env))) {
    return json(401, { ok: false, error: "This phone is not set up to make changes yet. Open the set-up link you were sent, tap Pair this phone, then try again." });
  }
  if (!sameOrigin(request)) return json(403, { ok: false, error: "Changes can only be made from the upload page on this site." });
  const now = Date.now();
  if (await bump(env, await ipName(request), "h" + Math.floor(now / 3_600_000), WRITES_PER_HOUR)) {
    return json(429, { ok: false, limit: "hour", error: `That is more than ${WRITES_PER_HOUR} changes in an hour. Try again later.` });
  }
  if (await bump(env, "site-day", "d" + new Date(now).toISOString().slice(0, 10), dailyCap(env))) {
    return json(429, { ok: false, limit: "day", error: "The site has had as many changes as it takes in one day. Try again tomorrow." });
  }
  return null;
}
