// Device pairing (3 Nov 2026). The owner chose no password (25 Sep 2026), so a write needs a paired
// device instead: she opens a one-time pairing link once on her phone, taps "Pair this phone", and the
// server sets a signed HttpOnly cookie that lasts a year. Every write (functions/_lib/guard.js) checks it.
//
// Both tokens are HMAC-SHA256 over a fixed shape, keyed by the DEVICE_SECRET platform secret:
//   pairing link  /pair?t=p1.<nonce>.<expires>.<sig>   (one use: POST /pair records the nonce in R2)
//   device cookie jbm_device=d1.<device id>.<expires>.<sig>
// Rotating DEVICE_SECRET signs every device out and kills every unused link.
// New pairing link: `npm run pairing-url` (scripts/pairing-url.mjs, needs DEVICE_SECRET in the env).

export const COOKIE = "jbm_device";
export const DEVICE_DAYS = 365;
export const PAIRING_DAYS = 30;
const DAY = 86_400_000;

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

// Returns { id, exp } for a well-formed, correctly signed, unexpired token of this kind, else null.
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

export const mintPairing = (secret, now = Date.now()) => sign(secret, "p1", randomId(), now + PAIRING_DAYS * DAY);
export const openPairing = (secret, token, now = Date.now()) => open(secret, "p1", token, now);
export const mintDevice = (secret, now = Date.now()) => sign(secret, "d1", randomId(), now + DEVICE_DAYS * DAY);

export function cookieValue(request) {
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim();
  }
  return "";
}
export const isPairedDevice = async (request, env, now = Date.now()) =>
  !!env.DEVICE_SECRET && !!(await open(env.DEVICE_SECRET, "d1", cookieValue(request), now));

export const deviceCookie = (value) => `${COOKIE}=${value}; Max-Age=${DEVICE_DAYS * 86_400}; Path=/; HttpOnly; Secure; SameSite=Strict`;
