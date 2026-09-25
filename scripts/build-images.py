"""Crop the Instagram UI off the source screenshots and write WebP + JPEG pairs.

Run: python3 scripts/build-images.py   (needs Pillow; cwebp not required)
Sources live in photos-src/ (not deployed). Outputs go to public/assets/. Never upscales.
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC, OUT = ROOT / "photos-src", ROOT / "public" / "assets"

# name: (crop box left, top, right, bottom in source px, max output width)
JOBS = {
    # right edge carries Instagram's ">" carousel arrow; left/top carry a grey UI strip
    "selfie": ((8, 10, 1085, 1390), 1077),
    # bottom carries the carousel dots
    "lawn": ((6, 6, 1075, 1385), 640),
    # blue selection border on left/right, dark rows top and bottom
    "street": ((6, 8, 656, 775), 640),
}

for name, (box, max_w) in JOBS.items():
    im = Image.open(SRC / f"{name}.png").convert("RGB").crop(box)
    if im.width > max_w:
        im = im.resize((max_w, round(im.height * max_w / im.width)), Image.LANCZOS)
    im.save(OUT / f"{name}.webp", "WEBP", quality=82, method=6)
    im.save(OUT / f"{name}.jpg", "JPEG", quality=82, optimize=True, progressive=True)
    print(name, im.size, (OUT / f"{name}.webp").stat().st_size, (OUT / f"{name}.jpg").stat().st_size)
