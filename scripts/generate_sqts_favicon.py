#!/usr/bin/env python3
"""Generate SQTS favicon assets from a deterministic circuit-chip mark."""

from __future__ import annotations

from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
SITE_DIR = ROOT / "site" if (ROOT / "site").is_dir() else ROOT
CANVAS = 512
SCALE = 4
SIZE = CANVAS * SCALE
BG = (2, 6, 23, 255)
PANEL = (7, 17, 31, 255)
GREEN = (57, 255, 20, 255)
GREEN_SOFT = (103, 255, 78, 255)


Point = tuple[float, float]


def s(point: Point) -> tuple[int, int]:
    return (round(point[0] * SCALE), round(point[1] * SCALE))


def lerp(a: Point, b: Point, t: float) -> Point:
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def cubic(p0: Point, p1: Point, p2: Point, p3: Point, steps: int = 72) -> list[Point]:
    pts: list[Point] = []
    for i in range(steps + 1):
        t = i / steps
        a = lerp(p0, p1, t)
        b = lerp(p1, p2, t)
        c = lerp(p2, p3, t)
        d = lerp(a, b, t)
        e = lerp(b, c, t)
        pts.append(lerp(d, e, t))
    return pts


def polyline_from_curves(curves: Iterable[tuple[Point, Point, Point, Point]]) -> list[Point]:
    pts: list[Point] = []
    for curve in curves:
        segment = cubic(*curve)
        if pts:
            segment = segment[1:]
        pts.extend(segment)
    return pts


def draw_neon_line(
    layers: list[Image.Image],
    points: list[Point],
    width: int,
    color: tuple[int, int, int, int] = GREEN,
) -> None:
    scaled = [s(point) for point in points]
    for image, layer_width, alpha in (
        (layers[0], width * 7, 24),
        (layers[1], width * 4, 52),
        (layers[2], width * 2, 92),
    ):
        glow = ImageDraw.Draw(image, "RGBA")
        glow.line(scaled, fill=(color[0], color[1], color[2], alpha), width=layer_width * SCALE, joint="curve")
    crisp = ImageDraw.Draw(layers[3], "RGBA")
    crisp.line(scaled, fill=color, width=width * SCALE, joint="curve")


def draw_node(draw: ImageDraw.ImageDraw, point: Point, radius: float = 5.5) -> None:
    x, y = point
    box = [
        round((x - radius) * SCALE),
        round((y - radius) * SCALE),
        round((x + radius) * SCALE),
        round((y + radius) * SCALE),
    ]
    draw.ellipse(box, outline=GREEN, width=round(2.2 * SCALE), fill=(10, 35, 22, 235))


def draw_diamond(draw: ImageDraw.ImageDraw, center: Point, radius: float, fill: tuple[int, int, int, int]) -> list[Point]:
    cx, cy = center
    points = [(cx, cy - radius), (cx + radius, cy), (cx, cy + radius), (cx - radius, cy)]
    draw.polygon([s(point) for point in points], fill=fill)
    return points


def draw_chip(base: Image.Image, glow: Image.Image) -> None:
    center = (256, 256)
    radius = 116
    glow_draw = ImageDraw.Draw(glow, "RGBA")
    chip_draw = ImageDraw.Draw(base, "RGBA")

    points = draw_diamond(chip_draw, center, radius, PANEL)
    for width, alpha in ((24, 24), (14, 50), (7, 90)):
        glow_draw.line([s(point) for point in points + [points[0]]], fill=(57, 255, 20, alpha), width=width * SCALE, joint="curve")
    chip_draw.line([s(point) for point in points + [points[0]]], fill=GREEN, width=5 * SCALE, joint="curve")

    inner = draw_diamond(chip_draw, center, 76, (4, 13, 20, 255))
    chip_draw.line([s(point) for point in inner + [inner[0]]], fill=GREEN_SOFT, width=2 * SCALE, joint="curve")

    # Edge pins: short neon contacts radiating out from each diamond edge.
    for edge_start, edge_end, outward in (
        (points[0], points[1], (1, -1)),
        (points[1], points[2], (1, 1)),
        (points[2], points[3], (-1, 1)),
        (points[3], points[0], (-1, -1)),
    ):
        for idx in range(1, 7):
            t = idx / 7
            px, py = lerp(edge_start, edge_end, t)
            ox, oy = outward
            start = (px + ox * 1.5, py + oy * 1.5)
            end = (px + ox * 15, py + oy * 15)
            chip_draw.line([s(start), s(end)], fill=GREEN_SOFT, width=3 * SCALE)

    # Rotated micro-grid inside the chip.
    for u in range(-42, 43, 14):
        for v in range(-42, 43, 14):
            x = center[0] + (u - v) * 0.707
            y = center[1] + (u + v) * 0.707
            if abs(x - center[0]) + abs(y - center[1]) < 64:
                chip_draw.rounded_rectangle(
                    [
                        round((x - 3.4) * SCALE),
                        round((y - 3.4) * SCALE),
                        round((x + 3.4) * SCALE),
                        round((y + 3.4) * SCALE),
                    ],
                    radius=round(1.1 * SCALE),
                    fill=(95, 255, 80, 238),
                )


