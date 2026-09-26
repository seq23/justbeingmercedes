// What Mercedes has changed at /upload, and how the main page renders it. One small JSON object in R2
// (site.json) holds her bio, her short line above the name, and a description per replaced photo, so the
// main page costs ONE R2 read. Pure helpers here are unit-checked by scripts/validate.mjs.
//
// site.json: { bio?: { text, tagline?, updated }, slots: { <slot>: { alt, updated, og?: { w, h } } } }
//   A slot listed in `slots` has been replaced; `alt` is her description ("" = she left it blank).

export const BIO_MAX = 550; // characters; the worst case (BIO_MAX_PARAGRAPHS paragraphs) still fits one screen
export const BIO_MAX_PARAGRAPHS = 4;
export const TAGLINE_MAX = 40;
export const ALT_MAX = 300;
export const FALLBACK_ALT = "Photo of Mercedes"; // a replaced photo she did not describe
export const SITE_KEY = "site.json";
export const OG_KEY = "og-hero"; // JPEG rendition of the current hero, for link previews
export const OG_MAX_BYTES = 2 * 1024 * 1024;
export const STATE_TTL = 30; // seconds the main page may reuse site.json before reading R2 again

// Elements the main-page rewriter (functions/index.js) edits. The validator proves each one exists in
// public/index.html, so a markup change cannot silently leave the rewriter editing nothing.
export const SELECTORS = {
  bio: ".bio",
  tagline: ".eyebrow",
  ogImage: 'meta[property="og:image"]',
  ogWidth: 'meta[property="og:image:width"]',
  ogHeight: 'meta[property="og:image:height"]',
  ogAlt: 'meta[property="og:image:alt"]',
  heroPreload: 'link[rel="preload"][as="image"]',
  lightbox: ".lb",
  lightboxCaption: ".lb figcaption",
};

// Production and Pages previews share one bucket; wrangler.toml gives previews STORE_PREFIX="preview/"
// so testing a branch never touches what the live site shows.
export const key = (env, name) => (env.STORE_PREFIX || "") + name;

export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Control characters (except newline) and zero-width/bidi tricks out; CRLF to LF.
const scrub = (s) => String(s ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g, "");

// One line: newlines and runs of spaces collapse to a single space.
export const cleanLine = (s) => scrub(s).replace(/\s+/g, " ").trim();

// Bio: every non-blank line is a paragraph; blank lines are ignored; spaces inside a line collapse.
export const bioParagraphs = (s) => scrub(s).split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
export const cleanBio = (s) => bioParagraphs(s).join("\n\n");

// <!--email_off--> keeps Cloudflare's email obfuscation from turning an address in her bio into a script.
export const bioHtml = (s) => `<!--email_off-->${bioParagraphs(s).map((p) => `<p>${escapeHtml(p)}</p>`).join("")}<!--/email_off-->`;

// "Style & Beauty · New York" -> the eyebrow's spans, with the dot hidden from screen readers.
export const taglineParts = (s) => cleanLine(s).split(/\s*[·•|]\s*/).filter(Boolean);
export const taglineHtml = (s) =>
  taglineParts(s).map((p) => `<span>${escapeHtml(p)}</span>`).join('<span aria-hidden="true">·</span>');

// The bio and tagline shipped in public/index.html, read from the page itself (one source of truth).
const decode = (s) =>
  s.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " })[e]);
export function originalCopy(html) {
  const bio = html.match(/<div class="bio">([\s\S]*?)<\/div>/)?.[1] ?? "";
  const paras = [...bio.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => decode(m[1].replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim());
  const eyebrow = html.match(/<p class="eyebrow">([\s\S]*?)<\/p>/)?.[1] ?? "";
  const parts = [...eyebrow.matchAll(/<span>([\s\S]*?)<\/span>/g)].map((m) => decode(m[1]).trim()).filter(Boolean);
  return { text: paras.join("\n\n"), tagline: parts.join(" · ") };
}

// Pixel size of a JPEG / PNG / WebP from its header, or null. Used for og:image:width/height.
export function imageSize(buf) {
  const b = new Uint8Array(buf);
  const u16 = (i) => (b[i] << 8) | b[i + 1];
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length; ) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      if ((m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: u16(i + 7), h: u16(i + 5), type: "jpeg" };
      i += 2 + u16(i + 2);
    }
    return null;
  }
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const dv = new DataView(b.buffer, b.byteOffset);
    return { w: dv.getUint32(16), h: dv.getUint32(20), type: "png" };
  }
  const tag = (i) => String.fromCharCode(...b.slice(i, i + 4));
  if (tag(0) === "RIFF" && tag(8) === "WEBP") {
    const c = tag(12);
    if (c === "VP8 ") return { w: ((b[27] << 8) | b[26]) & 0x3fff, h: ((b[29] << 8) | b[28]) & 0x3fff, type: "webp" };
    if (c === "VP8L") { const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1, type: "webp" }; }
    if (c === "VP8X") return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)), type: "webp" };
  }
  return null;
}

const emptySite = () => ({ slots: {} });
const parse = (text) => {
  const s = JSON.parse(text);
  if (!s || typeof s !== "object" || Array.isArray(s)) throw new Error("site.json is not an object");
  return { ...s, slots: s.slots && typeof s.slots === "object" ? s.slots : {} };
};

// Uncached read, for writers and the /upload page.
export async function readSite(env) {
  const obj = await env.PHOTOS.get(key(env, SITE_KEY));
  return obj ? parse(await obj.text()) : emptySite();
}

// The main page's read: the colo cache first (STATE_TTL), else one R2 GET. Writers purge it.
const cacheKey = (request, env) => new URL(`/__site-state?p=${encodeURIComponent(env.STORE_PREFIX || "")}`, request.url).toString();
export async function readSiteCached(env, request, waitUntil) {
  const cache = globalThis.caches?.default;
  const k = cacheKey(request, env);
  if (cache) {
    const hit = await cache.match(k).catch(() => null);
    if (hit) return parse(await hit.text());
  }
  const obj = await env.PHOTOS.get(key(env, SITE_KEY));
  const text = obj ? await obj.text() : JSON.stringify(emptySite());
  const site = parse(text);
  if (cache) {
    const put = cache.put(k, new Response(text, { headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${STATE_TTL}` } })).catch(() => {});
    waitUntil ? waitUntil(put) : await put;
  }
  return site;
}

// Read-modify-write with an ETag condition so two quick saves cannot drop each other's change.
export async function updateSite(env, request, mutate) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const obj = await env.PHOTOS.get(key(env, SITE_KEY));
    const site = obj ? parse(await obj.text()) : emptySite();
    mutate(site);
    const put = await env.PHOTOS.put(key(env, SITE_KEY), JSON.stringify(site), {
      httpMetadata: { contentType: "application/json" },
      ...(obj ? { onlyIf: { etagMatches: obj.etag } } : {}),
    });
    if (put) {
      await globalThis.caches?.default?.delete(cacheKey(request, env)).catch(() => {});
      return site;
    }
  }
  throw new Error("Another change was being saved at the same moment. Try again.");
}
