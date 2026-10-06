#!/usr/bin/env python3
"""Build photorealistic bookshelf composite with cloth/paper spines on oak shelf."""
from __future__ import annotations

import colorsys
import json
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]
BOOKS = ROOT / "data" / "books.json"
SHELF = ROOT / "assets" / "img" / "books" / "shelf-ref.jpg"
SPINE_DIR = ROOT / "assets" / "img" / "books" / "spines"
OUT_SHELF = ROOT / "assets" / "img" / "books" / "shelf-composite.jpg"
OUT_META = ROOT / "data" / "bookshelf-layout.json"

SHELF_LEFT = 75
SHELF_WIDTH_PX = 1688
SHELF_WIDTH_IN = 35.5
SHELF_BOTTOMS = [676, 1328, 2008, 2708, 3542]
RATIO = SHELF_WIDTH_PX / SHELF_WIDTH_IN

# Keep known-good photographed spines (do not overwrite with generators)
PHOTO_SPINES = {
    "5056556": SPINE_DIR / "5056556_raw0.jpg",  # Grapes of Wrath — real Viking spine
}

# Split-complementary around honey oak (~32°):
# analogous warm cloth + cool complements (navy / teal / plum)
CLOTH = [
    {"bg": (92, 34, 32), "ink": (244, 228, 210), "accent": (196, 148, 88), "mat": "cloth"},   # oxblood
    {"bg": (28, 44, 68), "ink": (228, 236, 246), "accent": (168, 188, 210), "mat": "cloth"},   # navy
    {"bg": (38, 58, 44), "ink": (228, 238, 220), "accent": (140, 168, 118), "mat": "cloth"},   # forest
    {"bg": (72, 48, 30), "ink": (246, 234, 212), "accent": (188, 150, 92), "mat": "cloth"},    # walnut
    {"bg": (86, 30, 48), "ink": (246, 230, 234), "accent": (200, 130, 148), "mat": "cloth"},   # wine
    {"bg": (36, 38, 42), "ink": (236, 236, 232), "accent": (176, 172, 160), "mat": "cloth"},   # charcoal
    {"bg": (110, 86, 48), "ink": (250, 242, 220), "accent": (210, 180, 110), "mat": "cloth"},  # olive-tan
    {"bg": (48, 60, 74), "ink": (228, 236, 244), "accent": (150, 178, 200), "mat": "cloth"},   # slate
    {"bg": (118, 58, 32), "ink": (250, 236, 214), "accent": (220, 160, 90), "mat": "cloth"},   # rust
    {"bg": (32, 58, 60), "ink": (224, 242, 238), "accent": (110, 170, 160), "mat": "cloth"},   # teal
    {"bg": (62, 42, 56), "ink": (242, 228, 238), "accent": (170, 130, 160), "mat": "cloth"},   # plum
    {"bg": (210, 196, 168), "ink": (48, 36, 26), "accent": (130, 100, 60), "mat": "paper"},    # cream paper
    {"bg": (196, 188, 176), "ink": (42, 38, 34), "accent": (120, 90, 70), "mat": "paper"},     # warm gray paper
    {"bg": (168, 52, 44), "ink": (250, 236, 220), "accent": (220, 170, 100), "mat": "cloth"},  # tomato cloth
]


def load_font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    candidates = [
        "C:/Windows/Fonts/georgiab.ttf" if bold else "C:/Windows/Fonts/georgia.ttf",
        "C:/Windows/Fonts/timesbd.ttf" if bold else "C:/Windows/Fonts/times.ttf",
        "C:/Windows/Fonts/GARA.TTF",
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size=size)
    return ImageFont.load_default()


def hash_int(text: str) -> int:
    h = 0
    for ch in text:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return h


