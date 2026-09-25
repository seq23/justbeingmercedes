"""Build every photo the site ships, and write the gallery markup into public/index.html.

Run: python3 scripts/build-images.py   (needs Pillow)

- Hero: photos-src/selfie.png -> public/assets/selfie.{webp,jpg}
- Gallery: one entry per photo in photos-src/gallery.json, in page order:
    {"slot": "photo-<n>", "file": "gallery/<name>.png|jpg", "slug": "<short-id>", "crop": [l, t, r, b] or null,
     "caption": "<2-4 words>", "alt": "<what she is wearing and where>"}
  Each becomes public/assets/gallery/<slug>.{webp,jpg} (full size, for the enlarged view) and
  <slug>-thumb.{webp,jpg} (the small tile). "crop" removes Instagram UI only (dots, arrows,
  borders); null keeps the whole frame.
- Every file is kept under 400 KB (quality steps down, then size) and never upscaled.
- The <!-- gallery:tiles --> and <!-- gallery:lightboxes --> blocks in public/index.html and the
  <!-- gallery:upload --> block in public/upload.html are regenerated from gallery.json, so adding a
  photo is: drop the file, add an entry, run this.
- functions/_lib/slots.js (the upload slots and their static fallbacks, read by the Pages Functions
  and by the validator) is generated here too, so there is one list of slots, not three.
- The page never points at /assets/ for these photos: it asks /photos/<slot>, which serves an
  uploaded replacement from R2 if Mercedes has made one, else redirects to the static file.
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
UPLOAD = ROOT / "public" / "upload.html"
SLOTS_JS = ROOT / "functions" / "_lib" / "slots.js"
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
    s, a, slot = p["slug"], html.escape(p["alt"], quote=True), p["slot"]
    return (
        f'        <li><a class="tile" href="#photo-{s}">'
        f'<img src="/photos/{slot}?size=thumb" width="{size[0]}" height="{size[1]}" loading="lazy" alt="{a}"></a></li>'
    )


def lightbox(p, size):
    s, a, c = p["slug"], html.escape(p["alt"], quote=True), html.escape(p["caption"])
    return (
        f'  <div class="lb" id="photo-{s}" role="dialog" aria-modal="true" aria-label="{c}">\n'
        f'    <a class="lb-backdrop" href="#gallery" tabindex="-1" aria-hidden="true"></a>\n'
        f'    <figure class="lb-frame">\n'
        f'      <img class="lb-full" src="/photos/{p["slot"]}" width="{size[0]}" height="{size[1]}" loading="lazy" alt="{a}">\n'
        f'      <figcaption>{c}</figcaption>\n'
        f'    </figure>\n'
        f'    <a class="lb-close" href="#gallery" aria-label="Close photo">Close <span aria-hidden="true">&times;</span></a>\n'
        f'  </div>'
    )


def upload_card(slot, label, caption):
    c = html.escape(caption)
    return (
        f'    <li class="card" data-slot="{slot}">\n'
        f'      <img src="/photos/{slot}?size=thumb" alt="Current {html.escape(label.lower())}: {c}" width="360" height="450">\n'
        f'      <div class="card-body">\n'
        f'        <h2>{html.escape(label)}</h2>\n'
        f'        <p class="caption">{c}</p>\n'
        f'        <label class="pick">Choose a photo<input type="file" name="file" accept="image/jpeg,image/png,image/webp,image/heic,.heic"></label>\n'
        f'        <div class="actions"><button type="button" class="upload" disabled>Upload</button>'
        f'<button type="button" class="reset">Back to original</button></div>\n'
        f'        <p class="status" role="status" aria-live="polite"></p>\n'
        f'      </div>\n'
        f'    </li>'
    )


def write_slots(slots):
    body = ",\n".join(
        f'  {json.dumps(k)}: {{ label: {json.dumps(v["label"])}, full: {json.dumps(v["full"])}, thumb: {json.dumps(v["thumb"])} }}'
        for k, v in slots.items()
    )
    SLOTS_JS.parent.mkdir(parents=True, exist_ok=True)
    SLOTS_JS.write_text(
        "// GENERATED by scripts/build-images.py from photos-src/gallery.json. Do not edit by hand.\n"
        "// Each slot is a photo Mercedes can replace at /upload; full/thumb are the static fallbacks.\n"
        f"export const SLOTS = {{\n{body},\n}};\n"
    )


def replace_block(text, name, body, where="public/index.html"):
    pat = re.compile(rf"(<!-- gallery:{name} -->).*?(\n[ \t]*<!-- /gallery:{name} -->)", re.S)
    if not pat.search(text):
        raise SystemExit(f"{where} is missing the <!-- gallery:{name} --> block")
    return pat.sub(lambda m: m.group(1) + "\n" + body + m.group(2), text)


def main():
    GALLERY_OUT.mkdir(parents=True, exist_ok=True)
    name, crop, max_w = HERO
    print("hero", save_pair(load(SRC / name, crop), OUT / "selfie", max_w))

    photos = json.loads((SRC / "gallery.json").read_text())
    slugs = [p["slug"] for p in photos]
    if len(set(slugs)) != len(slugs):
        raise SystemExit("gallery.json has duplicate slugs")
    slot_ids = [p.get("slot") for p in photos]
    if any(not re.fullmatch(r"photo-[1-9]", s or "") for s in slot_ids) or len(set(slot_ids)) != len(slot_ids):
        raise SystemExit("every gallery.json entry needs a unique slot photo-1 .. photo-9")
    slots = {"hero": {"label": "Big photo", "caption": "The large photo beside your name",
                      "full": "/assets/selfie.webp", "thumb": "/assets/selfie.webp"}}
    tiles, boxes, keep = [], [], set()
    for p in photos:
        im = load(SRC / p["file"], p.get("crop"))
        full = save_pair(im, GALLERY_OUT / p["slug"], FULL_MAX_W)
        thumb = save_pair(im, GALLERY_OUT / f'{p["slug"]}-thumb', THUMB_W)
        keep |= {f'{p["slug"]}{t}.{e}' for t in ("", "-thumb") for e in ("webp", "jpg")}
        tiles.append(tile(p, thumb))
        boxes.append(lightbox(p, full))
        slots[p["slot"]] = {"label": f'Small photo {p["slot"].split("-")[1]}', "caption": p["caption"],
                            "full": f'/assets/gallery/{p["slug"]}.webp', "thumb": f'/assets/gallery/{p["slug"]}-thumb.webp'}
        print(p["slug"], "full", full, "thumb", thumb)
    for f in GALLERY_OUT.iterdir():  # drop outputs for photos no longer in the manifest
        if f.name not in keep:
            f.unlink()
            print("removed stale", f.name)

    text = INDEX.read_text()
    text = replace_block(text, "tiles", "\n".join(tiles))
    text = replace_block(text, "lightboxes", "\n".join(boxes))
    INDEX.write_text(text)
    up = UPLOAD.read_text()
    up = replace_block(up, "upload", "\n".join(upload_card(k, v["label"], v["caption"]) for k, v in slots.items()),
                       "public/upload.html")
    UPLOAD.write_text(up)
    write_slots(slots)
    print(f"index.html: {len(photos)} gallery photos; upload.html + functions/_lib/slots.js: {len(slots)} slots")


if __name__ == "__main__":
    main()
