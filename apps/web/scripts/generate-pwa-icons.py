"""Generate every raster app icon apps/web ships, from ONE brand mark.

The mark is the same one the mobile app uses (apps/mobile/assets/icon.png):
a near-black field with a vertical luminance gradient (#202020 -> #101010) and a
faint radial highlight, carrying a near-white (#fafafa) rounded-square bookmark
glyph with a V notch and a soft drop shadow. Keep this in sync with the mobile
generator so every surface — iOS app, Android app, home-screen PWA, browser tab
— is recognisably one picture.

Outputs (run: pnpm --filter @bookmark-ai/web icons):
- public/icon-192.png            PWA icon, purpose "any"
- public/icon-512.png            PWA icon, purpose "any" (install/splash source)
- public/icon-maskable-512.png   purpose "maskable" — glyph shrunk so it survives
                                 Android's circle/squircle crop (safe zone is the
                                 centre 80%, i.e. a circle of radius 0.4*size)
- app/apple-icon.png             180x180 apple-touch-icon, OPAQUE RGB (no alpha
                                 channel at all: iOS composites touch icons onto
                                 black and applies its own corner mask, so alpha
                                 only ever produces dark fringing)

Requires Pillow. Deterministic — re-running produces identical bytes.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

SIZE = 1024  # master render size; every output is a LANCZOS downscale of it
FG = (0xFA, 0xFA, 0xFA, 255)  # #fafafa — near-white glyph
WEB = Path(__file__).resolve().parent.parent
PUBLIC = WEB / "public"


def glyph_mask(scale_w: float, scale_h: float) -> Image.Image:
    """White-on-transparent bookmark glyph, centred."""
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    w, h = int(SIZE * scale_w), int(SIZE * scale_h)
    x0, y0 = (SIZE - w) // 2, (SIZE - h) // 2
    x1, y1 = x0 + w, y0 + h
    d.rounded_rectangle([x0, y0, x1, y1], radius=52, fill=(255, 255, 255, 255))
    notch = int(h * 0.30)
    d.polygon([(x0, y1), (SIZE // 2, y1 - notch), (x1, y1)], fill=(0, 0, 0, 0))
    return img


def gradient_bg() -> Image.Image:
    """Vertical #202020->#101010 gradient with a soft radial highlight."""
    bg = Image.new("RGB", (SIZE, SIZE))
    top, bottom = 0x20, 0x10
    for y in range(SIZE):
        v = top + (bottom - top) * y // (SIZE - 1)
        ImageDraw.Draw(bg).line([(0, y), (SIZE, y)], fill=(v, v, v))
    glow = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(glow).ellipse(
        [SIZE * 0.22, SIZE * 0.10, SIZE * 0.78, SIZE * 0.62], fill=26
    )
    glow = glow.filter(ImageFilter.GaussianBlur(140))
    bg = Image.composite(Image.new("RGB", (SIZE, SIZE), (0x3A, 0x3A, 0x3A)), bg, glow)
    return bg


def glyph_with_shadow(scale_w: float, scale_h: float) -> Image.Image:
    """Transparent layer: blurred drop shadow + the near-white glyph on top."""
    mask = glyph_mask(scale_w, scale_h)
    layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    shadow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    shadow.paste((0, 0, 0, 140), (0, 22), mask.split()[3])
    shadow = shadow.filter(ImageFilter.GaussianBlur(26))
    layer.alpha_composite(shadow)
    solid = Image.new("RGBA", (SIZE, SIZE), FG)
    layer.paste(solid, (0, 0), mask.split()[3])
    return layer


def composed(scale_w: float, scale_h: float) -> Image.Image:
    """Full-bleed opaque tile: gradient field + glyph."""
    tile = gradient_bg().convert("RGBA")
    tile.alpha_composite(glyph_with_shadow(scale_w, scale_h))
    return tile.convert("RGB")


def write(img: Image.Image, path: Path, size: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.resize((size, size), Image.LANCZOS).save(path)
    print(f"wrote {path.relative_to(WEB)} ({size}x{size}, {img.mode})")


# Standard icons: the glyph at the same proportion as the iOS app icon.
standard = composed(0.40, 0.58)
write(standard, PUBLIC / "icon-192.png", 192)
write(standard, PUBLIC / "icon-512.png", 512)
write(standard, WEB / "app" / "apple-icon.png", 180)

# Maskable: glyph pulled in so its bounding box sits inside the safe circle
# (half-diagonal of 0.30x0.44 is ~0.266 of the size, well under the 0.4 radius).
write(composed(0.30, 0.44), PUBLIC / "icon-maskable-512.png", 512)
