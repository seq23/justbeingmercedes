# RUNBOOK — justbeingmercedes

## Update a photo
1. Save the new image into `photos-src/` as `selfie.png` (hero), `lawn.png` or `street.png` (small ones).
2. Adjust its crop box in `scripts/build-images.py` if it carries Instagram UI (dots, arrows), else use the full frame.
3. `python3 scripts/build-images.py` — writes WebP + JPEG to `public/assets/`, never upscales.
4. If the hero's pixel size changed, update `width`/`height` on its `<img>` and `og:image:width/height` in `public/index.html`.
5. `npm run screenshots`, look at `screenshots/*.png`, then commit and push.

## Update the bio
Edit `<p class="bio">` in `public/index.html`. 60–120 words, sourced facts only (Instagram @merc.asare, TikTok @mercasare, LinkedIn /in/mercasare, linktr.ee/merc.asare). Run `npm run validate`; a longer bio can break the one-screen rule and the validator will say so.

## Update the email
Change the `mailto:` href and the visible `.addr` text in `public/index.html`, and `EMAIL` in `scripts/validate.mjs`. The address is the one on her TikTok and Linktree bios.

## Deploy
- Push to `main` → **Deploy** workflow publishes `public/` to Pages project `justbeingmercedes`.
- By hand: `npm run deploy` (wrangler must be logged in to account 8d147e242033699dd37c6f5a451f48d2).
- Token: repo secret `CLOUDFLARE_API_TOKEN` is the vault credential `cloudflare-claude-deploy`; `CLOUDFLARE_ACCOUNT_ID` is the account id above. If Deploy fails with an auth error, re-set the secret from the vault (value never printed) or deploy by hand.

## Check the deploy
- `gh run list -R seq23/justbeingmercedes --branch main` — Validate and Deploy both green.
- `curl -sI https://justbeingmercedes.com` → `200`; `curl -s https://justbeingmercedes.com | grep -c "Just Being Mercedes"` → non-zero.
- `https://www.justbeingmercedes.com` serves the same page (both are custom domains on the Pages project; DNS CNAMEs → `justbeingmercedes.pages.dev`, proxied).
