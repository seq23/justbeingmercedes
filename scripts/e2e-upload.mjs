// End-to-end test of the /upload backend against `wrangler pages dev` with a throwaway local R2.
// Run: npm test   (CI runs it too). Exits non-zero on the first broken expectation; Rule 0 on zero checks.
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, crc32 } from "node:zlib";
import { SLOTS } from "../functions/_lib/slots.js";

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
const get = (path, init = {}) => fetch(BASE + path, { redirect: "manual", ...init });

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
  check(r.status === 200 && (await r.text()).includes("Change your photos"), "GET /upload serves the upload page");

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

  // Per-IP limit: 30 accepted writes an hour, then 429.
  let n = 0;
  for (; n < 40; n++) {
    r = await get(`/upload?slot=${slot}`, { method: "DELETE", headers: ORIGIN });
    if (r.status === 429) break;
  }
  check(r.status === 429 && n === 25, `the 31st write in an hour gets 429 (5 guarded writes above + ${n} more before the 429; want 25)`);
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
