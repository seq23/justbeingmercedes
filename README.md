# Just Being Mercedes

The one-page site for Mercedes Asare at **https://justbeingmercedes.com**.
One screen, a big photo, her name, a short bio, a row of small photos that open larger when tapped, her collab email and links to Instagram, TikTok and Linktree.

## How it goes live
- The site is the `public/` folder: `index.html`, `styles.css`, `assets/` (photos), favicons.
- It is hosted on Cloudflare Pages, project `justbeingmercedes`.
- Every push to `main` runs two GitHub Actions: **Validate** (checks the page) and **Deploy** (publishes `public/`).
- To publish by hand from a Mac with wrangler logged in: `npm run deploy`.

## Mercedes can change her bio and photos herself
Go to **https://justbeingmercedes.com/upload**. No password: **anyone with that link can make these changes, by the owner's choice** (25 Sep 2026). It only accepts changes sent from that page, and at most 30 changes an hour from one connection.
- **Your bio** (top card): the current bio and the short line above her name, a live character count (550 characters, up to 4 paragraphs, so the page still fits one screen), Save, and "Back to original". Plain text only: every new line becomes a paragraph; anything that looks like code is shown as typed.
- **Photos** (one card per photo): choose a photo, optionally describe it ("What's in this photo? It helps people using screen readers"), tap Upload. The description becomes the photo's alt text; a replaced photo with no description is read out as "Photo of Mercedes". A description can be changed later without re-uploading. "Back to original" puts back the first photo and its original description.
- **Link previews**: when she changes the big photo, the preview shown when someone shares the site link (og:image) switches to it too.

Changes show within a minute or two. Uploaded photos live in the Cloudflare R2 bucket `justbeingmercedes-photos` (one file per spot: `hero`, `photo-1` … `photo-5`, plus `og-hero` for the link preview); her bio and descriptions are in `site.json` in the same bucket. The page asks `/photos/<spot>` for each picture: an upload wins, otherwise it falls back to the original in `public/assets/`.

## Changing things (plain English)
- **The bio**: Mercedes can change it at /upload (that wins over the file). The original is in `public/index.html` inside `<div class="bio">`, one `<p>` per paragraph; change the words between the tags. Keep it to about 60 to 120 words so it still fits one screen. Only write things Mercedes has said publicly.
- **The big photo**: replace `photos-src/selfie.png`, then run `python3 scripts/build-images.py`.
- **The small photos**: put the picture in `photos-src/gallery/`, then add an entry to `photos-src/gallery.json` with a short caption and a one-sentence description of the outfit and setting (that becomes the alt text for screen readers). Order in that file is order on the page. Run `python3 scripts/build-images.py`: it crops off Instagram buttons (the `crop` box, or `null` for none), makes a small tile and a full-size copy, keeps each under 400 KB, and rewrites the photo row and its enlarged views in `index.html`. Keep 5 to 8 small photos.
- **The email**: in `public/index.html`, change both the `mailto:` address and the address shown under "Collabs". Then change `EMAIL` at the top of `scripts/validate.mjs` to match.
- **Social links**: change them in `public/index.html` and in `SOCIALS` at the top of `scripts/validate.mjs`.

After any change run `npm install` once, then `npm run validate`. It fails if the page stops fitting one screen, loses a link, an image gets too big, an image has no description, there are fewer than 5 or more than 8 small photos, or a small photo does not open its full-size version.

## Deploy token
Push-to-deploy uses the repo secrets `CLOUDFLARE_API_TOKEN` (Cloudflare Pages: Edit) and `CLOUDFLARE_ACCOUNT_ID`. The token comes from the Mac's credential vault (`cloudflare-claude-deploy`). If the Deploy workflow ever fails on a missing or dead token, deploy with `npm run deploy` and replace the secret.
