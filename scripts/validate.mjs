// Validator for justbeingmercedes.com. Reads the real page in a real browser and fails loudly.
// Run: npm run validate            (add --screenshots to also write screenshots/*.png)
// Rule 0: it refuses to pass if it checked nothing (no images found, zero checks run).
import { createServer } from "node:http";
import { readFile, readdir, stat, mkdir } from "node:fs/promises";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");
const EMAIL = "mercasare.social@gmail.com";
const SOCIALS = {
  Instagram: "https://www.instagram.com/merc.asare",
  TikTok: "https://www.tiktok.com/@mercasare",
  Linktree: "https://linktr.ee/merc.asare",
};
const MAX_IMAGE_BYTES = 400 * 1024;
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
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = join(PUBLIC, path.endsWith("/") ? path + "index.html" : path);
  if (!file.startsWith(PUBLIC)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" }).end(body);
  } catch { res.writeHead(404).end("not found"); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;

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
          scripts: [...document.querySelectorAll("script[src]")].map((s) => s.src),
        };
      });
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
      check(d.scripts.length === 0, `third-party or inline scripts are not allowed: ${d.scripts.join(", ")}`);
    }
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

if (checks === 0) { console.error("validate: FAIL, zero checks ran (Rule 0)"); process.exit(1); }
if (failures.length) {
  console.error(`validate: FAIL, ${failures.length} of ${checks} checks failed`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`validate: PASS, ${checks} checks (${images.length} image files, ${VIEWPORTS.length} viewports)`);
