// GET /login?t=<token>  shows one button, "Sign in" (a GET never signs in, so a link preview in a mail
//                       app cannot use the link up).
// POST /login (form t)  uses the link up, sets the session cookie, then goes to /upload.
// The link is emailed by POST /login/email (functions/login/email.js). See functions/_lib/session.js.
import { escapeHtml, key } from "./_lib/store.js";
import { isSignedIn, mintSession, openLogin, sessionCookie } from "./_lib/session.js";

export const page = (status, title, body, extra = {}) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)}</title>` +
      `<style>body{font:18px/1.5 system-ui,-apple-system,sans-serif;max-width:28rem;margin:15vh auto;padding:0 1.25rem;color:#222;background:#fbf8f4}` +
      `h1{font-size:1.4rem;margin:0 0 .5rem}button,a.b{display:inline-block;font:inherit;padding:.8rem 1.4rem;border:0;border-radius:999px;background:#2f4a6d;color:#fff;text-decoration:none;cursor:pointer}</style>` +
      `</head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", ...extra } },
  );

const usedKey = (env, nonce) => key(env, "login/used/" + nonce);
const dead = () => page(410, "This link no longer works", '<p>It has already been used, or it is more than 15 minutes old.</p><p><a class="b" href="/upload">Get a new one</a></p>');
const off = () => page(503, "Not ready yet", "<p>Signing in is switched off until the site's SESSION_SECRET is set.</p>");

async function usable(env, token) {
  const t = await openLogin(env.SESSION_SECRET, token);
  if (!t) return null;
  return (await env.PHOTOS.head(usedKey(env, t.id))) ? null : t;
}

export async function onRequestGet({ request, env }) {
  if (!env.SESSION_SECRET || !env.PHOTOS) return off();
  if (await isSignedIn(request, env)) return page(200, "You are signed in", '<p><a class="b" href="/upload">Change your page</a></p>');
  const t = new URL(request.url).searchParams.get("t") || "";
  if (!(await usable(env, t))) return dead();
  return page(200, "Sign in",
    `<p>Tap once to change your page from this phone. You stay signed in for 90 days.</p>` +
    `<form method="post" action="/login"><input type="hidden" name="t" value="${escapeHtml(t)}"><button type="submit">Sign in</button></form>`);
}

export async function onRequestPost({ request, env }) {
  if (!env.SESSION_SECRET || !env.PHOTOS) return off();
  let t = "";
  try { t = String((await request.formData()).get("t") || ""); } catch { /* falls to dead() */ }
  const link = await usable(env, t);
  if (!link) return dead();
  await env.PHOTOS.put(usedKey(env, link.id), "", { customMetadata: { used: new Date().toISOString() } });
  return new Response(null, { status: 303, headers: { Location: "/upload", "Set-Cookie": sessionCookie(await mintSession(env.SESSION_SECRET)), "Cache-Control": "no-store" } });
}
