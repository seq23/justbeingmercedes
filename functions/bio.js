// POST /bio (JSON { bio, tagline }) saves Mercedes' bio and the short line above her name;
// DELETE /bio puts the original (the text in public/index.html) back. Same guard as photo uploads.
// Stored as plain text; functions/index.js escapes it and makes each line a paragraph.
import { guard, json } from "./_lib/guard.js";
import { BIO_MAX, BIO_MAX_PARAGRAPHS, TAGLINE_MAX, bioParagraphs, cleanBio, cleanLine, updateSite } from "./_lib/store.js";

export async function onRequestPost({ request, env }) {
  const blocked = await guard(request, env);
  if (blocked) return blocked;
  let body;
  try { body = await request.json(); } catch { return json(400, { ok: false, error: "Send the bio as JSON: { bio, tagline }." }); }
  const text = cleanBio(body?.bio);
  const tagline = cleanLine(body?.tagline);
  if (!text) return json(400, { ok: false, error: "The bio is empty. Tap Back to original to bring the first bio back." });
  if (text.length > BIO_MAX) return json(400, { ok: false, error: `The bio is ${text.length} characters. Keep it to ${BIO_MAX} so the page still fits on one screen.` });
  if (bioParagraphs(text).length > BIO_MAX_PARAGRAPHS) return json(400, { ok: false, error: `Keep the bio to ${BIO_MAX_PARAGRAPHS} paragraphs or fewer.` });
  if (tagline.length > TAGLINE_MAX) return json(400, { ok: false, error: `The short line is ${tagline.length} characters. Keep it to ${TAGLINE_MAX}.` });
  await updateSite(env, request, (s) => { s.bio = { text, ...(tagline ? { tagline } : {}), updated: Date.now() }; });
  return json(200, { ok: true, bio: text, tagline, message: "Bio saved." });
}

export async function onRequestDelete({ request, env }) {
  const blocked = await guard(request, env);
  if (blocked) return blocked;
  await updateSite(env, request, (s) => { delete s.bio; });
  return json(200, { ok: true, message: "The original bio is back." });
}
