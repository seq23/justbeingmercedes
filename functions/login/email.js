// POST /login/email: emails a one-time login link to the site owner. The request body is ignored: the
// only recipient there can ever be is the OWNER_EMAIL Pages secret, so this cannot mail anyone else.
// Same-site only; LINKS_PER_HOUR / LINKS_PER_DAY for the whole site. Sends through Resend from her own
// verified domain (EMAIL_FROM in wrangler.toml; RESEND_API_KEY Pages secret).
import { bump, json } from "../_lib/guard.js";
import { LINK_MINUTES, maskEmail, mintLogin } from "../_lib/session.js";

export const LINKS_PER_HOUR = 5;
export const LINKS_PER_DAY = 20;
const RESEND = "https://api.resend.com/emails";

export async function onRequestPost({ request, env }) {
  const site = new URL(request.url).origin;
  if (request.headers.get("Origin") !== site) return json(403, { ok: false, error: "Ask for a login link from the upload page on this site." });
  // NAMED STOP: any of these missing means no link can be sent (fail closed, nothing sent).
  const missing = ["PHOTOS", "SESSION_SECRET", "OWNER_EMAIL", "RESEND_API_KEY", "EMAIL_FROM"].filter((k) => !env[k]);
  if (missing.length) return json(503, { ok: false, error: `Login links are switched off until the site's ${missing.join(", ")} is set.` });
  const now = Date.now();
  if (await bump(env, "login-hour", "h" + Math.floor(now / 3_600_000), LINKS_PER_HOUR)) {
    return json(429, { ok: false, limit: "hour", error: `That is ${LINKS_PER_HOUR} login links in an hour. Use the newest one in your email, or try again later.` });
  }
  if (await bump(env, "login-day", "d" + new Date(now).toISOString().slice(0, 10), LINKS_PER_DAY)) {
    return json(429, { ok: false, limit: "day", error: `That is ${LINKS_PER_DAY} login links today. Try again tomorrow.` });
  }
  const link = `${site}/login?t=${await mintLogin(env.SESSION_SECRET, now)}`;
  const r = await fetch(env.RESEND_API_URL || RESEND, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [env.OWNER_EMAIL],
      subject: "Your login link for justbeingmercedes.com",
      text: `Tap this link, then tap Sign in, to change your page:\n\n${link}\n\nIt works once and only for the next ${LINK_MINUTES} minutes. If you did not ask for it, ignore this email.`,
      html: `<p>Tap the button, then tap Sign in, to change your page.</p><p><a href="${link}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#2f4a6d;color:#fff;text-decoration:none">Sign in to change your page</a></p><p>It works once and only for the next ${LINK_MINUTES} minutes. If you did not ask for it, ignore this email.</p>`,
    }),
  }).catch(() => null);
  if (!r || !r.ok) return json(502, { ok: false, error: "The email did not go out. Try again in a minute." });
  return json(200, { ok: true, sent: true, message: `Sent to ${maskEmail(env.OWNER_EMAIL)}. Open the email on this phone within ${LINK_MINUTES} minutes.` });
}
