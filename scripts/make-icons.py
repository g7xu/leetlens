"""Draw extension/icons/icon-{16,32,48,128}.png.

Run: uv run --with pillow python scripts/make-icons.py

Everything is drawn at 512px and downsampled, because Pillow's shape drawing
is not antialiased: at 16px a directly-drawn circle is visibly ragged. The
glyph is a magnifier over a code bracket — the lens must survive that 16px, so
the ring is deliberately thick and the bracket sits inside it rather than
beside it, where it would disappear.
"""

from pathlib import Path

from PIL import Image, ImageDraw

SIZES = (16, 32, 48, 128)
MASTER = 512
OUT = Path(__file__).resolve().parent.parent / "extension" / "icons"

BACKGROUND = (26, 31, 42, 255)
LENS = (122, 162, 255, 255)      # the panel's accent blue
BRACKET = (143, 217, 168, 255)   # the "accepted" green
GLASS = (32, 41, 61, 255)


def draw_master() -> Image.Image:
    img = Image.new("RGBA", (MASTER, MASTER), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, MASTER - 1, MASTER - 1), radius=110, fill=BACKGROUND)

    ring, cx, cy, r = 44, 218, 210, 138
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=GLASS)
    d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=LENS, width=ring)

    # Handle, thick enough to still read as one stroke at 16px.
    d.line((cx + 96, cy + 96, 404, 404), fill=LENS, width=ring + 8)
    d.ellipse((404 - 24, 404 - 24, 404 + 24, 404 + 24), fill=LENS)

    # Three rising bars inside the lens: this is a lens on your practice, not a
    # search box. Solid bars survive the downsample to 16px, where the thin
    # diagonals of a `< >` glyph merge into a blob.
    bar_w, gap, base = 30, 22, cy + 56
    heights = (46, 78, 110)
    left = cx - (3 * bar_w + 2 * gap) // 2
    for i, h in enumerate(heights):
        x = left + i * (bar_w + gap)
        d.rounded_rectangle((x, base - h, x + bar_w, base), radius=8, fill=BRACKET)
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    master = draw_master()
    for size in SIZES:
        master.resize((size, size), Image.LANCZOS).save(OUT / f"icon-{size}.png")
    print("wrote", ", ".join(f"icon-{s}.png" for s in SIZES), "to", OUT)


if __name__ == "__main__":
    main()
