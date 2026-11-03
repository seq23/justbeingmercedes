// GET /pair?t=<pairing token>  shows one button, "Pair this phone" (a GET never pairs, so a link preview
//                              in a text message cannot use the link up).
// POST /pair (form t)          uses the link up and sets the year-long device cookie, then goes to /upload.
// See functions/_lib/device.js.
import { escapeHtml, key } from "./_lib/store.js";
import { deviceCookie, isPairedDevice, mintDevice, openPairing } from "./_lib/device.js";

const page = (status, title, body, extra = {}) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)}</title>` +
      `<style>body{font:18px/1.5 system-ui,-apple-system,sans-serif;max-width:28rem;margin:15vh auto;padding:0 1.25rem;color:#222;background:#fbf8f4}` +
      `h1{font-size:1.4rem;margin:0 0 .5rem}button,a.b{display:inline-block;font:inherit;padding:.8rem 1.4rem;border:0;border-radius:999px;background:#2f4a6d;color:#fff;text-decoration:none;cursor:pointer}</style>` +
      `</head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", ...extra } },
  );

const usedKey = (env, nonce) => key(env, "pairing/used/" + nonce);
const dead = () => page(410, "This link no longer works", "<p>It has already been used or it has expired. Ask Sequoia for a new one.</p>");
const off = () => page(503, "Not ready yet", "<p>Pairing is switched off until the site's DEVICE_SECRET is set.</p>");

async function usable(request, env, token) {
  const p = await openPairing(env.DEVICE_SECRET, token);
  if (!p) return null;
  return (await env.PHOTOS.head(usedKey(env, p.id))) ? null : p;
}

export async function onRequestGet({ request, env }) {
  if (!env.DEVICE_SECRET || !env.PHOTOS) return off();
  if (await isPairedDevice(request, env)) {
    return page(200, "This phone is already set up", '<p><a class="b" href="/upload">Change your page</a></p>');
  }
  const t = new URL(request.url).searchParams.get("t") || "";
  if (!(await usable(request, env, t))) return dead();
  return page(200, "Set up this phone",
    `<p>Tap once and this phone can change your page for a year. The link stops working after that.</p>` +
    `<form method="post" action="/pair"><input type="hidden" name="t" value="${escapeHtml(t)}"><button type="submit">Pair this phone</button></form>`);
}

export async function onRequestPost({ request, env }) {
  if (!env.DEVICE_SECRET || !env.PHOTOS) return off();
  let t = "";
  try { t = String((await request.formData()).get("t") || ""); } catch { /* fall through to dead() */ }
  const p = await usable(request, env, t);
  if (!p) return dead();
  await env.PHOTOS.put(usedKey(env, p.id), "", { customMetadata: { used: new Date().toISOString() } });
  return new Response(null, { status: 303, headers: { Location: "/upload", "Set-Cookie": deviceCookie(await mintDevice(env.DEVICE_SECRET)), "Cache-Control": "no-store" } });
}