def cloth_for(book: dict) -> dict:
    title = book.get("title") or "book"
    stored = book.get("spine") or {}
    if stored.get("bg"):
        bg = tuple(int(stored["bg"].lstrip("#")[i : i + 2], 16) for i in (0, 2, 4))
        ink = tuple(int((stored.get("ink") or "#f3e6d4").lstrip("#")[i : i + 2], 16) for i in (0, 2, 4))
        r, g, b = [c / 255 for c in bg]
        h, s, v = colorsys.rgb_to_hsv(r, g, b)
        s = min(0.58, max(0.18, s * 0.92))
        v = min(0.55, max(0.14, v * 0.88))
        rf, gf, bf = colorsys.hsv_to_rgb(h, s, v)
        bg = (int(rf * 255), int(gf * 255), int(bf * 255))
        accent = tuple(min(255, int(c * 1.28 + 18)) for c in bg)
        mat = "paper" if v > 0.42 and s < 0.35 else "cloth"
        # Force readable ink against cloth
        bg_lum = 0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]
        if bg_lum < 140:
            ink = (244, 232, 214) if ink[0] + ink[1] + ink[2] < 420 else ink
        else:
            ink = (42, 32, 24) if ink[0] + ink[1] + ink[2] > 420 else ink
        return {"bg": bg, "ink": ink, "accent": accent, "mat": mat}
    return CLOTH[hash_int(title) % len(CLOTH)].copy()


def vertical_shade(width: int, height: int, strength: float = 0.28) -> Image.Image:
    mask = Image.new("L", (width, height))
    px = mask.load()
    for x in range(width):
        t = x / max(width - 1, 1)
        # Cylinder-ish: bright near left, soft mid, darker toward pages
        v = 0.55 + 0.38 * math.exp(-((t - 0.18) ** 2) / 0.08) - strength * t
        for y in range(height):
            yy = y / max(height - 1, 1)
            edge = 1.0 - 0.14 * max(0.0, abs(yy - 0.5) * 2 - 0.72)
            px[x, y] = int(max(0, min(255, 255 * v * edge)))
    return mask


