# RUNBOOK — justbeingmercedes

## Update a photo
- **Hero**: replace `photos-src/selfie.png`; adjust `HERO` crop in `scripts/build-images.py` if it carries Instagram UI. If its pixel size changed, update `width`/`height` on both hero `<img>` tags (page and `#photo-hero` lightbox) and `og:image:width/height`.
- **Small photos (5–8)**: add the file under `photos-src/gallery/` and an entry in `photos-src/gallery.json` (`file`, `slug`, `crop` or `null`, `caption`, `alt`). Remove an entry to drop a photo.
- Run `python3 scripts/build-images.py` — writes `public/assets/gallery/<slug>.{webp,jpg}` (full, ≤1440px wide) and `<slug>-thumb.{webp,jpg}`, all under 400 KB, never upscaled, deletes outputs no longer in the manifest, and regenerates the `<!-- gallery:tiles -->` and `<!-- gallery:lightboxes -->` blocks in `public/index.html`. Do not hand-edit those blocks.
- `npm run screenshots`, look at `screenshots/*.png` (including `*-lightbox.png`), then commit and push.

## How the enlarged photos work
CSS only, no JavaScript. Each tile links to `#photo-<slug>`; the matching `.lb` element shows through `:target`. Close by the Close button, a tap on the dark backdrop, or the browser Back button. There is no Escape-key close (that would need a script, and the page ships none; the validator fails on any `<script>`).

## Update the bio
Edit `<p class="bio">` in `public/index.html`. 60–120 words, sourced facts only (Instagram @merc.asare, TikTok @mercasare, LinkedIn /in/mercasare, linktr.ee/merc.asare). Run `npm run validate`; a longer bio can break the one-screen rule and the validator will say so.

## Update the email
Change the `mailto:` href and the visible `.addr` text in `public/index.html`, and `EMAIL` in `scripts/validate.mjs`. The address is the one on her TikTok and Linktree bios. Keep it inside the `<!--email_off-->` … `<!--/email_off-->` comments and nowhere else on the page: the zone has Cloudflare email obfuscation on, which otherwise rewrites the mailto into a `/cdn-cgi/` link plus a script (the validator fails if you forget).

## Deploy
- Push to `main` → **Deploy** workflow publishes `public/` to Pages project `justbeingmercedes`.
- By hand: `npm run deploy` (wrangler must be logged in to account 8d147e242033699dd37c6f5a451f48d2).
- Token: repo secret `CLOUDFLARE_API_TOKEN` is the vault credential `cloudflare-claude-deploy`; `CLOUDFLARE_ACCOUNT_ID` is the account id above. If Deploy fails with an auth error, re-set the secret from the vault (value never printed) or deploy by hand.

## Check the deploy
- `gh run list -R seq23/justbeingmercedes --branch main` — Validate and Deploy both green.
- `curl -sI https://justbeingmercedes.com` → `200`; `curl -s https://justbeingmercedes.com | grep -c "Just Being Mercedes"` → non-zero.
- `https://www.justbeingmercedes.com` serves the same page (both are custom domains on the Pages project; DNS CNAMEs → `justbeingmercedes.pages.dev`, proxied).
