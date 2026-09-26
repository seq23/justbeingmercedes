// End-to-end test of the /upload backend against `wrangler pages dev` with a throwaway local R2.
// Run: npm test   (CI runs it too). Exits non-zero on the first broken expectation; Rule 0 on zero checks.
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, crc32 } from "node:zlib";
import { readFile } from "node:fs/promises";
import { SLOTS } from "../functions/_lib/slots.js";
import { FALLBACK_ALT, originalCopy } from "../functions/_lib/store.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8700 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const ORIGIN = { Origin: BASE };
let checks = 0;
const failures = [];
const check = (ok, msg) => { checks++; if (!ok) failures.push(msg); console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); };

// A real 2x2 PNG, built by hand so the test needs no fixtures.
function png() {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.from([0, 200, 30, 90, 10, 20, 200, 0, 250, 250, 250, 5, 5, 5]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const form = (slot, bytes, type, name = "t.png") => {
  const f = new FormData(); f.append("slot", slot); f.append("file", new Blob([bytes], { type }), name); return f;
};
// Every request carrying the same-site Origin passes the origin check and counts toward the hourly limit.
let writes = 0;
const get = (path, init = {}) => {
  if (init.headers?.Origin) writes++;
  return fetch(BASE + path, { redirect: "manual", ...init });
};
const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[e]);
const page = async () => {
  const r = await get("/");
  const html = await r.text();
  const img = (re) => { const tag = html.match(re)?.[0] || ""; return { src: tag.match(/src="([^"]*)"/)?.[1], alt: decode(tag.match(/alt="([^"]*)"/)?.[1] ?? "") }; };
  const meta = (prop) => { const m = html.match(new RegExp(`<meta property="${prop}" content="([^"]*)"`)); return m ? decode(m[1]) : null; };
  const lb = (id) => html.match(new RegExp(`<div class="lb" id="${id}"[\\s\\S]*?</div>`))?.[0] || "";
  return { r, html, img, meta, lb };
};
const tileRe = (slot) => new RegExp(`<img src="/photos/${slot}\\?size=thumb[^"]*"[^>]*>`);
const fullRe = (slot) => new RegExp(`<img class="lb-full" src="/photos/${slot}(\\?[^"]*)?"[^>]*>`);