def cloth_texture(width: int, height: int, seed: int, mat: str) -> Image.Image:
    """Linen / buckram / paper grain — strong enough to survive shelf downscale."""
    rng = random.Random(seed)
    # Build at half-res then upscale so grain stays chunky on the shelf
    sw, sh = max(8, width // 2), max(16, height // 2)
    base = Image.new("L", (sw, sh))
    px = base.load()
    amount = 28 if mat == "cloth" else 16
    for y in range(sh):
        for x in range(sw):
            px[x, y] = 128 + rng.randint(-amount, amount)

    weave = Image.new("L", (sw, sh), 128)
    wpx = weave.load()
    for x in range(sw):
        tone = 128 + (12 if x % 2 == 0 else -9) + (6 if x % 4 == 0 else 0)
        for y in range(sh):
            wpx[x, y] = max(0, min(255, tone + rng.randint(-3, 3)))

    weft = Image.new("L", (sw, sh), 128)
    fpx = weft.load()
    step = 2 if mat == "cloth" else 3
    for y in range(sh):
        tone = 128 + (10 if y % step == 0 else -6)
        for x in range(sw):
            fpx[x, y] = tone

    mixed = Image.blend(base, weave, 0.5 if mat == "cloth" else 0.28)
    mixed = Image.blend(mixed, weft, 0.35 if mat == "cloth" else 0.16)

    if mat == "cloth":
        blot = Image.new("L", (max(4, sw // 3), max(8, sh // 3)))
        bpx = blot.load()
        bw, bh = blot.size
        for y in range(bh):
            for x in range(bw):
                bpx[x, y] = 128 + rng.randint(-30, 30)
        blot = blot.resize((sw, sh), Image.Resampling.BILINEAR)
        mixed = Image.blend(mixed, blot, 0.3)

    mixed = mixed.resize((width, height), Image.Resampling.BILINEAR)
    return mixed.filter(ImageFilter.SMOOTH)


def make_spine(book: dict, height_px: int, width_px: int) -> Image.Image:
    """Convincing generic cloth/paper spine (not a photo, but shelf-credible)."""
    title = book.get("title") or "Untitled"
    seed = hash_int(title)
    rng = random.Random(seed)
    colors = cloth_for(book)
    bg, ink, accent = colors["bg"], colors["ink"], colors["accent"]
    mat = colors.get("mat") or "cloth"
    style = seed % 5  # 0 solid, 1 bands, 2 cream head, 3 foil rules, 4 dual rule

    img = Image.new("RGB", (width_px, height_px), bg)
    draw = ImageDraw.Draw(img)

    if style == 1:
        band_h = max(12, int(height_px * 0.075))
        draw.rectangle([0, 0, width_px, band_h], fill=accent)
        draw.rectangle([0, height_px - band_h, width_px, height_px], fill=accent)
    elif style == 2:
        head = max(16, int(height_px * 0.11))
        cream = (232, 220, 196) if sum(bg) < 380 else tuple(max(0, c - 40) for c in bg)
        draw.rectangle([0, 0, width_px, head], fill=cream)
    elif style in (3, 4):
        y1 = int(height_px * 0.12)
        y2 = int(height_px * 0.88)
        foil = accent if sum(accent) > 220 else tuple(min(255, c + 40) for c in accent)
        for yy in (y1, y2):
            draw.line([(2, yy), (width_px - 3, yy)], fill=foil, width=max(1, width_px // 26))
        if style == 4:
            draw.line([(2, y1 + 4), (width_px - 3, y1 + 4)], fill=foil, width=1)

    # Publisher foot block
    if style in (0, 1, 3) and width_px >= 26:
        foot = max(9, int(height_px * 0.04))
        draw.rectangle(
            [2, height_px - foot - 5, width_px - 3, height_px - 5],
            fill=tuple(max(0, c - 22) for c in bg),
        )

    # Cylinder lighting
    shade = vertical_shade(width_px, height_px, 0.3)
    bright = ImageEnhance.Brightness(img).enhance(1.16)
    dark = ImageEnhance.Brightness(img).enhance(0.78)
    img = Image.composite(bright, dark, shade)

    # Material grain (heavier so it survives resize onto the shelf photo)
    grain = cloth_texture(width_px, height_px, seed, mat)
    grain_rgb = Image.merge("RGB", (grain, grain, grain))
    img = Image.blend(img, grain_rgb, 0.28 if mat == "cloth" else 0.14)

    # Page block on the right (slightly warm, lined)
    page_w = max(2, width_px // 12)
    page = Image.new("RGB", (page_w, height_px))
    pd = ImageDraw.Draw(page)
    for x in range(page_w):
        t = x / max(page_w - 1, 1)
        c = int(240 - 32 * t)
        pd.line([(x, 0), (x, height_px)], fill=(c, c - 5, c - 14))
    for y in range(0, height_px, 2):
        pd.line([(0, y), (page_w - 1, y)], fill=(214, 204, 184))
    # Soft page shadow into spine body
    img.paste(page, (width_px - page_w, 0))
    draw = ImageDraw.Draw(img)
    for i, a in enumerate((40, 22, 10)):
        x = width_px - page_w - 1 - i
        if x >= 0:
            draw.line([(x, 0), (x, height_px)], fill=(0, 0, 0, a) if False else tuple(max(0, c - a) for c in bg))

    # Left binding highlight + micro bevel
    draw.line([(0, 0), (0, height_px)], fill=tuple(min(255, c + 48) for c in bg), width=1)
    if width_px > 22:
        draw.line([(1, 0), (1, height_px)], fill=tuple(min(255, c + 22) for c in bg), width=1)

    # Headband / tail wear
    wear = ImageDraw.Draw(img)
    for i in range(3):
        wear.rectangle([0, i, width_px, i], fill=tuple(max(0, c - 18 - i * 6) for c in bg))
        wear.rectangle(
            [0, height_px - 1 - i, width_px, height_px - 1 - i],
            fill=tuple(max(0, c - 22 - i * 6) for c in bg),
        )

    # ---- vertical title only (bottom → top), centered ----
    body_w = max(10, width_px - page_w - 2)
    canvas_w, canvas_h = height_px, body_w
    text_layer = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
    td = ImageDraw.Draw(text_layer)

    short = title
    # Prefer cleaner short titles for spine width
    if len(short) > 40:
        short = short[:38].rsplit(" ", 1)[0] + "…"

    # Fill most of the spine width with a bold serif title
    font_size = max(13, int(canvas_h * 0.62))
    font = load_font(font_size, bold=True)
    while font_size > 10:
        bbox = td.textbbox((0, 0), short, font=font)
        if bbox[2] - bbox[0] <= canvas_w * 0.86:
            break
        font_size -= 1
        font = load_font(font_size, bold=True)

    bbox = td.textbbox((0, 0), short, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    title_x = max(8, (canvas_w - tw) // 2)
    title_y = max(0, (canvas_h - th) // 2)

    # Soft emboss: shadow + highlight + ink
    td.text((title_x + 1, title_y + 1), short, font=font, fill=(0, 0, 0, 120))
    td.text((title_x - 1, title_y - 1), short, font=font, fill=(255, 255, 255, 48))
    td.text((title_x, title_y), short, font=font, fill=(*ink, 252))

    # Small foil ticks near head/tail instead of author name
    tick = ImageDraw.Draw(text_layer)
    tick_y = max(2, (canvas_h - 1) // 2)
    tick.line([(int(canvas_w * 0.06), tick_y), (int(canvas_w * 0.06) + 8, tick_y)], fill=(*accent, 160), width=1)
    tick.line(
        [(int(canvas_w * 0.94) - 8, tick_y), (int(canvas_w * 0.94), tick_y)],
        fill=(*accent, 160),
        width=1,
    )

    text_layer = text_layer.rotate(90, expand=True, fillcolor=(0, 0, 0, 0))
    body = Image.new("RGBA", (width_px, height_px), (0, 0, 0, 0))
    tw2, th2 = text_layer.size
    ox = max(0, (width_px - page_w - tw2) // 2)
    oy = max(0, (height_px - th2) // 2)
    body.paste(text_layer, (ox, oy), text_layer)
    img = Image.alpha_composite(img.convert("RGBA"), body).convert("RGB")

    # Soft contact shade along bottom
    bottom_shade = Image.new("L", (width_px, height_px), 0)
    bsp = bottom_shade.load()
    for y in range(height_px - 10, height_px):
        a = int(70 * ((y - (height_px - 10)) / 10))
        for x in range(width_px):
            bsp[x, y] = a
    darkened = ImageEnhance.Brightness(img).enhance(0.72)
    img = Image.composite(darkened, img, bottom_shade)

    img = ImageEnhance.Contrast(img).enhance(1.1)
    img = ImageEnhance.Sharpness(img).enhance(1.12)
    return img.filter(ImageFilter.SMOOTH_MORE)


def prepare_photo_spine(src: Path, dest: Path) -> bool:
    """Normalize a photographed spine to a tall strip."""
    try:
        im = ImageOps.exif_transpose(Image.open(src).convert("RGB"))
    except Exception:
        return False
    w, h = im.size
    if h < w * 1.6:
        # Prefer center-ish band
        band = max(36, int(w * 0.42))
        left = max(0, (w - band) // 2)
        im = im.crop((left, 0, min(w, left + band), h))
        w, h = im.size
    target_h = 900
    target_w = max(40, int(w * (target_h / max(h, 1))))
    im = im.resize((target_w, target_h), Image.Resampling.LANCZOS)
    im = ImageEnhance.Contrast(im).enhance(1.05)
    im.save(dest, quality=94)
    return True


def woodify_shelf(shelf: Image.Image) -> Image.Image:
    """
    Natural oak (not mustard): keep cavity shadows, invent grain.
    Target mid ~#B8956A (H≈32°, moderate S) — split-comp with navy/teal spines.
    """
    w, h = shelf.size
    gray = ImageOps.grayscale(shelf)
    oak = ImageOps.colorize(gray, black="#1a120c", white="#d9c4a0")
    base = Image.blend(oak, shelf, 0.48)
    r, g, b = base.split()
    r = r.point(lambda p: min(255, int(p * 1.02 + 2)))
    g = g.point(lambda p: min(255, int(p * 0.98 + 1)))
    b = b.point(lambda p: max(0, int(p * 0.88 - 2)))
    base = Image.merge("RGB", (r, g, b))

    rng = random.Random(42)
    gw, gh = max(1, w // 2), max(1, h // 2)
    grain = Image.new("L", (gw, gh))
    px = grain.load()
    for y in range(gh):
        row = 120 + int(8 * math.sin(y / 22.0)) + rng.randint(-5, 5)
        for x in range(gw):
            streak = int(6 * math.sin((x + y * 0.12) / 14.0))
            pore = 12 if (hash_int(f"{x}:{y}") % 53) == 0 else 0
            px[x, y] = max(0, min(255, row + streak + rng.randint(-4, 4) - pore))
    grain = grain.resize((w, h), Image.Resampling.BILINEAR)
    mask = gray.point(lambda p: max(0, min(255, int((p - 35) * 1.15))))
    grain_rgb = Image.merge("RGB", (grain, grain, grain))
    tinted = Image.blend(base, grain_rgb, 0.22)
    base = Image.composite(tinted, base, mask)

    base = ImageEnhance.Color(base).enhance(1.12)
    base = ImageEnhance.Contrast(base).enhance(1.12)
    return ImageEnhance.Brightness(base).enhance(1.02)


def book_dims_inches(book: dict) -> tuple[float, float]:
    title = book.get("title") or ""
    rating = float(book.get("rating") or 4)
    h = hash_int(title)
    height = 7.5 + ((h >> 3) % 16) / 10.0
    if rating >= 5:
        height += 0.12
    width = 0.9 + ((h >> 9) % 16) / 20.0
    if "Very Short Introduction" in title:
        return 0.58, 6.35
    return width, height


def main() -> None:
    SPINE_DIR.mkdir(parents=True, exist_ok=True)
    books = json.loads(BOOKS.read_text(encoding="utf-8"))

    for book in books:
        bid = book["id"]
        final = SPINE_DIR / f"{bid}.jpg"
        photo_src = PHOTO_SPINES.get(bid)
        if photo_src and photo_src.exists() and prepare_photo_spine(photo_src, final):
            book["spineImage"] = f"assets/img/books/spines/{bid}.jpg"
            book["spineSource"] = "photo"
            print("photo spine", book["title"][:42])
            continue

        width_in, height_in = book_dims_inches(book)
        h_px = max(360, int(height_in * 110))
        w_px = max(40, int(width_in * 110))
        print("spine", book["title"][:42], f"{w_px}x{h_px}")
        make_spine(book, h_px, w_px).save(final, quality=94)
        book["spineImage"] = f"assets/img/books/spines/{bid}.jpg"
        book["spineSource"] = "generated"

    shelf = woodify_shelf(Image.open(SHELF).convert("RGB")).convert("RGBA")
    layout_books = []
    shelf_i = 0
    x = SHELF_LEFT
    bottom = SHELF_BOTTOMS[shelf_i]
    shelf_right = SHELF_LEFT + SHELF_WIDTH_PX
    on_shelf = 0
    max_per_shelf = 9

    for book in books:
        width_in, height_in = book_dims_inches(book)
        w_px = max(22, int(width_in * RATIO))
        h_px = max(100, int(height_in * RATIO))
        max_h = (bottom - 120) if shelf_i == 0 else (bottom - SHELF_BOTTOMS[shelf_i - 1] - 40)
        h_px = min(h_px, max_h)

        if on_shelf >= max_per_shelf or x + w_px > shelf_right - 8:
            shelf_i += 1
            if shelf_i >= len(SHELF_BOTTOMS):
                break
            x = SHELF_LEFT
            bottom = SHELF_BOTTOMS[shelf_i]
            on_shelf = 0
            max_h = bottom - SHELF_BOTTOMS[shelf_i - 1] - 40
            h_px = min(h_px, max_h)

        spine = Image.open(SPINE_DIR / f"{book['id']}.jpg").convert("RGB")
        spine = spine.resize((w_px, h_px), Image.Resampling.LANCZOS)
        top = bottom - h_px
        # Soft contact shadow under each book
        shadow = Image.new("RGBA", (w_px + 8, 10), (0, 0, 0, 0))
        ImageDraw.Draw(shadow).ellipse([0, 2, w_px + 6, 9], fill=(0, 0, 0, 70))
        shelf.alpha_composite(shadow, (max(0, x - 3), bottom - 5))
        shelf.paste(spine, (x, top))

        layout_books.append(
            {
                "id": book["id"],
                "title": book["title"],
                "url": book.get("url"),
                "cover": book.get("cover"),
                "x": x,
                "y": top,
                "w": w_px,
                "h": h_px,
                "shelf": shelf_i,
                "spineImage": book["spineImage"],
                "spineSource": book.get("spineSource") or "generated",
            }
        )
        x += w_px + 2
        on_shelf += 1

    shelf_rgb = shelf.convert("RGB")
    cropped = shelf_rgb.crop((0, 0, shelf_rgb.width, 2140))
    cropped.save(OUT_SHELF, quality=92, optimize=True)
    OUT_META.write_text(
        json.dumps({"width": cropped.width, "height": cropped.height, "books": layout_books}, indent=2)
        + "\n",
        encoding="utf-8",
    )
    BOOKS.write_text(json.dumps(books, indent=2) + "\n", encoding="utf-8")
    photo_n = sum(1 for b in layout_books if b.get("spineSource") == "photo")
    print("wrote", OUT_SHELF, "books", len(layout_books), "photo", photo_n)


if __name__ == "__main__":
    main()
