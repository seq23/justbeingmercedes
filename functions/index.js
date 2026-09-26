// GET/HEAD / — the static public/index.html with Mercedes' changes from /upload written in on the way out
// (HTMLRewriter, so the page itself still ships no script):
//   - her bio (plain text, escaped, one <p> per line) and the short line above her name;
//   - each replaced photo's alt text: her description, or FALLBACK_ALT when she gave none; its lightbox
//     loses the original caption; its src gains ?v=<upload time> so browsers fetch the new photo at once;
//   - og:image/-width/-height/-alt follow the current big photo (/og-image.jpg?v=...).
// One R2 read (site.json), cached STATE_TTL seconds in the colo. If that read fails or is slow, the
// static page is served unchanged: never a broken page.
import { SLOTS } from "./_lib/slots.js";
import { FALLBACK_ALT, SELECTORS, bioHtml, readSiteCached, taglineHtml, taglineParts } from "./_lib/store.js";

export const READ_TIMEOUT_MS = 1500;
const LIGHTBOX_SLOT = Object.fromEntries(Object.entries(SLOTS).map(([slot, s]) => [s.lightbox, slot]));

// HTMLRewriter's setAttribute escapes `"` but not `&`, so "&amp;" in her text would reach the browser as
// "&". Escape `&` (and `<`/`>`, for sloppy link-preview parsers) here; scripts/e2e-upload.mjs round-trips
// "&amp;", quotes and "<b>" to pin this.
const attr = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

function tag(res, source) {
  const out = new Response(res.body, res);
  out.headers.set("X-Site-Content", source);
  return out;
}

export async function onRequest(context) {
  const { request, env, next } = context;
  if (request.method !== "GET" && request.method !== "HEAD") return next();
  // Always ask for the full page: a 304 from the static layer would let a browser keep an old bio.
  const headers = new Headers(request.headers);
  headers.delete("If-None-Match");
  headers.delete("If-Modified-Since");
  const res = await next(new Request(request.url, { method: request.method, headers }));
  if (res.status !== 200 || !(res.headers.get("Content-Type") || "").includes("text/html")) return res;

  let site;
  try {
    if (!env.PHOTOS) throw new Error("no PHOTOS binding");
    site = await withTimeout(readSiteCached(env, request, context.waitUntil?.bind(context)), READ_TIMEOUT_MS);
  } catch {
    return tag(res, "fallback");
  }
  const slots = site.slots || {};
  const bio = site.bio?.text ? site.bio : null;
  const changed = Object.keys(slots).filter((s) => SLOTS[s]);
  if (!bio && changed.length === 0) return tag(res, "original");

  const origin = new URL(request.url).origin;
  const altOf = (slot) => (slots[slot].alt || "").trim() || FALLBACK_ALT;
  const hero = slots.hero;
  let lbSlot = null; // the lightbox currently being streamed

  let rw = new HTMLRewriter()
    .on("img", {
      element(e) {
        const m = (e.getAttribute("src") || "").match(/^\/photos\/([\w-]+)(\?.*)?$/);
        const entry = m && SLOTS[m[1]] && slots[m[1]];
        if (!entry) return;
        e.setAttribute("alt", attr(altOf(m[1])));
        e.setAttribute("src", `/photos/${m[1]}${m[2] ? m[2] + "&" : "?"}v=${Number(entry.updated || 0).toString(36)}`);
      },
    })
    .on(SELECTORS.lightbox, {
      element(e) {
        lbSlot = LIGHTBOX_SLOT[e.getAttribute("id")] || null;
        if (lbSlot && slots[lbSlot]) e.setAttribute("aria-label", FALLBACK_ALT);
      },
    })
    .on(SELECTORS.lightboxCaption, { element(e) { if (lbSlot && slots[lbSlot]) e.remove(); } });

  if (bio) {
    rw = rw.on(SELECTORS.bio, { element(e) { e.setInnerContent(bioHtml(bio.text), { html: true }); } });
    if (taglineParts(bio.tagline || "").length) {
      rw = rw.on(SELECTORS.tagline, { element(e) { e.setInnerContent(taglineHtml(bio.tagline), { html: true }); } });
    }
  }
  if (hero) {
    const v = Number(hero.updated || 0).toString(36);
    const ogUrl = hero.og ? `${origin}/og-image.jpg?v=${v}` : `${origin}/photos/hero?v=${v}`;
    rw = rw
      .on(SELECTORS.heroPreload, { element(e) { if ((e.getAttribute("href") || "").startsWith("/photos/hero")) e.setAttribute("href", `/photos/hero?v=${v}`); } })
      .on(SELECTORS.ogImage, { element(e) { e.setAttribute("content", ogUrl); } })
      .on(SELECTORS.ogAlt, { element(e) { e.setAttribute("content", attr(altOf("hero"))); } })
      .on(SELECTORS.ogWidth, { element(e) { hero.og ? e.setAttribute("content", String(hero.og.w)) : e.remove(); } })
      .on(SELECTORS.ogHeight, { element(e) { hero.og ? e.setAttribute("content", String(hero.og.h)) : e.remove(); } });
  }

  const out = tag(rw.transform(res), "custom");
  out.headers.delete("ETag");
  out.headers.delete("Content-Length");
  out.headers.set("Cache-Control", "public, max-age=30");
  return out;
}
