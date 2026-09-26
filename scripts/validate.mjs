// Validator for justbeingmercedes.com. Reads the real page in a real browser and fails loudly.
// Run: npm run validate            (add --screenshots to also write screenshots/*.png)
//      npm run validate:static     (the merge gate: everything before the browser opens; validate.yml)
//      npm run screenshots         (the nightly e2e.yml: browser + screenshots, gates production)
// Rule 0: it refuses to pass if it checked nothing (no images found, zero checks run).
import { createServer } from "node:http";
import { readFile, readdir, stat, mkdir } from "node:fs/promises";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { SLOTS } from "../functions/_lib/slots.js";
import * as store from "../functions/_lib/store.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");
const EMAIL = "mercasare.social@gmail.com";
const SOCIALS = {
  Instagram: "https://www.instagram.com/merc.asare",
  TikTok: "https://www.tiktok.com/@mercasare",
  Linktree: "https://linktr.ee/merc.asare",
};
const MAX_IMAGE_BYTES = 400 * 1024;
const MIN_GALLERY = 5; // small photos under the bio (the set Sequoia chose, 25 Sep 2026)
const MAX_GALLERY = 8;
const VIEWPORTS = [
  // name, width, height, max page height allowed
  ["desktop-1440x900", 1440, 900, 900],
  ["desktop-1280x800", 1280, 800, 800],
  ["phone-390x844", 390, 844, Math.round(844 * 1.35)], // at most one short scroll on a phone
];
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif", ".svg"]);
const TYPES = { ".html": "text/html", ".css": "text/css", ".jpg": "image/jpeg", ".webp": "image/webp",
  ".png": "image/png", ".svg": "image/svg+xml" };

let checks = 0;
const failures = [];
const check = (ok, msg) => { checks++; if (!ok) failures.push(msg); };

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    out.push(...(e.isDirectory() ? await walk(p) : [p]));
  }
  return out;
}

// 1. Every image file that ships is under the size cap.
const images = (await walk(PUBLIC)).filter((f) => IMAGE_EXT.has(extname(f).toLowerCase()));
check(images.length > 0, "no image files found under public/ (Rule 0: nothing to check)");
for (const f of images) {
  const { size } = await stat(f);
  check(size <= MAX_IMAGE_BYTES, `${f.slice(ROOT.length + 1)} is ${Math.round(size / 1024)} KB (max 400 KB)`);
}

// 1b. Cloudflare's zone-wide email obfuscation rewrites mailto links into /cdn-cgi/ redirects plus an
// injected script. The address must sit inside <!--email_off--> ... <!--/email_off--> so it ships as-is.
{
  const html = await readFile(join(PUBLIC, "index.html"), "utf8");
  const off = html.match(/<!--email_off-->([\s\S]*?)<!--\/email_off-->/g) || [];
  const outside = html.replace(/<!--email_off-->[\s\S]*?<!--\/email_off-->/g, "");
  check(off.some((b) => b.includes(`mailto:${EMAIL}`)), "the collab mailto is not wrapped in <!--email_off--> (Cloudflare will obfuscate it)");
  check(!outside.includes(EMAIL), "the email address appears outside <!--email_off--> (Cloudflare will obfuscate it)");
}

