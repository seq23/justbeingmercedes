// POST /upload (multipart: slot, file) and DELETE /upload?slot=<slot>.
// GET /upload falls through to public/upload.html. No password, by the owner's choice (25 Sep 2026):
// guarded only by a same-origin check and a per-IP limit of WRITES_PER_HOUR.
import { SLOTS } from "./_lib/slots.js";

const TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);
const MAX_BYTES = 10 * 1024 * 1024;
const WRITES_PER_HOUR = 30;

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  return !!origin && origin === new URL(request.url).origin;
}

// One small R2 object per (hashed) IP holds this hour's write count. Racy by a write or two; fine for its job.
async function overLimit(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("jbm:" + ip));
  const key = "ratelimit/" + [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
  const hour = String(Math.floor(Date.now() / 3_600_000));
  const cur = await env.PHOTOS.head(key);
  const count = cur?.customMetadata?.hour === hour ? Number(cur.customMetadata.count) || 0 : 0;
  if (count >= WRITES_PER_HOUR) return true;
  await env.PHOTOS.put(key, "", { customMetadata: { hour, count: String(count + 1) } });
  return false;
}

async function guard(request, env) {
  if (!env.PHOTOS) return json(500, { ok: false, error: "Photo storage is not connected. Nothing was changed." });
  if (!sameOrigin(request)) return json(403, { ok: false, error: "Changes can only be made from the upload page on this site." });
  if (await overLimit(request, env)) return json(429, { ok: false, error: `That is more than ${WRITES_PER_HOUR} changes in an hour. Try again later.` });
  return null;
}

export async function onRequestPost({ request, env }) {
  const blocked = await guard(request, env);
  if (blocked) return blocked;
  let form;
  try { form = await request.formData(); } catch { return json(400, { ok: false, error: "Send the photo as a form upload with a slot and a file." }); }
  const slot = String(form.get("slot") || "");
  const file = form.get("file");
  if (!SLOTS[slot]) return json(400, { ok: false, error: `Unknown photo spot "${slot}". Use one of: ${Object.keys(SLOTS).join(", ")}.` });
  if (!file || typeof file === "string") return json(400, { ok: false, error: "No photo was attached." });
  if (!TYPES.has(file.type)) return json(415, { ok: false, error: "That file is not a JPEG, PNG, WebP or HEIC photo." });
  if (file.size > MAX_BYTES) return json(413, { ok: false, error: "That photo is over 10 MB. Pick a smaller one or take a screenshot of it." });
  if (file.size === 0) return json(400, { ok: false, error: "That file is empty." });
  await env.PHOTOS.put(slot, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { uploaded: new Date().toISOString(), bytes: String(file.size) },
  });
  return json(200, { ok: true, slot, url: `/photos/${slot}`, message: "Photo updated." });
}

export async function onRequestDelete({ request, env }) {
  const blocked = await guard(request, env);
  if (blocked) return blocked;
  const slot = new URL(request.url).searchParams.get("slot") || "";
  if (!SLOTS[slot]) return json(400, { ok: false, error: `Unknown photo spot "${slot}".` });
  await env.PHOTOS.delete(slot);
  return json(200, { ok: true, slot, url: `/photos/${slot}`, message: "Back to the original photo." });
}