const persist = await mkdtemp(join(tmpdir(), "jbm-r2-"));
const dev = spawn("npx", ["wrangler", "pages", "dev", "public", "--ip", "127.0.0.1", "--port", String(PORT), "--persist-to", persist],
  { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true" } });
let log = "";
dev.stdout.on("data", (d) => (log += d)); dev.stderr.on("data", (d) => (log += d));

try {
  const t0 = Date.now();
  for (;;) {
    if (Date.now() - t0 > 90_000) throw new Error("wrangler pages dev did not start in 90 s:\n" + log.slice(-2000));
    if (dev.exitCode !== null) throw new Error("wrangler pages dev exited:\n" + log.slice(-2000));
    try { await fetch(BASE + "/"); break; } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  check(/env\.PHOTOS.*R2 Bucket/.test(log), "wrangler sees the PHOTOS R2 binding");

  const slot = "photo-3";
  let r = await get(`/photos/${slot}`);
  check(r.status === 302 && r.headers.get("location") === SLOTS[slot].full, `GET /photos/${slot} with no upload -> 302 ${SLOTS[slot].full} (got ${r.status} ${r.headers.get("location")})`);
  r = await get(`/photos/${slot}?size=thumb`);
  check(r.status === 302 && r.headers.get("location") === SLOTS[slot].thumb, `thumb falls back to ${SLOTS[slot].thumb}`);
  r = await get("/photos/not-a-slot");
  check(r.status === 404, `unknown slot -> 404 (got ${r.status})`);
  r = await get("/upload");
  check(r.status === 200 && /Change your page[\s\S]*Your bio[\s\S]*Describe this photo/.test(await r.text()), "GET /upload serves the page with the bio card and photo descriptions");

  const img = png();
  r = await get("/upload", { method: "POST", body: form(slot, img, "image/png") });
  check(r.status === 403, `POST without a same-site Origin -> 403 (got ${r.status})`);
  r = await get("/upload", { method: "POST", headers: ORIGIN, body: form(slot, Buffer.from("hello"), "text/plain", "t.txt") });
  check(r.status === 415, `POST a text file -> 415 (got ${r.status})`);
  r = await get("/upload", { method: "POST", headers: ORIGIN, body: form(slot, Buffer.alloc(10 * 1024 * 1024 + 1), "image/jpeg", "big.jpg") });
  const big = await r.json().catch(() => ({}));
  check(r.status === 413 && /10 MB/.test(big.error || ""), `POST over 10 MB -> 413 with a plain sentence (got ${r.status}: ${big.error})`);
  r = await get("/upload", { method: "POST", headers: ORIGIN, body: form("not-a-slot", img, "image/png") });
  check(r.status === 400, `POST to an unknown slot -> 400 (got ${r.status})`);

  r = await get("/upload", { method: "POST", headers: ORIGIN, body: form(slot, img, "image/png") });
  const up = await r.json().catch(() => ({}));
  check(r.status === 200 && up.ok === true && up.slot === slot, `POST a PNG to ${slot} -> 200 ok (got ${r.status} ${JSON.stringify(up)})`);
  r = await get(`/photos/${slot}`);
  const back = Buffer.from(await r.arrayBuffer());
  check(r.status === 200 && r.headers.get("content-type") === "image/png" && back.equals(img), `GET /photos/${slot} now serves the uploaded PNG byte for byte`);
  check(/max-age=300/.test(r.headers.get("cache-control") || ""), "uploaded photo is cacheable for 5 minutes");
  r = await get(`/photos/${slot}`, { method: "HEAD" });
  check(r.status === 200, `HEAD /photos/${slot} -> 200 after upload (the upload page uses this)`);
  r = await get("/photos/photo-1");
  check(r.status === 302, "other slots are untouched");

  r = await get(`/upload?slot=${slot}`, { method: "DELETE" });
  check(r.status === 403, `DELETE without a same-site Origin -> 403 (got ${r.status})`);
  r = await get(`/upload?slot=${slot}`, { method: "DELETE", headers: ORIGIN });
  check(r.status === 200, `DELETE /upload?slot=${slot} -> 200 (got ${r.status})`);
  r = await get(`/photos/${slot}`);
  check(r.status === 302 && r.headers.get("location") === SLOTS[slot].full, `after DELETE, /photos/${slot} is back to the 302 fallback`);

  // ---- Photo descriptions (alt text) on the main page ----
  const staticHtml = await readFile(join(ROOT, "public", "index.html"), "utf8");
  const origAlt = (slot) => decode(staticHtml.match(fullRe(slot))?.[0].match(/alt="([^"]*)"/)?.[1] || "");
  const lbId = SLOTS[slot].lightbox;
  let p = await page();
  check(p.r.status === 200 && p.r.headers.get("x-site-content") === "original", `GET / with nothing changed -> static page (x-site-content ${p.r.headers.get("x-site-content")})`);
  check(p.img(fullRe(slot)).alt === origAlt(slot) && origAlt(slot).length > 20, `${slot} shows its original alt while the original photo is in place`);
  const desc = 'Mercedes in a red dress & "big" hat <b>, Tom &amp; Jerry';
  const withAlt = form(slot, img, "image/png"); withAlt.append("alt", desc + "\n");
  r = await get("/upload", { method: "POST", headers: ORIGIN, body: withAlt });
  check(r.status === 200, `upload with a description -> 200 (got ${r.status})`);
  p = await page();
  const tileImg = p.img(tileRe(slot)), fullImg = p.img(fullRe(slot));
  check(p.r.headers.get("x-site-content") === "custom", "after an upload the main page is rendered with her changes");
  check(tileImg.alt === desc && fullImg.alt === desc, `tile and enlarged ${slot} alt are her description exactly (got "${fullImg.alt}")`);
  check(/[?&]v=\w+/.test(tileImg.src || "") && /[?&]size=thumb/.test(tileImg.src || "") && /\?v=\w+$/.test(fullImg.src || ""), `replaced ${slot} srcs carry a version so browsers fetch it at once (${tileImg.src}, ${fullImg.src})`);
  check(!/<figcaption>/.test(p.lb(lbId)) && p.lb(lbId).includes(`aria-label="${FALLBACK_ALT}"`), `lightbox #${lbId} drops the original caption once replaced`);
  check(p.img(fullRe("photo-1")).alt === origAlt("photo-1") && /<figcaption>/.test(p.lb(SLOTS["photo-1"].lightbox)), "untouched photos keep their original alt and caption");
  check(!/<script/i.test(p.html) && p.html.includes("<!--email_off-->") && p.html.includes('href="mailto:mercasare.social@gmail.com?subject='), "rendered page: still no script, mailto untouched inside email_off");
  const altOnly = new FormData(); altOnly.append("slot", slot); altOnly.append("alt", "Mercedes on a rooftop");
  r = await get("/upload", { method: "POST", headers: ORIGIN, body: altOnly });
  check(r.status === 200 && (await page()).img(fullRe(slot)).alt === "Mercedes on a rooftop", "a description alone updates the replaced photo's alt");
  r = await get("/upload", { method: "POST", headers: ORIGIN, body: form(slot, img, "image/png") });
  p = await page();
  check(r.status === 200 && p.img(fullRe(slot)).alt === FALLBACK_ALT && p.img(tileRe(slot)).alt === FALLBACK_ALT, `replaced without a description -> "${FALLBACK_ALT}" (got "${p.img(fullRe(slot)).alt}")`);
  const altOrig = new FormData(); altOrig.append("slot", "photo-1"); altOrig.append("alt", "x");
  r = await get("/upload", { method: "POST", headers: ORIGIN, body: altOrig });
  check(r.status === 400, `a description for a photo still original -> 400 (got ${r.status})`);
  const longAlt = form(slot, img, "image/png"); longAlt.append("alt", "x".repeat(301));
  r = await get("/upload", { method: "POST", headers: ORIGIN, body: longAlt });
  check(r.status === 400, `a description over 300 characters -> 400 (got ${r.status})`);
  let c = await (await get("/content")).json();
  check(c.slots?.[slot]?.custom === true && c.slots?.["photo-1"]?.custom === false, "GET /content reports which photos are replaced");
  r = await get(`/upload?slot=${slot}`, { method: "DELETE", headers: ORIGIN });
  p = await page();
  check(r.status === 200 && p.img(fullRe(slot)).alt === origAlt(slot) && p.img(fullRe(slot)).src === `/photos/${slot}` && /<figcaption>/.test(p.lb(lbId)), "Back to original restores the original alt, src and caption");

  // ---- Link preview follows the big photo ----
  const jpeg = await readFile(join(ROOT, "public", "assets", "selfie.jpg"));
  check(p.meta("og:image") === "https://justbeingmercedes.com/assets/selfie.jpg", `og:image is the original while the original hero is up (${p.meta("og:image")})`);
  const heroUp = form("hero", img, "image/png"); heroUp.append("share", new Blob([jpeg], { type: "image/jpeg" }), "share.jpg"); heroUp.append("alt", "Mercedes at the Met");
  r = await get("/upload", { method: "POST", headers: ORIGIN, body: heroUp });
  p = await page();
  const og = p.meta("og:image") || "";
  check(r.status === 200 && og.startsWith(`${BASE}/og-image.jpg?v=`), `new hero -> og:image is the JPEG rendition (${og})`);
  check(p.meta("og:image:width") === "1077" && p.meta("og:image:height") === "1380", `og:image:width/height are the rendition's real size (${p.meta("og:image:width")}x${p.meta("og:image:height")})`);
  check(p.meta("og:image:alt") === "Mercedes at the Met" && p.img(/<img src="\/photos\/hero[^"]*"[^>]*>/).alt === "Mercedes at the Met", "og:image:alt and the hero alt follow her description");
  check(/<link rel="preload" as="image" href="\/photos\/hero\?v=\w+">/.test(p.html), "the hero preload matches the versioned hero src");
  r = await get(og.slice(BASE.length));
  const ogBytes = Buffer.from(await r.arrayBuffer());
  check(r.status === 200 && r.headers.get("content-type") === "image/jpeg" && ogBytes.equals(jpeg) && /max-age=300/.test(r.headers.get("cache-control") || ""), "og:image URL serves that JPEG, cacheable 5 minutes");
  r = await get("/upload", { method: "POST", headers: ORIGIN, body: form("hero", img, "image/png") });
  p = await page();
  check(r.status === 200 && (p.meta("og:image") || "").startsWith(`${BASE}/photos/hero?v=`) && p.meta("og:image:width") === null && p.meta("og:image:alt") === FALLBACK_ALT,
    `a hero with no JPEG rendition -> og:image is /photos/hero with no stale size (${p.meta("og:image")}, w=${p.meta("og:image:width")})`);
  r = await get("/upload?slot=hero", { method: "DELETE", headers: ORIGIN });
  p = await page();
  check(r.status === 200 && p.meta("og:image") === "https://justbeingmercedes.com/assets/selfie.jpg" && p.meta("og:image:width") === "1077", "Back to original restores og:image and its size");
  r = await get("/og-image.jpg");
  check(r.status === 302 && r.headers.get("location") === "/assets/selfie.jpg", `/og-image.jpg with no upload -> 302 to the original (got ${r.status})`);

  // ---- Bio ----
  const orig = originalCopy(staticHtml);
  const jsonPost = (body, headers = ORIGIN) => get("/bio", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  r = await jsonPost({ bio: "x" }, {});
  check(r.status === 403, `POST /bio without a same-site Origin -> 403 (got ${r.status})`);
  const tricky = "<script>alert('x')</script> & friends 💄\r\n\r\n\r\n  Second <b>para</b> — hi@example.com  \n\nThird";
  r = await jsonPost({ bio: tricky, tagline: "Beauty <i> · Brooklyn" });
  check(r.status === 200, `POST /bio with tricky input -> 200 (got ${r.status})`);
  p = await page();
  const bioBlock = p.html.match(/<div class="bio">([\s\S]*?)<\/div>/)?.[1] || "";
  check(bioBlock === "<!--email_off--><p>&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; friends 💄</p><p>Second &lt;b&gt;para&lt;/b&gt; — hi@example.com</p><p>Third</p><!--/email_off-->",
    `bio renders escaped, one <p> per line, blank lines dropped, inside email_off (got ${bioBlock})`);
  check(/<p class="eyebrow"><span>Beauty &lt;i&gt;<\/span><span aria-hidden="true">·<\/span><span>Brooklyn<\/span><\/p>/.test(p.html), "the short line renders escaped as the eyebrow's spans");
  check(!/<script/i.test(p.html), "a bio with <script> leaves no <script> on the page");
  r = await jsonPost({ bio: "x".repeat(551) });
  check(r.status === 400, `a bio over 550 characters -> 400 (got ${r.status})`);
  r = await jsonPost({ bio: "a\nb\nc\nd\ne" });
  check(r.status === 400, `a bio of 5 paragraphs -> 400 (got ${r.status})`);
  r = await jsonPost({ bio: " \n \n" });
  check(r.status === 400, `an empty bio -> 400 (got ${r.status})`);
  c = await (await get("/content")).json();
  check(c.bio?.custom === true && c.bio.original?.text === orig.text && c.bio.text.startsWith("<script>"), "GET /content returns her saved bio and the original");
  r = await get("/bio", { method: "DELETE", headers: ORIGIN });
  p = await page();
  check(r.status === 200 && p.r.headers.get("x-site-content") === "original" && p.html === staticHtml, "Back to original bio -> the static page byte for byte");

  // Per-IP limit: 30 accepted writes an hour, then 429.
  let n = 0;
  for (; n < 40; n++) {
    r = await get(`/upload?slot=${slot}`, { method: "DELETE", headers: ORIGIN });
    if (r.status === 429) break;
  }
  const before = writes - n - 1;
  check(r.status === 429 && before + n === 30, `the 31st write in an hour gets 429 (${before} guarded writes above + ${n} more before the 429; want 30)`);
} catch (e) {
  check(false, e.message);
} finally {
  dev.kill("SIGTERM");
  await rm(persist, { recursive: true, force: true });
}

if (checks === 0) { console.error("e2e-upload: FAIL, zero checks ran (Rule 0)"); process.exit(1); }
if (failures.length) { console.error(`e2e-upload: FAIL, ${failures.length} of ${checks}`); process.exit(1); }
console.log(`e2e-upload: PASS, ${checks} checks`);
process.exit(0);