// 2. Serve public/ exactly as Pages will (root-relative paths) and read the page in Chromium.
// 1c. The upload backend: the Pages Functions exist and export their handlers, and every slot is wired.
check(Object.keys(SLOTS).length >= 1 + MIN_GALLERY, `functions/_lib/slots.js lists ${Object.keys(SLOTS).length} slots (need hero + ${MIN_GALLERY})`);
check(!!SLOTS.hero, "no hero slot in functions/_lib/slots.js");
{
  const photosFn = await import("../functions/photos/[slot].js").catch((e) => ({ err: e }));
  check(typeof photosFn.onRequest === "function", `functions/photos/[slot].js must export onRequest (GET/HEAD /photos/:slot)${photosFn.err ? ": " + photosFn.err.message : ""}`);
  const uploadFn = await import("../functions/upload.js").catch((e) => ({ err: e }));
  check(typeof uploadFn.onRequestPost === "function", `functions/upload.js must export onRequestPost${uploadFn.err ? ": " + uploadFn.err.message : ""}`);
  check(typeof uploadFn.onRequestDelete === "function", "functions/upload.js must export onRequestDelete");
  const indexHtml = await readFile(join(PUBLIC, "index.html"), "utf8");
  const uploadHtml = await readFile(join(PUBLIC, "upload.html"), "utf8").catch(() => "");
  check(uploadHtml.length > 0, "public/upload.html is missing");
  for (const [slot, s] of Object.entries(SLOTS)) {
    check(indexHtml.includes(`src="/photos/${slot}"`), `index.html never shows /photos/${slot} (full size)`);
    if (slot !== "hero") check(indexHtml.includes(`src="/photos/${slot}?size=thumb"`), `index.html has no tile for /photos/${slot}?size=thumb`);
    check(uploadHtml.includes(`data-slot="${slot}"`) && uploadHtml.includes(`/photos/${slot}`), `upload.html has no card for slot ${slot}`);
    for (const u of [s.full, s.thumb]) {
      const size = await stat(join(PUBLIC, u)).then((st) => st.size).catch(() => -1);
      check(size > 0 && size <= MAX_IMAGE_BYTES, `slot ${slot} fallback ${u} is ${size < 0 ? "missing" : Math.round(size / 1024) + " KB"} (max 400 KB)`);
    }
  }
}

