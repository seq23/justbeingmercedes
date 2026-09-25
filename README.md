# Just Being Mercedes

The one-page site for Mercedes Asare at **https://justbeingmercedes.com**.
One screen, a big photo, her name, a short bio, her collab email and links to Instagram, TikTok and Linktree.

## How it goes live
- The site is the `public/` folder: `index.html`, `styles.css`, `assets/` (photos), favicons.
- It is hosted on Cloudflare Pages, project `justbeingmercedes`.
- Every push to `main` runs two GitHub Actions: **Validate** (checks the page) and **Deploy** (publishes `public/`).
- To publish by hand from a Mac with wrangler logged in: `npm run deploy`.

## Changing things (plain English)
- **The bio**: open `public/index.html`, find the paragraph that starts `<p class="bio">`, change the words between the tags. Keep it to about 60 to 120 words so it still fits one screen. Only write things Mercedes has said publicly.
- **A photo**: put the new picture in `photos-src/` with the same name (`selfie.png` is the big one, `lawn.png` and `street.png` are the two small ones), then run `python3 scripts/build-images.py`. It crops, shrinks and writes the web versions into `public/assets/`. If the new photo has no Instagram buttons on it, set its crop box in that script to the full image.
- **The email**: in `public/index.html`, change both the `mailto:` address and the address shown under "Collabs". Then change `EMAIL` at the top of `scripts/validate.mjs` to match.
- **Social links**: change them in `public/index.html` and in `SOCIALS` at the top of `scripts/validate.mjs`.

After any change run `npm install` once, then `npm run validate`. It fails if the page stops fitting one screen, loses a link, an image gets too big, or an image has no description.

## Deploy token
Push-to-deploy uses the repo secrets `CLOUDFLARE_API_TOKEN` (Cloudflare Pages: Edit) and `CLOUDFLARE_ACCOUNT_ID`. The token comes from the Mac's credential vault (`cloudflare-claude-deploy`). If the Deploy workflow ever fails on a missing or dead token, deploy with `npm run deploy` and replace the secret.
