# RUNBOOK — justbeingmercedes

## Update a photo
- **Hero**: replace `photos-src/selfie.png`; adjust `HERO` crop in `scripts/build-images.py` if it carries Instagram UI. If its pixel size changed, update `width`/`height` on both hero `<img>` tags (page and `#photo-hero` lightbox) and `og:image:width/height`.
- **Small photos (5–8)**: add the file under `photos-src/gallery/` and an entry in `photos-src/gallery.json` (`file`, `slug`, `crop` or `null`, `caption`, `alt`). Remove an entry to drop a photo.
- Run `python3 scripts/build-images.py` — writes `public/assets/gallery/<slug>.{webp,jpg}` (full, ≤1440px wide) and `<slug>-thumb.{webp,jpg}`, all under 400 KB, never upscaled, deletes outputs no longer in the manifest, and regenerates the `<!-- gallery:tiles -->` and `<!-- gallery:lightboxes -->` blocks in `public/index.html`. Do not hand-edit those blocks.
- `npm run screenshots`, look at `screenshots/*.png` (including `*-lightbox.png`), then commit and push.

## How the enlarged photos work
CSS only, no JavaScript. Each tile links to `#photo-<slug>`; the matching `.lb` element shows through `:target`. Close by the Close button, a tap on the dark backdrop, or the browser Back button. There is no Escape-key close (that would need a script, and the page ships none; the validator fails on any `<script>`).

## Photo uploads (/upload)
- **How Mercedes uses it**: open https://justbeingmercedes.com/upload on her phone, tap "Choose a photo" on the spot she wants to change, tap Upload. The phone shrinks the photo (max 2000px JPEG) before sending. It is live within ~5 minutes (browser cache `max-age=300`).
- **A photo looks wrong** (sideways, badly cropped, wrong picture): tap "Back to original" on that card. Tiles crop to 4:5 from the upper middle, so a tall full-length photo works best.
- **iPhone HEIC**: Safari reads HEIC and converts it; other browsers cannot, and the page says so (share from Photos, or iPhone Settings › Camera › Formats › Most Compatible).
- **Clear a slot from a terminal**: `npx wrangler r2 object delete justbeingmercedes-photos/photo-3 --remote` (slots: `hero`, `photo-1` … `photo-5`). See what is uploaded: `npx wrangler r2 object get justbeingmercedes-photos/photo-3 --remote --pipe | file -`.
- **How it works**: `functions/photos/[slot].js` serves the R2 object for a slot or 302s to the static fallback; `functions/upload.js` takes `POST /upload` (multipart `slot` + `file` and/or `alt`, `share` for the hero; JPEG/PNG/WebP/HEIC, ≤10 MB) and `DELETE /upload?slot=`; `functions/bio.js` takes `POST /bio` (JSON `bio`, `tagline`) and `DELETE /bio`; `functions/content.js` (`GET /content`) feeds the upload page. Guards: same-origin `Origin` header and 30 writes/hour per hashed IP (counter objects under `ratelimit/` in the same bucket; shared by photo, description and bio saves, in `functions/_lib/guard.js`). The R2 binding `PHOTOS` is declared in `wrangler.toml`, which `wrangler pages deploy` applies.
- **Slots come from one place**: `scripts/build-images.py` generates `functions/_lib/slots.js` and the upload cards from `photos-src/gallery.json`. Adding a gallery photo adds its slot.
- **Descriptions (alt text)**: optional per upload, stored in `site.json` (`slots.<slot>.alt`). The main page shows her description, "Photo of Mercedes" for a replaced photo she did not describe, or the original alt while the original photo is up; a replaced photo's lightbox drops its original caption.
- **How the main page gets her changes**: `functions/index.js` serves `public/index.html` through HTMLRewriter: bio, short line, alt texts, `?v=<upload time>` on replaced photo srcs, and og:image/-width/-height/-alt. One R2 read of `site.json`, cached 30 s per Cloudflare location and purged on every save. If R2 errors, hangs over 1.5 s or `site.json` is corrupt, the static page is served unchanged (response header `X-Site-Content: fallback`; `original` = nothing changed; `custom` = her changes applied). The page still ships no `<script>`; her bio is wrapped in `<!--email_off-->` so an address she types is not obfuscated into a script.
- **Link preview**: uploading the big photo also sends a 1200px JPEG made on the phone; it is stored as `og-hero` and served at `/og-image.jpg` (5-minute cache); the page links it as `/og-image.jpg?v=<upload time>` with its real width/height, so link unfurlers see a new URL for each new photo. A non-JPEG hero sent without that copy points og:image at `/photos/hero` with no size.
- **See or clear her edits from a terminal**: `npx wrangler r2 object get justbeingmercedes-photos/site.json --remote --pipe`; delete it to put every bio and description back (`… object delete … --remote`).
- **Previews never touch the live site**: `wrangler.toml` `[env.preview]` sets `STORE_PREFIX = "preview/"` with the same bucket, so a branch preview (`npx wrangler pages deploy public --project-name justbeingmercedes --branch <branch>`) reads and writes `preview/hero`, `preview/site.json` … . Clean up after testing by deleting the `preview/` keys you wrote.
- **Tests**: `npm run validate` (page + wiring) and `npm test` (`scripts/e2e-upload.mjs`: `wrangler pages dev` with a throwaway local R2 — fallback 302, 403 without Origin, 415/413/400 rejects, upload round-trip byte for byte, DELETE back to fallback, descriptions → alt/fallback/original, og:image following the hero, tricky bio escaped into paragraphs and back to the static page byte for byte, 429 on the 31st write). Both run in CI.

