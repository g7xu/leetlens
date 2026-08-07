"""Generate LeetLens extension icons.

A magnifying glass whose lens rim is the four phase colors from the tracker
panel (thinking blue, writing green, reviewing yellow, debugging red — the
same hues the panel's phase badges use), on the panel's dark card background.
Drawn at 1024px and downsampled with Lanczos for crisp small sizes.
"""

import sys

from PIL import Image, ImageDraw

OUT_DIR = sys.argv[1]

S = 1024  # master size

BG = "#1c1f26"          # panel card background
BORDER = "#333a45"      # panel border
HANDLE = "#c7cdd6"      # panel icon-button ink
GLASS = "#2d3a55"       # thinking-badge fill => subtle lens tint
# Phase badge text colors, clockwise from top-right.
PHASES = ["#9db8ff", "#8fd9a8", "#e6cf7a", "#f2a0a8"]


def rounded_bg(draw):
    radius = int(S * 0.22)
    draw.rounded_rectangle([0, 0, S - 1, S - 1], radius=radius, fill=BG, outline=BORDER, width=int(S * 0.015))


def lens(draw):
    cx, cy = int(S * 0.44), int(S * 0.44)
    r = int(S * 0.26)
    rim = int(S * 0.075)
    box = [cx - r, cy - r, cx + r, cy + r]

    # Glass fill with a faint tint so the lens reads at 16px.
    draw.ellipse(box, fill=GLASS)

    # Rim: four 90-degree arcs, one per phase, starting at the top (-90).
    for i, color in enumerate(PHASES):
        start = -90 + i * 90
        draw.arc(box, start=start + 4, end=start + 86, fill=color, width=rim)

    # Handle toward the bottom-right corner.
    import math
    angle = math.radians(45)
    hx0 = cx + (r - rim // 4) * math.cos(angle)
    hy0 = cy + (r - rim // 4) * math.sin(angle)
    hx1 = cx + (r + int(S * 0.24)) * math.cos(angle)
    hy1 = cy + (r + int(S * 0.24)) * math.sin(angle)
    draw.line([hx0, hy0, hx1, hy1], fill=HANDLE, width=int(S * 0.085))

    # Specular glint, top-left of the glass.
    gr = int(r * 0.32)
    gx, gy = cx - int(r * 0.38), cy - int(r * 0.38)
    draw.ellipse([gx - gr, gy - gr, gx + gr, gy + gr], fill="#3a4a6b")


def main():
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    rounded_bg(draw)
    lens(draw)
    for size in (128, 48, 32, 16):
        img.resize((size, size), Image.LANCZOS).save(f"{OUT_DIR}/icon{size}.png")
        print(f"wrote icon{size}.png")


main()