def build_icon() -> Image.Image:
    base = Image.new("RGBA", (SIZE, SIZE), BG)
    radial = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    radial_draw = ImageDraw.Draw(radial, "RGBA")
    radial_draw.ellipse(s((-32, -20)) + s((544, 548)), fill=(57, 255, 20, 20))
    radial = radial.filter(ImageFilter.GaussianBlur(90 * SCALE))
    base.alpha_composite(radial)

    line_layers = [Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0)) for _ in range(4)]
    s_path = polyline_from_curves(
        [
            ((176, 178), (72, 80), (340, 36), (396, 128)),
            ((396, 128), (452, 220), (120, 188), (126, 284)),
            ((126, 284), (132, 392), (388, 342), (336, 334)),
        ]
    )
    draw_neon_line(line_layers, s_path, width=7)

    # Parallel circuit traces that keep the silhouette reading as an S at tab size.
    for offset, width, alpha_shift in ((-22, 3, 0), (22, 3, 0)):
        shifted = [(x, y + offset) for x, y in s_path[8:-8]]
        draw_neon_line(line_layers, shifted, width=width, color=(57, 255, 20, 210 - alpha_shift))

    # Corner breakout traces from the diamond's upper-left and lower-right.
    breakouts = [
        [(178, 178), (118, 146), (78, 146), (54, 124)],
        [(178, 178), (138, 110), (96, 96), (62, 72)],
        [(178, 178), (94, 208), (58, 240), (36, 274)],
        [(336, 334), (388, 360), (414, 394), (458, 430)],
        [(336, 334), (414, 310), (452, 270), (478, 238)],
        [(336, 334), (374, 412), (420, 454), (468, 466)],
    ]
    for trace in breakouts:
        draw_neon_line(line_layers, trace, width=3)

    for layer_index, blur in ((0, 18), (1, 10), (2, 4)):
        base.alpha_composite(line_layers[layer_index].filter(ImageFilter.GaussianBlur(blur * SCALE)))
    base.alpha_composite(line_layers[3])

    nodes = [(62, 72), (54, 124), (36, 274), (396, 128), (126, 284), (478, 238), (458, 430), (468, 466)]
    node_draw = ImageDraw.Draw(base, "RGBA")
    for node in nodes:
        draw_node(node_draw, node)

    chip_glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw_chip(base, chip_glow)
    base.alpha_composite(chip_glow.filter(ImageFilter.GaussianBlur(8 * SCALE)))
    draw_chip(base, Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0)))

    return base.resize((CANVAS, CANVAS), Image.Resampling.LANCZOS)


def write_svg(path: Path) -> None:
    path.write_text(
        """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <filter id="glow" x="-80%" y="-80%" width="260%" height="260%">
      <feGaussianBlur stdDeviation="8" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <rect width="512" height="512" rx="64" fill="#020617"/>
  <path d="M176 178 C72 80 340 36 396 128 C452 220 120 188 126 284 C132 392 388 342 336 334" fill="none" stroke="#39ff14" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow)"/>
  <path d="M178 178 L118 146 L78 146 L54 124 M178 178 L138 110 L96 96 L62 72 M178 178 L94 208 L58 240 L36 274 M336 334 L388 360 L414 394 L458 430 M336 334 L414 310 L452 270 L478 238 M336 334 L374 412 L420 454 L468 466" fill="none" stroke="#39ff14" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow)"/>
  <polygon points="256,140 372,256 256,372 140,256" fill="#07111f" stroke="#39ff14" stroke-width="6" filter="url(#glow)"/>
  <polygon points="256,180 332,256 256,332 180,256" fill="#040d14" stroke="#67ff4e" stroke-width="3"/>
  <g fill="#67ff4e">
    <circle cx="238" cy="220" r="4"/><circle cx="256" cy="220" r="4"/><circle cx="274" cy="220" r="4"/>
    <circle cx="228" cy="238" r="4"/><circle cx="246" cy="238" r="4"/><circle cx="264" cy="238" r="4"/><circle cx="282" cy="238" r="4"/>
    <circle cx="220" cy="256" r="4"/><circle cx="238" cy="256" r="4"/><circle cx="256" cy="256" r="4"/><circle cx="274" cy="256" r="4"/><circle cx="292" cy="256" r="4"/>
    <circle cx="228" cy="274" r="4"/><circle cx="246" cy="274" r="4"/><circle cx="264" cy="274" r="4"/><circle cx="282" cy="274" r="4"/>
    <circle cx="238" cy="292" r="4"/><circle cx="256" cy="292" r="4"/><circle cx="274" cy="292" r="4"/>
  </g>
</svg>
""",
        encoding="utf-8",
    )


def main() -> None:
    SITE_DIR.mkdir(parents=True, exist_ok=True)
    icon = build_icon()
    for filename, size in {
        "favicon-16x16.png": 16,
        "favicon-32x32.png": 32,
        "favicon-192x192.png": 192,
        "favicon-512x512.png": 512,
        "apple-touch-icon.png": 180,
    }.items():
        icon.resize((size, size), Image.Resampling.LANCZOS).save(SITE_DIR / filename, optimize=True)
    icon.save(SITE_DIR / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    write_svg(SITE_DIR / "favicon.svg")


if __name__ == "__main__":
    main()