## Update the bio
- **Mercedes edits it herself** at /upload ("Your bio" card). Her saved bio is `bio.text` (and `bio.tagline`, the short line above her name) in R2 `site.json`; it wins over the file. "Back to original" deletes it.
- **The original** is `<div class="bio"><p>…</p></div>` and `<p class="eyebrow">` in `public/index.html`. 60–120 words, sourced facts only (Instagram @merc.asare, TikTok @mercasare, LinkedIn /in/mercasare, linktr.ee/merc.asare). Run `npm run validate`.
- **Limits** live in `functions/_lib/store.js` (`BIO_MAX` 550 characters, `BIO_MAX_PARAGRAPHS` 4, `TAGLINE_MAX` 40, `ALT_MAX` 300). The validator renders the longest bio the server accepts at every viewport and fails if the page stops fitting one screen, and fails if the upload page's `maxlength`s differ from these.

## Update the email
Change the `mailto:` href and the visible `.addr` text in `public/index.html`, and `EMAIL` in `scripts/validate.mjs`. The address is the one on her TikTok and Linktree bios. Keep it inside the `<!--email_off-->` … `<!--/email_off-->` comments and nowhere else on the page: the zone has Cloudflare email obfuscation on, which otherwise rewrites the mailto into a `/cdn-cgi/` link plus a script (the validator fails if you forget).

## Deploy (build first, test in batches — 26 Sep 2026)
- **Merge gate** = `.github/workflows/validate.yml` on every PR and push to `main`: `npm run validate:static` (no browser), `npm run validate:workflows`, `npm test`. `~/bin/land <pr>` merges on green.
- **Staging**: every push to `main` → **Deploy** publishes `public/` as the `staging` preview, https://staging.justbeingmercedes.pages.dev (preview env, `STORE_PREFIX=preview/`, never her real uploads).
- **Production** (justbeingmercedes.com): `.github/workflows/e2e.yml` runs the browser checks (`npm run screenshots`) on dispatch only — a person or `land` after a large change, never on a schedule (owner, 2 Oct 2026); on success **Deploy** publishes exactly that sha with `--branch main`. By hand: `gh workflow run e2e.yml --ref main` (green → Deploy fires), or `gh workflow run deploy.yml -f sha=<sha>` for a sha that already has a green e2e run (refused otherwise).
- A red e2e run leaves production where it is; fix `main` first. Break-glass: `npm run deploy` (wrangler logged in to account 8d147e242033699dd37c6f5a451f48d2).
- Token: repo secret `CLOUDFLARE_API_TOKEN` is the vault credential `cloudflare-claude-deploy`; `CLOUDFLARE_ACCOUNT_ID` is the account id above. If Deploy fails with an auth error, re-set the secret from the vault (value never printed) or deploy by hand.

## Check the deploy
- `gh run list -R seq23/justbeingmercedes --branch main` — Validate and Deploy (staging) green on the merge; e2e and Deploy (production) green after the last dispatched e2e run.
- `curl -sI https://justbeingmercedes.com` → `200`; `curl -s https://justbeingmercedes.com | grep -c "Just Being Mercedes"` → non-zero.
- `https://www.justbeingmercedes.com` serves the same page (both are custom domains on the Pages project; DNS CNAMEs → `justbeingmercedes.pages.dev`, proxied).
