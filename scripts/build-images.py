"""Build every photo the site ships, and write the gallery markup into public/index.html.

Run: python3 scripts/build-images.py   (needs Pillow)

- Hero: photos-src/selfie.png -> public/assets/selfie.{webp,jpg}
- Gallery: one entry per photo in photos-src/gallery.json, in page order:
    {"file": "gallery/<name>.png|jpg", "slug": "<short-id>", "crop": [l, t, r, b] or null,
     "caption": "<2-4 words>", "alt": "<what she is wearing and where>"}
  Each becomes public/assets/gallery/<slug>.{webp,jpg} (full size, for the enlarged view) and
  <slug>-thumb.{webp,jpg} (the small tile). "crop" removes Instagram UI only (dots, arrows,
  borders); null keeps the whole frame.
- Every file is kept under 400 KB (quality steps down, then size) and never upscaled.
- The <!-- gallery:tiles --> and <!-- gallery:lightboxes --> blocks in public/index.html are
  regenerated from gallery.json, so adding a photo is: drop the file, add an entry, run this.
"""
import html
import json
import re
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "photos-src"
OUT = ROOT / "public" / "assets"
GALLERY_OUT = OUT / "gallery"
INDEX = ROOT / "public" / "index.html"
MAX_BYTES = 390 * 1024  # validator cap is 400 KB; keep a margin
FULL_MAX_W = 1440
THUMB_W = 360

HERO = ("selfie.png", (8, 10, 1085, 1390), 1077)  # right edge carried Instagram's ">" arrow


def load(path, crop):
    im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    return im.crop(tuple(crop)) if crop else im


def save_pair(im, stem, max_w):
    """Write stem.webp and stem.jpg no wider than max_w (never upscaled), each under MAX_BYTES."""
    w = min(max_w, im.width)
    while True:
        cur = im if w == im.width else im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
        ok = True
        for ext, kw in (("webp", {"method": 6}), ("jpg", {"optimize": True, "progressive": True})):
            fmt = "WEBP" if ext == "webp" else "JPEG"
            for q in (82, 76, 70, 64):
                cur.save(f"{stem}.{ext}", fmt, quality=q, **kw)
                if Path(f"{stem}.{ext}").stat().st_size <= MAX_BYTES:
                    break
            else:
                ok = False
        if ok:
            return cur.size
        w = int(w * 0.85)


def tile(p, size):
    s, a = p["slug"], html.escape(p["alt"], quote=True)
    return (
        f'        <li><a class="tile" href="#photo-{s}">\n'
        f'          <picture><source srcset="/assets/gallery/{s}-thumb.webp" type="image/webp">'
        f'<img src="/assets/gallery/{s}-thumb.jpg" width="{size[0]}" height="{size[1]}" loading="lazy" alt="{a}"></picture></a></li>'
    )


def lightbox(p, size):
    s, a, c = p["slug"], html.escape(p["alt"], quote=True), html.escape(p["caption"])
    return (
        f'  <div class="lb" id="photo-{s}" role="dialog" aria-modal="true" aria-label="{c}">\n'
        f'    <a class="lb-backdrop" href="#gallery" tabindex="-1" aria-hidden="true"></a>\n'
        f'    <figure class="lb-frame">\n'
        f'      <picture><source srcset="/assets/gallery/{s}.webp" type="image/webp">'
        f'<img class="lb-full" src="/assets/gallery/{s}.jpg" width="{size[0]}" height="{size[1]}" loading="lazy" alt="{a}"></picture>\n'
        f'      <figcaption>{c}</figcaption>\n'
        f'    </figure>\n'
        f'    <a class="lb-close" href="#gallery" aria-label="Close photo">Close <span aria-hidden="true">&times;</span></a>\n'
        f'  </div>'
    )


def replace_block(text, name, body):
    pat = re.compile(rf"(<!-- gallery:{name} -->).*?(\n[ \t]*<!-- /gallery:{name} -->)", re.S)
    if not pat.search(text):
        raise SystemExit(f"public/index.html is missing the <!-- gallery:{name} --> block")
    return pat.sub(lambda m: m.group(1) + "\n" + body + m.group(2), text)


def main():
    GALLERY_OUT.mkdir(parents=True, exist_ok=True)
    name, crop, max_w = HERO
    print("hero", save_pair(load(SRC / name, crop), OUT / "selfie", max_w))

    photos = json.loads((SRC / "gallery.json").read_text())
    slugs = [p["slug"] for p in photos]
    if len(set(slugs)) != len(slugs):
        raise SystemExit("gallery.json has duplicate slugs")
    tiles, boxes, keep = [], [], set()
    for p in photos:
        im = load(SRC / p["file"], p.get("crop"))
        full = save_pair(im, GALLERY_OUT / p["slug"], FULL_MAX_W)
        thumb = save_pair(im, GALLERY_OUT / f'{p["slug"]}-thumb', THUMB_W)
        keep |= {f'{p["slug"]}{t}.{e}' for t in ("", "-thumb") for e in ("webp", "jpg")}
        tiles.append(tile(p, thumb))
        boxes.append(lightbox(p, full))
        print(p["slug"], "full", full, "thumb", thumb)
    for f in GALLERY_OUT.iterdir():  # drop outputs for photos no longer in the manifest
        if f.name not in keep:
            f.unlink()
            print("removed stale", f.name)

    text = INDEX.read_text()
    text = replace_block(text, "tiles", "\n".join(tiles))
    text = replace_block(text, "lightboxes", "\n".join(boxes))
    INDEX.write_text(text)
    print(f"index.html: {len(photos)} gallery photos")


if __name__ == "__main__":
    main()
