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
GREEN_HIGHLIGHT = (174, 255, 156, 245)
GREEN_DIM = (38, 170, 48, 185)


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
    radius = 102
    glow_draw = ImageDraw.Draw(glow, "RGBA")
    chip_draw = ImageDraw.Draw(base, "RGBA")

    points = draw_diamond(chip_draw, center, radius, PANEL)
    for width, alpha in ((24, 24), (14, 50), (7, 90)):
        glow_draw.line([s(point) for point in points + [points[0]]], fill=(57, 255, 20, alpha), width=width * SCALE, joint="curve")
    chip_draw.line([s(point) for point in points + [points[0]]], fill=GREEN, width=5 * SCALE, joint="curve")

    # Beveled highlights keep the diamond from reading as a flat outline.
    chip_draw.line([s(points[0]), s(points[1])], fill=GREEN_HIGHLIGHT, width=2 * SCALE)
    chip_draw.line([s(points[2]), s(points[3])], fill=(24, 145, 36, 235), width=2 * SCALE)

    inner = draw_diamond(chip_draw, center, 74, (3, 10, 18, 255))
    chip_draw.line([s(point) for point in inner + [inner[0]]], fill=GREEN_SOFT, width=3 * SCALE, joint="curve")

    def local(u: float, v: float) -> Point:
        return (center[0] + (u - v) * 0.707, center[1] + (u + v) * 0.707)

    # Internal buses, pads, vias, and a central die. No exterior pin stubs.
    for offset in (-44, -30, -16, 0, 16, 30, 44):
        chip_draw.line([s(local(-48, offset)), s(local(48, offset))], fill=GREEN_DIM, width=1 * SCALE)
        chip_draw.line([s(local(offset, -48)), s(local(offset, 48))], fill=(38, 170, 48, 135), width=1 * SCALE)

    core = [local(0, -30), local(30, 0), local(0, 30), local(-30, 0)]
    chip_draw.polygon([s(point) for point in core], fill=(9, 34, 28, 255))
    chip_draw.line([s(point) for point in core + [core[0]]], fill=GREEN_HIGHLIGHT, width=2 * SCALE)

    for u in (-48, -32, -16, 16, 32, 48):
        for v in (-52, 52):
            for x, y in (local(u, v), local(v, u)):
                chip_draw.rounded_rectangle(
                    [
                        round((x - 3) * SCALE),
                        round((y - 3) * SCALE),
                        round((x + 3) * SCALE),
                        round((y + 3) * SCALE),
                    ],
                    radius=round(1 * SCALE),
                    fill=(124, 255, 100, 235),
                )

    for trace in (
        [local(-30, -8), local(-52, -8), local(-52, -32)],
        [local(30, 8), local(52, 8), local(52, 32)],
        [local(-8, 30), local(-8, 52), local(-32, 52)],
        [local(8, -30), local(8, -52), local(32, -52)],
        [local(-24, 24), local(-44, 24), local(-44, 42)],
        [local(24, -24), local(44, -24), local(44, -42)],
    ):
        chip_draw.line([s(point) for point in trace], fill=(140, 255, 110, 230), width=2 * SCALE, joint="curve")

    for point in (
        local(-44, -44),
        local(44, -44),
        local(-44, 44),
        local(44, 44),
        local(0, 0),
        local(-24, 0),
        local(24, 0),
    ):
        x, y = point
        chip_draw.ellipse(
            [
                round((x - 4) * SCALE),
                round((y - 4) * SCALE),
                round((x + 4) * SCALE),
                round((y + 4) * SCALE),
            ],
            fill=(151, 255, 131, 235),
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
            ((420, 104), (346, 56), (164, 58), (94, 132)),
            ((94, 132), (38, 196), (118, 246), (260, 252)),
            ((260, 252), (422, 260), (464, 334), (378, 388)),
            ((378, 388), (306, 438), (152, 436), (86, 382)),
        ]
    )
    draw_neon_line(line_layers, s_path, width=10)
    ImageDraw.Draw(line_layers[3], "RGBA").line(
        [s(point) for point in s_path],
        fill=GREEN_HIGHLIGHT,
        width=3 * SCALE,
        joint="curve",
    )

    for layer_index, blur in ((0, 18), (1, 10), (2, 4)):
        base.alpha_composite(line_layers[layer_index].filter(ImageFilter.GaussianBlur(blur * SCALE)))
    base.alpha_composite(line_layers[3])

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
  <path d="M420 104 C346 56 164 58 94 132 C38 196 118 246 260 252 C422 260 464 334 378 388 C306 438 152 436 86 382" fill="none" stroke="#39ff14" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow)"/>
  <path d="M420 104 C346 56 164 58 94 132 C38 196 118 246 260 252 C422 260 464 334 378 388 C306 438 152 436 86 382" fill="none" stroke="#aeff9c" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  <polygon points="256,154 358,256 256,358 154,256" fill="#07111f" stroke="#39ff14" stroke-width="6" filter="url(#glow)"/>
  <polygon points="256,182 330,256 256,330 182,256" fill="#030a12" stroke="#67ff4e" stroke-width="3"/>
  <g fill="#67ff4e">
    <circle cx="206" cy="206" r="4"/><circle cx="306" cy="206" r="4"/><circle cx="206" cy="306" r="4"/><circle cx="306" cy="306" r="4"/>
    <circle cx="256" cy="256" r="4"/><circle cx="232" cy="256" r="4"/><circle cx="280" cy="256" r="4"/>
  </g>
  <path d="M218 248 H196 V226 M294 264 H316 V286 M248 294 V316 H226 M264 218 V196 H286" fill="none" stroke="#8cff6e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
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
