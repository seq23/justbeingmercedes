// Emailed one-time login (owner ruling 3 Nov 2026, replacing phone pairing). No password: on /upload
// Mercedes taps "Email me a login link"; the server emails a one-time link to OWNER_EMAIL (a Pages
// secret, never in the repo, never taken from the request); tapping it and then "Sign in" sets a signed
// HttpOnly session cookie for SESSION_DAYS. Every write (functions/_lib/guard.js) checks that cookie.
//
// Both tokens are HMAC-SHA256 over a fixed shape, keyed by the SESSION_SECRET Pages secret:
//   login link     /login?t=l1.<nonce>.<expires>.<sig>   (15 min; POST /login records the nonce in R2)
//   session cookie jbm_session=s1.<id>.<expires>.<sig>
// Rotating SESSION_SECRET signs every browser out and kills every unused link.

export const COOKIE = "jbm_session";
export const SESSION_DAYS = 90;
export const LINK_MINUTES = 15;

const enc = new TextEncoder();
const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const randomId = () => b64u(crypto.getRandomValues(new Uint8Array(18)));
const hmacKey = (secret) => crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

async function sign(secret, kind, id, exp) {
  return `${kind}.${id}.${exp}.${b64u(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(`${kind}|${id}|${exp}`)))}`;
}

// { id, exp } for a well-formed, correctly signed, unexpired token of this kind, else null.
async function open(secret, kind, token, now) {
  const parts = String(token || "").split(".");
  if (parts.length !== 4 || parts[0] !== kind || !/^[\w-]{10,64}$/.test(parts[1]) || !/^\d{1,15}$/.test(parts[2])) return null;
  const [, id, expStr, sig] = parts;
  let sigBytes;
  try { sigBytes = unb64u(sig); } catch { return null; }
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), sigBytes, enc.encode(`${kind}|${id}|${expStr}`)); // constant time
  const exp = Number(expStr);
  return ok && exp > now ? { id, exp } : null;
}

export const mintLogin = (secret, now = Date.now()) => sign(secret, "l1", randomId(), now + LINK_MINUTES * 60_000);
export const openLogin = (secret, token, now = Date.now()) => open(secret, "l1", token, now);
export const mintSession = (secret, now = Date.now()) => sign(secret, "s1", randomId(), now + SESSION_DAYS * 86_400_000);

export function cookieValue(request) {
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim();
  }
  return "";
}
export const isSignedIn = async (request, env, now = Date.now()) =>
  !!env.SESSION_SECRET && !!(await open(env.SESSION_SECRET, "s1", cookieValue(request), now));

export const sessionCookie = (value) => `${COOKIE}=${value}; Max-Age=${SESSION_DAYS * 86_400}; Path=/; HttpOnly; Secure; SameSite=Lax`;

// "mercedes@example.com" -> "m•••@example.com", for the "sent" message.
export const maskEmail = (e) => String(e).replace(/^(.)[^@]*/, "$1•••");
