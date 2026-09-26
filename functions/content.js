// GET /content — what the /upload page needs to fill its cards: the current bio and short line (hers or
// the original from public/index.html), and each photo spot's state and description. Never cached.
import { SLOTS } from "./_lib/slots.js";
import { json } from "./_lib/guard.js";
import { ALT_MAX, BIO_MAX, BIO_MAX_PARAGRAPHS, TAGLINE_MAX, originalCopy, readSite } from "./_lib/store.js";

export async function onRequestGet({ request, env }) {
  if (!env.PHOTOS) return json(500, { ok: false, error: "Storage is not connected." });
  const page = await env.ASSETS.fetch(new URL("/", request.url));
  const original = originalCopy(await page.text());
  const site = await readSite(env);
  const slots = Object.fromEntries(Object.keys(SLOTS).map((s) => [s, site.slots[s] ? { custom: true, alt: site.slots[s].alt || "" } : { custom: false, alt: "" }]));
  return json(200, {
    ok: true,
    bio: { custom: !!site.bio, text: site.bio?.text || original.text, tagline: site.bio?.tagline || original.tagline, original },
    slots,
    limits: { bio: BIO_MAX, paragraphs: BIO_MAX_PARAGRAPHS, tagline: TAGLINE_MAX, alt: ALT_MAX },
  });
}
