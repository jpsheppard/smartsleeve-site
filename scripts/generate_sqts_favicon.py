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


def draw_chip(base: Image.Image, glow: Image.Image, center: Point = (256, 256), radius: float = 102) -> None:
    factor = radius / 102
    glow_draw = ImageDraw.Draw(glow, "RGBA")
    chip_draw = ImageDraw.Draw(base, "RGBA")

    points = draw_diamond(chip_draw, center, radius, PANEL)
    for width, alpha in ((24, 24), (14, 50), (7, 90)):
        glow_draw.line([s(point) for point in points + [points[0]]], fill=(57, 255, 20, alpha), width=width * SCALE, joint="curve")
    chip_draw.line([s(point) for point in points + [points[0]]], fill=GREEN, width=5 * SCALE, joint="curve")

    # Beveled highlights keep the diamond from reading as a flat outline.
    chip_draw.line([s(points[0]), s(points[1])], fill=GREEN_HIGHLIGHT, width=2 * SCALE)
    chip_draw.line([s(points[2]), s(points[3])], fill=(24, 145, 36, 235), width=2 * SCALE)

    inner = draw_diamond(chip_draw, center, radius * 0.725, (3, 10, 18, 255))
    chip_draw.line([s(point) for point in inner + [inner[0]]], fill=GREEN_SOFT, width=3 * SCALE, joint="curve")

    def local(u: float, v: float) -> Point:
        return (center[0] + (u - v) * 0.707 * factor, center[1] + (u + v) * 0.707 * factor)

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
                        round((x - 3 * factor) * SCALE),
                        round((y - 3 * factor) * SCALE),
                        round((x + 3 * factor) * SCALE),
                        round((y + 3 * factor) * SCALE),
                    ],
                    radius=round(max(1, factor) * SCALE),
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
                round((x - 4 * factor) * SCALE),
                round((y - 4 * factor) * SCALE),
                round((x + 4 * factor) * SCALE),
                round((y + 4 * factor) * SCALE),
            ],
            fill=(151, 255, 131, 235),
        )


def transformed_s_path(center_x: float, scale: float) -> list[Point]:
    curves = [
        ((420, 104), (346, 56), (164, 58), (94, 132)),
        ((94, 132), (38, 196), (118, 246), (260, 252)),
        ((260, 252), (422, 260), (464, 334), (378, 388)),
        ((378, 388), (306, 438), (152, 436), (86, 382)),
    ]

    def transform(point: Point) -> Point:
        return (center_x + (point[0] - 256) * scale, 256 + (point[1] - 256) * scale)

    return polyline_from_curves(tuple(transform(point) for point in curve) for curve in curves)


def build_icon() -> Image.Image:
    base = Image.new("RGBA", (SIZE, SIZE), BG)
    radial = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    radial_draw = ImageDraw.Draw(radial, "RGBA")
    radial_draw.ellipse(s((-32, -20)) + s((544, 548)), fill=(57, 255, 20, 20))
    radial = radial.filter(ImageFilter.GaussianBlur(90 * SCALE))
    base.alpha_composite(radial)

    line_layers = [Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0)) for _ in range(4)]
    for center_x in (178, 334):
        s_path = transformed_s_path(center_x, 0.64)
        draw_neon_line(line_layers, s_path, width=8)
        ImageDraw.Draw(line_layers[3], "RGBA").line(
            [s(point) for point in s_path],
            fill=GREEN_HIGHLIGHT,
            width=2 * SCALE,
            joint="curve",
        )

    for layer_index, blur in ((0, 18), (1, 10), (2, 4)):
        base.alpha_composite(line_layers[layer_index].filter(ImageFilter.GaussianBlur(blur * SCALE)))
    base.alpha_composite(line_layers[3])

    chip_glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    for center in ((178, 256), (334, 256)):
        draw_chip(base, chip_glow, center=center, radius=74)
    base.alpha_composite(chip_glow.filter(ImageFilter.GaussianBlur(8 * SCALE)))
    for center in ((178, 256), (334, 256)):
        draw_chip(base, Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0)), center=center, radius=74)

    return base.resize((CANVAS, CANVAS), Image.Resampling.LANCZOS)


def write_svg(path: Path) -> None:
    curves = [
        ((420, 104), (346, 56), (164, 58), (94, 132)),
        ((94, 132), (38, 196), (118, 246), (260, 252)),
        ((260, 252), (422, 260), (464, 334), (378, 388)),
        ((378, 388), (306, 438), (152, 436), (86, 382)),
    ]

    def transform(point: Point, center_x: float, scale: float = 0.64) -> Point:
        return (center_x + (point[0] - 256) * scale, 256 + (point[1] - 256) * scale)

    def fmt(point: Point) -> str:
        return f"{point[0]:.1f} {point[1]:.1f}"

    def path_d(center_x: float) -> str:
        first = transform(curves[0][0], center_x)
        parts = [f"M{fmt(first)}"]
        for _, c1, c2, end in curves:
            parts.append(f"C{fmt(transform(c1, center_x))} {fmt(transform(c2, center_x))} {fmt(transform(end, center_x))}")
        return " ".join(parts)

    def chip_svg(cx: int) -> str:
        points = f"{cx},182 {cx + 74},256 {cx},330 {cx - 74},256"
        inner = f"{cx},202 {cx + 54},256 {cx},310 {cx - 54},256"
        core = f"{cx},234 {cx + 22},256 {cx},278 {cx - 22},256"
        return f"""
  <polygon points="{points}" fill="#07111f" stroke="#39ff14" stroke-width="5" filter="url(#glow)"/>
  <polygon points="{inner}" fill="#030a12" stroke="#67ff4e" stroke-width="2.4"/>
  <polygon points="{core}" fill="#09221c" stroke="#aeff9c" stroke-width="1.8"/>
  <g fill="#67ff4e">
    <circle cx="{cx - 36}" cy="220" r="3"/><circle cx="{cx + 36}" cy="220" r="3"/>
    <circle cx="{cx - 36}" cy="292" r="3"/><circle cx="{cx + 36}" cy="292" r="3"/>
    <circle cx="{cx}" cy="256" r="3.5"/><circle cx="{cx - 18}" cy="256" r="3"/><circle cx="{cx + 18}" cy="256" r="3"/>
  </g>
  <path d="M{cx - 28} 250 H{cx - 44} V234 M{cx + 28} 262 H{cx + 44} V278 M{cx - 6} 280 V296 H{cx - 24} M{cx + 6} 232 V216 H{cx + 24}" fill="none" stroke="#8cff6e" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
"""

    path.write_text(
        f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
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
  <path d="{path_d(178)}" fill="none" stroke="#39ff14" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow)"/>
  <path d="{path_d(334)}" fill="none" stroke="#39ff14" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow)"/>
  <path d="{path_d(178)}" fill="none" stroke="#aeff9c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="{path_d(334)}" fill="none" stroke="#aeff9c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
{chip_svg(178)}{chip_svg(334)}
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
