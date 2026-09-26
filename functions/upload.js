// POST /upload (multipart: slot, file?, alt?, share?) and DELETE /upload?slot=<slot>.
// GET /upload falls through to public/upload.html. No password, by the owner's choice (25 Sep 2026):
// guarded only by a same-origin check and a per-IP write limit (functions/_lib/guard.js).
//
// - file + alt: replace the photo; alt is her description ("" = none, the page then says FALLBACK_ALT).
// - alt alone: change the description of a photo she already replaced.
// - share (hero only): a JPEG rendition the phone makes for link previews (og:image). Without it a JPEG
//   upload is used as-is; any other type points og:image at /photos/hero.
import { SLOTS } from "./_lib/slots.js";
import { guard, json } from "./_lib/guard.js";
import { ALT_MAX, OG_KEY, OG_MAX_BYTES, cleanLine, imageSize, key, readSite, updateSite } from "./_lib/store.js";

const TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);
const MAX_BYTES = 10 * 1024 * 1024;

export async function onRequestPost({ request, env }) {
  const blocked = await guard(request, env);
  if (blocked) return blocked;
  let form;
  try { form = await request.formData(); } catch { return json(400, { ok: false, error: "Send the photo as a form upload with a slot and a file." }); }
  const slot = String(form.get("slot") || "");
  const file = form.get("file");
  const hasAlt = form.has("alt");
  const alt = cleanLine(form.get("alt") || "");
  if (!SLOTS[slot]) return json(400, { ok: false, error: `Unknown photo spot "${slot}". Use one of: ${Object.keys(SLOTS).join(", ")}.` });
  if (alt.length > ALT_MAX) return json(400, { ok: false, error: `That description is ${alt.length} characters. Keep it under ${ALT_MAX}.` });

  if (!file || typeof file === "string") {
    if (!hasAlt) return json(400, { ok: false, error: "No photo was attached." });
    if (!(await readSite(env)).slots[slot]) {
      return json(400, { ok: false, error: "Upload a photo here first. The original photo already has its own description." });
    }
    await updateSite(env, request, (s) => { if (s.slots[slot]) s.slots[slot] = { ...s.slots[slot], alt }; });
    return json(200, { ok: true, slot, alt, message: "Description saved." });
  }
  if (!TYPES.has(file.type)) return json(415, { ok: false, error: "That file is not a JPEG, PNG, WebP or HEIC photo." });
  if (file.size > MAX_BYTES) return json(413, { ok: false, error: "That photo is over 10 MB. Pick a smaller one or take a screenshot of it." });
  if (file.size === 0) return json(400, { ok: false, error: "That file is empty." });

  const bytes = await file.arrayBuffer();
  let og = null;
  if (slot === "hero") {
    const share = form.get("share");
    const candidates = [];
    if (share && typeof share !== "string" && share.size <= OG_MAX_BYTES) candidates.push(await share.arrayBuffer());
    if (file.size <= OG_MAX_BYTES) candidates.push(bytes);
    for (const c of candidates) {
      const size = imageSize(c);
      if (size?.type === "jpeg" && size.w > 0 && size.h > 0) {
        await env.PHOTOS.put(key(env, OG_KEY), c, { httpMetadata: { contentType: "image/jpeg" } });
        og = { w: size.w, h: size.h };
        break;
      }
    }
    if (!og) await env.PHOTOS.delete(key(env, OG_KEY));
  }
  await env.PHOTOS.put(key(env, slot), bytes, {
    httpMetadata: { contentType: file.type },
    customMetadata: { uploaded: new Date().toISOString(), bytes: String(file.size), alt: alt.slice(0, ALT_MAX) },
  });
  const updated = Date.now();
  await updateSite(env, request, (s) => { s.slots[slot] = { alt, updated, ...(og ? { og } : {}) }; });
  return json(200, { ok: true, slot, alt, url: `/photos/${slot}`, message: "Photo updated." });
}

export async function onRequestDelete({ request, env }) {
  const blocked = await guard(request, env);
  if (blocked) return blocked;
  const slot = new URL(request.url).searchParams.get("slot") || "";
  if (!SLOTS[slot]) return json(400, { ok: false, error: `Unknown photo spot "${slot}".` });
  await env.PHOTOS.delete(key(env, slot));
  if (slot === "hero") await env.PHOTOS.delete(key(env, OG_KEY));
  await updateSite(env, request, (s) => { delete s.slots[slot]; });
  return json(200, { ok: true, slot, url: `/photos/${slot}`, message: "Back to the original photo." });
}