// 1d. Mercedes' edits (bio, short line, photo descriptions, link-preview photo): the rendering helpers
// escape everything, the upload page's limits are the server's limits, the main-page rewriter falls back to
// the static page when R2 fails, and branch previews write under their own prefix.
const WORST_BIO = ((html) => {
  // BIO_MAX characters of real-length words in BIO_MAX_PARAGRAPHS lines: the longest bio /bio accepts.
  const words = store.originalCopy(html).text.split(/\s+/);
  let t = "", i = 0;
  while ((t + " " + words[i % words.length]).length <= store.BIO_MAX - store.BIO_MAX_PARAGRAPHS) t += (t ? " " : "") + words[i++ % words.length];
  const w = t.split(" "), per = Math.ceil(w.length / store.BIO_MAX_PARAGRAPHS);
  return Array.from({ length: store.BIO_MAX_PARAGRAPHS }, (_, k) => w.slice(k * per, (k + 1) * per).join(" ")).join("\n");
})(await readFile(join(PUBLIC, "index.html"), "utf8"));
const WORST_TAGLINE = "Style & Beauty · New York · Corporate Babe".slice(0, store.TAGLINE_MAX);
{
  const indexHtml = await readFile(join(PUBLIC, "index.html"), "utf8");
  const tricky = '<script>alert(1)</script> & "q" \'s\r\n\r\n\r\n  second\u0007 line 💄​  \n';
  check(store.bioHtml(tricky) === "<!--email_off--><p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot; &#39;s</p><p>second line 💄</p><!--/email_off-->",
    `bioHtml does not escape / paragraph / scrub as pinned: ${store.bioHtml(tricky)}`);
  check(store.cleanBio(tricky) === '<script>alert(1)</script> & "q" \'s\n\nsecond line 💄', "cleanBio does not normalise CRLF, blank lines and control characters");
  check(store.bioParagraphs("a\n\n\n\nb\nc").length === 3, "bioParagraphs: each non-blank line must be one paragraph");
  check(store.taglineHtml("Style <b> · NYC") === '<span>Style &lt;b&gt;</span><span aria-hidden="true">·</span><span>NYC</span>', `taglineHtml does not escape/split: ${store.taglineHtml("Style <b> · NYC")}`);
  check(store.cleanLine("  a\n b\u0000\t c ") === "a b c", "cleanLine does not collapse to one clean line");
  check(WORST_BIO.length <= store.BIO_MAX && WORST_BIO.length > store.BIO_MAX - 40 && store.bioParagraphs(WORST_BIO).length === store.BIO_MAX_PARAGRAPHS,
    `worst-case bio fixture is ${WORST_BIO.length} chars / ${store.bioParagraphs(WORST_BIO).length} paragraphs, not the limit`);
  const orig = store.originalCopy(indexHtml);
  check(orig.text.length > 200 && !/[<>]/.test(orig.text), `originalCopy cannot read the bio from index.html (got ${orig.text.length} chars)`);
  check(orig.text.length <= store.BIO_MAX, `the shipped bio is ${orig.text.length} chars, over BIO_MAX ${store.BIO_MAX} (Mercedes could not re-save it)`);
  check(orig.tagline === "Style & Beauty · New York", `originalCopy reads the short line as "${orig.tagline}"`);
  for (const [f, w, h, type] of [["public/assets/selfie.jpg", 1077, 1380, "jpeg"], ["public/assets/selfie.webp", 1077, 1380, "webp"], ["photos-src/selfie.png", 0, 0, "png"]]) {
    const sz = store.imageSize(await readFile(join(ROOT, f)));
    check(sz?.type === type && (w === 0 ? sz.w > 0 && sz.h > 0 : sz.w === w && sz.h === h), `imageSize(${f}) = ${JSON.stringify(sz)}, want ${type} ${w || "?"}x${h || "?"}`);
  }
  check(store.imageSize(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])) === null, "imageSize accepts a non-image");
  check(store.key({ STORE_PREFIX: "preview/" }, "hero") === "preview/hero" && store.key({}, "hero") === "hero", "store key() does not apply STORE_PREFIX");

  // Handlers exist.
  const fns = {
    "index.js": ["onRequest"], "bio.js": ["onRequestPost", "onRequestDelete"], "content.js": ["onRequestGet"], "og-image.jpg.js": ["onRequest"],
  };
  const mods = {};
  for (const [f, names] of Object.entries(fns)) {
    mods[f] = await import(`../functions/${f}`).catch((e) => ({ err: e }));
    for (const n of names) check(typeof mods[f][n] === "function", `functions/${f} must export ${n}${mods[f].err ? ": " + mods[f].err.message : ""}`);
  }
  // The main page never breaks: R2 throwing, hanging, or missing -> the static page, untouched.
  if (typeof mods["index.js"].onRequest === "function") {
    const statics = () => new Response(indexHtml, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
    const run = (PHOTOS) => mods["index.js"].onRequest({ request: new Request("https://justbeingmercedes.com/"), env: { PHOTOS }, next: async () => statics(), waitUntil() {} });
    for (const [name, PHOTOS, want] of [
      ["R2 throws", { get: async () => { throw new Error("R2 down"); } }, "fallback"],
      ["no binding", undefined, "fallback"],
      ["R2 hangs", { get: () => new Promise(() => {}) }, "fallback"],
      ["site.json corrupt", { get: async () => ({ text: async () => "{not json" }) }, "fallback"],
      ["nothing changed", { get: async () => null }, "original"],
    ]) {
      const t0 = Date.now();
      const r = await run(PHOTOS).catch((e) => ({ err: e }));
      const body = r.err ? "" : await r.text();
      check(!r.err && r.status === 200 && r.headers.get("X-Site-Content") === want && body === indexHtml && Date.now() - t0 < mods["index.js"].READ_TIMEOUT_MS + 1000,
        `main page with ${name}: want the static page (${want}) promptly, got ${r.err ? r.err.message : r.status + " " + r.headers.get("X-Site-Content")} in ${Date.now() - t0} ms`);
    }
  }

  // The upload page: bio card and a description field per photo, limits equal to the server's.
  const up = await readFile(join(PUBLIC, "upload.html"), "utf8");
  const attrOf = (html, re) => html.match(re)?.[1];
  check(Number(attrOf(up, /<textarea id="bio"[^>]*maxlength="(\d+)"/)) === store.BIO_MAX, `upload.html #bio maxlength must be BIO_MAX ${store.BIO_MAX}`);
  check(Number(attrOf(up, /<input id="tagline"[^>]*maxlength="(\d+)"/)) === store.TAGLINE_MAX, `upload.html #tagline maxlength must be TAGLINE_MAX ${store.TAGLINE_MAX}`);
  check(/id="bio-count"/.test(up) && /id="bio-save"/.test(up) && /id="bio-reset"[^>]*>Back to original</.test(up), "upload.html bio card lacks its character count, Save or Back to original");
  check(up.indexOf('id="bio-card"') > 0 && up.indexOf('id="bio-card"') < up.indexOf('class="card"'), "the bio card must come before the photo cards on /upload");
  check(new RegExp(`up to ${store.BIO_MAX_PARAGRAPHS}\\)`).test(up), `upload.html bio hint must name the ${store.BIO_MAX_PARAGRAPHS}-paragraph limit`);
  for (const slot of Object.keys(SLOTS)) {
    const card = up.match(new RegExp(`<li class="card" data-slot="${slot}">([\\s\\S]*?)</li>`))?.[1] || "";
    check(Number(attrOf(card, /<textarea id="alt-[\w-]+" name="alt"[^>]*maxlength="(\d+)"/)) === store.ALT_MAX && /Describe this photo/.test(card) && /screen readers/.test(card),
      `upload card ${slot} has no "Describe this photo" field with maxlength ${store.ALT_MAX} and a screen-reader hint`);
  }

  // Previews never write production keys.
  const toml = (await readFile(join(ROOT, "wrangler.toml"), "utf8")).replace(/#.*$/gm, "");
  const [top, preview = ""] = toml.split(/^\[env\.preview/m).length > 1 ? [toml.split(/^\[env\./m)[0], toml.slice(toml.search(/^\[env\.preview/m))] : [toml];
  check(!/STORE_PREFIX/.test(top), "wrangler.toml: production (top level) must not set STORE_PREFIX");
  check(/^\[env\.preview\.vars\][^[]*STORE_PREFIX\s*=\s*"[\w-]+\/"/m.test(preview), "wrangler.toml: [env.preview.vars] must set STORE_PREFIX = \"<name>/\" so previews never touch live keys");
  check(/\[\[env\.preview\.r2_buckets\]\][^[]*binding\s*=\s*"PHOTOS"/.test(preview), "wrangler.toml: previews need their own PHOTOS binding ([[env.preview.r2_buckets]])");
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const path = decodeURIComponent(url.pathname);
  // Emulate functions/photos/[slot].js with no uploads: 302 to the static fallback.
  const m = path.match(/^\/photos\/([\w-]+)$/);
  if (m) {
    const s = SLOTS[m[1]];
    if (!s) { res.writeHead(404).end("no such photo"); return; }
    res.writeHead(302, { location: url.searchParams.get("size") === "thumb" ? s.thumb : s.full }).end();
    return;
  }
  const file = join(PUBLIC, path.endsWith("/") ? path + "index.html" : path);
  if (!file.startsWith(PUBLIC)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" }).end(body);
  } catch { res.writeHead(404).end("not found"); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;

// --static is the MERGE GATE (validate.yml): everything above ran without a browser — the image cap,
// the email_off wrapping, the Functions' exports and slot wiring, the rendering helpers. The page-in-
// Chromium checks below (one screen, no horizontal scroll, hero loads, links, alt text, lightboxes)
// are the nightly `e2e.yml`, which gates production. Rule 0 still applies to the static half.
if (process.argv.includes("--static")) { server.close(); finish("static checks only, no browser"); }

const browser = await chromium.launch();
const t0 = Date.now();
const shots = process.argv.includes("--screenshots");
if (shots) await mkdir(join(ROOT, "screenshots"), { recursive: true });
try {
  for (const [name, width, height, maxH] of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width, height } });
    const missing = [];
    page.on("response", (r) => { if (r.url().startsWith(base) && r.status() >= 400) missing.push(r.url()); });
    // Fonts come from Google; offline runs still measure with the fallback stack.
    await page.goto(base, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForLoadState("load", { timeout: 15000 }).catch(() => console.warn(`${name}: load event late (fonts?), measuring anyway`));
    await page.evaluate(() => Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 5000))]));
    await page.evaluate(() => Promise.race([
      Promise.all([...document.images].map((i) => i.decode().catch(() => {}))),
      new Promise((r) => setTimeout(r, 5000)),
    ]));
    await page.waitForTimeout(1300); // let the load animation settle

    const m = await page.evaluate(() => ({
      scrollH: document.documentElement.scrollHeight,
      scrollW: document.documentElement.scrollWidth,
      heroW: document.querySelector(".hero img")?.naturalWidth ?? 0,
    }));
    check(m.scrollH <= maxH, `${name}: page is ${m.scrollH}px tall (max ${maxH}px)`);
    check(m.scrollW <= width, `${name}: horizontal scroll, page is ${m.scrollW}px wide at ${width}px`);
    check(m.heroW > 0, `${name}: hero image did not load`);
    check(missing.length === 0, `${name}: local 404s: ${missing.join(", ")}`);
    console.log(`  ${name}: ${m.scrollW}x${m.scrollH} (${Date.now() - t0} ms)`);
    if (shots) await page.screenshot({ path: join(ROOT, "screenshots", `${name}.png`) });

    if (name === VIEWPORTS[0][0]) {
      // DOM content checks, once.
      const d = await page.evaluate(() => {
        const hrefs = [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href"));
        return {
          hrefs,
          h1s: [...document.querySelectorAll("h1")].map((h) => h.textContent.trim()),
          imgs: [...document.querySelectorAll("img")].map((i) => ({ src: i.getAttribute("src"), alt: (i.getAttribute("alt") || "").trim() })),
          title: document.title,
          og: {
            title: document.querySelector('meta[property="og:title"]')?.content,
            image: document.querySelector('meta[property="og:image"]')?.content,
            description: document.querySelector('meta[property="og:description"]')?.content,
          },
          favicon: !!document.querySelector('link[rel~="icon"]'),
          bioText: [...document.querySelectorAll(".bio p")].map((p) => p.textContent.replace(/\s+/g, " ").trim()).join("\n\n"),
          scripts: [...document.querySelectorAll("script")].map((s) => s.src || "inline <script>"),
          localSrcs: [...document.querySelectorAll("img[src], source[srcset]")]
            .flatMap((e) => (e.getAttribute("src") || e.getAttribute("srcset")).split(",").map((c) => c.trim().split(/\s+/)[0]))
            .filter((u) => u.startsWith("/")),
          tiles: [...document.querySelectorAll("#gallery a.tile")].map((a) => {
            const id = (a.getAttribute("href") || "").replace(/^#/, "");
            const lb = id ? document.getElementById(id) : null;
            const thumb = a.querySelector("img");
            const full = lb?.querySelector("img.lb-full");
            return {
              href: a.getAttribute("href"), id, hasLb: !!lb && lb.classList.contains("lb"),
              thumb: thumb?.getAttribute("src"), full: full?.getAttribute("src"),
              fullWebp: lb?.querySelector("source")?.getAttribute("srcset"),
              fullAlt: (full?.getAttribute("alt") || "").trim(),
              hasClose: !!lb?.querySelector("a.lb-close[href]"),
            };
          }),
        };
      });
      // Every element functions/index.js rewrites exists, so an edit to the markup cannot orphan the rewriter.
      for (const [name, sel] of Object.entries(store.SELECTORS)) {
        const n = await page.locator(sel).count();
        const want = ["bio", "tagline", "ogImage", "ogWidth", "ogHeight", "ogAlt", "heroPreload"].includes(name) ? n === 1 : n >= 1;
        check(want, `rewriter selector ${name} (${sel}) matches ${n} elements in index.html`);
      }
      check(await page.locator(".bio > p").count() >= 1, ".bio must hold its text in <p> children (the rewriter replaces them)");
      check(d.bioText === store.originalCopy(await readFile(join(PUBLIC, "index.html"), "utf8")).text, "originalCopy (what /upload shows as the original bio) differs from the bio the page shows");
      for (const [slot, s] of Object.entries(SLOTS)) {
        check(await page.locator(`.lb#${s.lightbox} img[src^="/photos/${slot}"]`).count() === 1, `slot ${slot}: lightbox #${s.lightbox} (slots.js) does not hold /photos/${slot}`);
      }
      const mailto = d.hrefs.find((h) => h?.toLowerCase().startsWith(`mailto:${EMAIL}`));
      check(!!mailto, `no mailto link to ${EMAIL}`);
      check(!!mailto && /[?&]subject=/i.test(mailto), "the collab mailto has no subject line");
      for (const [label, url] of Object.entries(SOCIALS)) {
        check(d.hrefs.some((h) => h?.replace(/\/$/, "") === url), `missing ${label} link ${url}`);
      }
      check(!d.hrefs.some((h) => /[?&](utm_|fbclid|igsh|si=)/i.test(h || "")), "a link still carries tracking params");
      check(d.h1s.length === 1 && d.h1s[0].length > 0, `expected exactly one non-empty <h1>, found ${d.h1s.length}`);
      check(d.imgs.length > 0, "no <img> on the page (Rule 0: nothing to check)");
      for (const i of d.imgs) check(i.alt.length > 0, `<img src="${i.src}"> has no alt text`);
      check(d.title === "Just Being Mercedes", `title is "${d.title}", expected "Just Being Mercedes"`);
      check(!!d.og.title && !!d.og.image && !!d.og.description, "missing og:title / og:image / og:description");
      check(d.favicon, "no favicon link");
      check(d.scripts.length === 0, `no scripts allowed (external or inline): ${d.scripts.join(", ")}`);
      for (const u of new Set(d.localSrcs)) {
        if (u.startsWith("/photos/")) {
          check(!!SLOTS[u.slice(8).split("?")[0]], `image ${u} names a photo slot that does not exist`);
          continue;
        }
        const f = join(PUBLIC, u);
        const ok = await stat(f).then((st) => st.isFile()).catch(() => false);
        check(ok, `image ${u} is referenced but missing from public/`);
      }

      // Gallery: 5-8 small photos, each opening its own full-size lightbox.
      check(d.tiles.length >= MIN_GALLERY, `gallery has ${d.tiles.length} small photos (min ${MIN_GALLERY})`);
      check(d.tiles.length <= MAX_GALLERY, `gallery has ${d.tiles.length} small photos (max ${MAX_GALLERY})`);
      for (const t of d.tiles) {
        check(/^#photo-[\w-]+$/.test(t.href || "") && t.hasLb, `tile ${t.href} has no matching .lb lightbox target`);
        check(t.hasClose, `lightbox ${t.id} has no close link`);
        check(t.fullAlt.length > 0, `lightbox ${t.id} image has no alt text`);
        check(!!t.full && t.full !== t.thumb && !/-thumb\.|size=thumb/.test(t.full), `lightbox ${t.id} shows the thumbnail, not the full-size photo`);
        const slotOf = (u) => SLOTS[(u || "").match(/^\/photos\/([\w-]+)/)?.[1]];
        check(!!slotOf(t.full) && !!slotOf(t.thumb), `tile ${t.id} does not load through /photos/<slot> (uploads would never show)`);
        for (const u of [slotOf(t.full)?.full, t.fullWebp].filter(Boolean)) {
          const size = await stat(join(PUBLIC, u)).then((st) => st.size).catch(() => -1);
          check(size > 0 && size <= MAX_IMAGE_BYTES, `full-size ${u} is ${size < 0 ? "missing" : Math.round(size / 1024) + " KB"} (max 400 KB)`);
        }
        // Open it for real: it must show, load the full file (bigger than the tile), then close.
        await page.goto(base + t.href);
        const lb = page.locator(`#${t.id}`);
        const shown = await lb.isVisible();
        check(shown, `lightbox ${t.id} does not appear when its tile is opened`);
        if (shown) {
          const full = lb.locator("img.lb-full");
          await full.evaluate((i) => i.decode().catch(() => {}));
          const nat = await full.evaluate((i) => i.naturalWidth);
          const thumbW = await page.locator(`a.tile[href="${t.href}"] img`).evaluate((i) => Number(i.getAttribute("width")));
          check(nat > thumbW, `lightbox ${t.id} loaded ${nat}px wide, not larger than its ${thumbW}px thumbnail`);
          await lb.locator("a.lb-close").click();
          check(!(await lb.isVisible()), `lightbox ${t.id} does not close from its close link`);
        }
      }
      await page.goto(base);
    }
    const links = await page.evaluate(() => document.querySelector(".links")?.getBoundingClientRect().bottom ?? Infinity);
    if (width > 760) check(links <= height, `${name}: the collab pill / social links end at ${Math.round(links)}px, below the ${height}px screen`);

    // Tap the first tile like a phone user, screenshot the open lightbox, then use Back to close it.
    const first = page.locator("#gallery a.tile").first();
    if (await first.count()) {
      await first.scrollIntoViewIfNeeded();
      await first.click();
      const open = page.locator(".lb:target");
      await open.locator("img.lb-full").evaluate((i) => i.decode().catch(() => {})).catch(() => {});
      await page.waitForTimeout(400);
      check(await open.isVisible(), `${name}: tapping a tile does not open its lightbox`);
      if (shots) await page.screenshot({ path: join(ROOT, "screenshots", `${name}-lightbox.png`) });
      await page.goBack();
      check((await page.locator(".lb:target").count()) === 0, `${name}: Back does not close the lightbox`);
      const w = await page.evaluate(() => document.documentElement.scrollWidth);
      check(w <= width, `${name}: horizontal scroll after using the gallery (${w}px)`);
    }
    // The longest bio and short line /bio accepts must still fit the screen (Mercedes can save them).
    await page.evaluate(([b, t]) => {
      document.querySelector(".bio").innerHTML = b;
      document.querySelector(".eyebrow").innerHTML = t;
    }, [store.bioHtml(WORST_BIO), store.taglineHtml(WORST_TAGLINE)]);
    await page.waitForTimeout(100);
    const worst = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, w: document.documentElement.scrollWidth, links: document.querySelector(".links")?.getBoundingClientRect().bottom ?? Infinity }));
    check(worst.h <= maxH && worst.w <= width, `${name}: the longest allowed bio (${store.BIO_MAX} chars, ${store.BIO_MAX_PARAGRAPHS} paragraphs) makes the page ${worst.w}x${worst.h} (max ${width}x${maxH})`);
    if (width > 760) check(worst.links <= height, `${name}: with the longest allowed bio the collab/social links end at ${Math.round(worst.links)}px, below the ${height}px screen`);
    if (shots) await page.screenshot({ path: join(ROOT, "screenshots", `${name}-longest-bio.png`) });
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

finish(`${VIEWPORTS.length} viewports`);

function finish(scope) {
  if (checks === 0) { console.error("validate: FAIL, zero checks ran (Rule 0)"); process.exit(1); }
  if (failures.length) {
    console.error(`validate: FAIL, ${failures.length} of ${checks} checks failed`);
    for (const f of failures) console.error("  - " + f);
    process.exit(1);
  }
  console.log(`validate: PASS, ${checks} checks (${images.length} image files, ${scope})`);
  process.exit(0);
}
