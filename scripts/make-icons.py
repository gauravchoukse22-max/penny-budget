#!/usr/bin/env python3
"""Generate every KaiJar app icon, for both platforms, from one definition.

    python3 scripts/make-icons.py

WHY THIS EXISTS. `expo prebuild` is what normally derives the native icons from
`app.json`, but this repo treats `ios/` and `android/` as source and never
prebuilds (prebuild wipes the Android signing config — see PREBUILD_NOTES.md).
Worse, both directories are **gitignored**, so the generated native icons are
not in version control at all. This script is the only reproducible record of
them: if `ios/` or `android/` is ever recreated, run this or the app ships the
wrong icon.

That is not hypothetical. The 1.3.0 rename first built with the old piggy-bank
icon still in place on both platforms, because editing `app.json` alone changes
nothing that a non-prebuild build actually reads.

Requires Pillow (`pip3 install Pillow`). Everything is drawn at 4x and
downsampled — Pillow has no antialiasing, so supersampling is what keeps the
coin edges from stair-stepping.
"""
import os
import shutil
from PIL import Image, ImageDraw

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SS = 4                              # supersample factor

PURPLE_LIGHT = (124, 92, 240)       # #7C5CF0
PURPLE_DARK = (83, 53, 214)         # #5335D6 — also app.json adaptiveIcon bg

# --- the artwork, in a 180-unit square -----------------------------------------
# A jar holding nine coins, stacked 4 / 3 / 2. Bounding box is x 44..136,
# y 40..146, so 92 x 106 centred on (90, 93).
BBOX_CX, BBOX_CY, BBOX_H = 90.0, 93.0, 106.0
LID = (57, 40, 123, 57, 6)          # x0, y0, x1, y1, corner radius
NECK = (68, 57, 112, 66)            # square corners
BODY = (44, 66, 136, 146, 22)
COIN_R = 8.5
COINS = [
    (61.5, 130), (80.5, 130), (99.5, 130), (118.5, 130),
    (71.0, 112), (90.0, 112), (109.0, 112),
    (80.5, 94), (99.5, 94),
]

# Artwork height as a fraction of the canvas.
FULL = 0.66     # store icon and legacy Android launcher icons
SAFE = 0.44     # Android adaptive layers.
# Why 0.44: a launcher may mask the adaptive icon to a circle of 66dp/108dp =
# 0.611 of the canvas. The artwork diagonal is sqrt(92^2 + 106^2) = 140.4 units,
# so height must stay under 106/140.4 * 0.611 = 0.461 for the corners to
# survive. 0.44 leaves margin.


def gradient(size):
    """Diagonal purple gradient. Built at 64px and scaled up: a linear ramp
    survives interpolation exactly, and this avoids a per-pixel loop at 4096px."""
    small = Image.new("RGB", (64, 64))
    px = small.load()
    for y in range(64):
        for x in range(64):
            t = (x + y) / 126.0
            px[x, y] = tuple(round(a + (b - a) * t)
                             for a, b in zip(PURPLE_LIGHT, PURPLE_DARK))
    return small.resize((size, size), Image.BICUBIC)


def jar(size, height_fraction):
    """White jar with the nine coins punched out as transparent holes.

    Holes rather than painted coins, so this one layer serves as the store
    icon (gradient shows through), the Android adaptive foreground (background
    layer shows through) and the monochrome layer (system tint shows through).
    One shape, no variants to keep in sync.
    """
    S = size * SS
    k = (S * height_fraction) / BBOX_H

    def pt(x, y):
        return (S / 2 + (x - BBOX_CX) * k, S / 2 + (y - BBOX_CY) * k)

    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    white = (255, 255, 255, 255)

    x0, y0, x1, y1, r = LID
    d.rounded_rectangle([pt(x0, y0), pt(x1, y1)], radius=r * k, fill=white)
    d.rectangle([pt(*NECK[:2]), pt(*NECK[2:])], fill=white)
    x0, y0, x1, y1, r = BODY
    d.rounded_rectangle([pt(x0, y0), pt(x1, y1)], radius=r * k, fill=white)

    for cx, cy in COINS:
        px, py = pt(cx, cy)
        rr = COIN_R * k
        d.ellipse([px - rr, py - rr, px + rr, py + rr], fill=(0, 0, 0, 0))

    return layer.resize((size, size), Image.LANCZOS)


def on_gradient(size, height_fraction):
    base = gradient(size).convert("RGBA")
    base.alpha_composite(jar(size, height_fraction))
    return base


def circle_mask(size):
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).ellipse([0, 0, size - 1, size - 1], fill=255)
    return m


def write(img, path, **kw):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, **kw)
    print("  " + os.path.relpath(path, REPO))


def main():
    # --- assets/ (what app.json points at; used by a future prebuild) ---------
    print("assets/")
    a = f"{REPO}/assets"
    write(on_gradient(1024, FULL).convert("RGB"), f"{a}/icon.png")
    write(gradient(512), f"{a}/android-icon-background.png")
    write(jar(512, SAFE), f"{a}/android-icon-foreground.png")
    write(jar(432, SAFE), f"{a}/android-icon-monochrome.png")
    write(on_gradient(48, 0.70).convert("RGB"), f"{a}/favicon.png")

    # --- ios/ (gitignored — this is the only record) -------------------------
    print("ios/ (gitignored)")
    write(on_gradient(1024, FULL).convert("RGB"),
          f"{REPO}/ios/PennyBudget/Images.xcassets/AppIcon.appiconset"
          f"/App-Icon-1024x1024@1x.png")

    # --- android/ (gitignored — this is the only record) ---------------------
    print("android/ (gitignored)")
    for dpi, (adaptive, legacy) in {
        "mdpi": (108, 48), "hdpi": (162, 72), "xhdpi": (216, 96),
        "xxhdpi": (324, 144), "xxxhdpi": (432, 192),
    }.items():
        d = f"{REPO}/android/app/src/main/res/mipmap-{dpi}"
        rnd = on_gradient(legacy, FULL)
        rnd.putalpha(circle_mask(legacy))
        for name, img in {
            "ic_launcher_background.webp": gradient(adaptive).convert("RGBA"),
            "ic_launcher_foreground.webp": jar(adaptive, SAFE),
            "ic_launcher_monochrome.webp": jar(adaptive, SAFE),
            "ic_launcher.webp": on_gradient(legacy, FULL),
            "ic_launcher_round.webp": rnd,
        }.items():
            write(img, os.path.join(d, name), format="WEBP",
                  lossless=True, quality=100)

    print("\nDone. Rebuild the app — icons are baked in at build time.")
    print("Verify what actually shipped, not just that the build was green:")
    print("  Android: aapt2 dump badging <apk> | head -1")
    print("  iOS:     xcrun -sdk iphoneos pngcrush -revert-iphone-optimizations \\")
    print("             <archive>/Products/Applications/PennyBudget.app/AppIcon60x60@2x.png out.png")


if __name__ == "__main__":
    main()
