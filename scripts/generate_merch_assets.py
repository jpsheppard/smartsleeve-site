#!/usr/bin/env python3
"""Generate SmartSleeve public shop merch artwork."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "merch"
BLACK = (2, 6, 23, 255)
GREEN = (57, 255, 20, 255)
GREEN_DIM = (57, 255, 20, 150)
TEXT_SOFT = (205, 255, 210, 255)


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Narrow Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial Narrow.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial.ttf",
    ]
    for path in candidates:
        if path and Path(path).exists():
            return ImageFont.truetype(path, size=size)
    return ImageFont.load_default()


def fit_font(draw: ImageDraw.ImageDraw, text: str, max_width: int, start_size: int) -> ImageFont.FreeTypeFont:
    size = start_size
    while size > 24:
        font = load_font(size)
        bbox = draw.textbbox((0, 0), text, font=font)
        if bbox[2] - bbox[0] <= max_width:
            return font
        size -= 3
    return load_font(size)


def centered_paste(base: Image.Image, overlay: Image.Image, center_x: int, top: int) -> None:
    base.alpha_composite(overlay.convert("RGBA"), (round(center_x - overlay.width / 2), top))


def glow_line(base: Image.Image, xy: tuple[int, int, int, int], fill: tuple[int, int, int, int], width: int) -> None:
    glow = Image.new("RGBA", base.size, (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow)
    gdraw.line(xy, fill=fill, width=width * 4)
    base.alpha_composite(glow.filter(ImageFilter.GaussianBlur(width * 2)))
    ImageDraw.Draw(base).line(xy, fill=fill, width=width)


def make_ss_front_art() -> None:
    icon = Image.open(ROOT / "favicon-512x512.png").convert("RGBA")
    art = Image.new("RGBA", (4500, 5400), BLACK)
    icon = icon.resize((2180, 2180), Image.Resampling.LANCZOS)
    centered_paste(art, icon, 2250, 620)

    draw = ImageDraw.Draw(art)
    title = "SmartSleeve Quantitative Trading Systems"
    font = fit_font(draw, title, 3920, 238)
    bbox = draw.textbbox((0, 0), title, font=font)
    text_w = bbox[2] - bbox[0]
    x = int((4500 - text_w) / 2)
    y = 3235

    glow = Image.new("RGBA", art.size, (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow)
    for offset in range(14, 0, -3):
        gdraw.text(
            (x, y),
            title,
            font=font,
            fill=(57, 255, 20, 18 + offset * 3),
            stroke_width=offset // 2,
            stroke_fill=(57, 255, 20, 20),
        )
    art.alpha_composite(glow.filter(ImageFilter.GaussianBlur(5)))
    draw.text((x, y), title, font=font, fill=GREEN)

    line_left = 560
    line_right = 3940
    glow_line(art, (line_left, y - 210, line_right, y - 210), GREEN_DIM, 10)
    glow_line(art, (line_left, y + 335, line_right, y + 335), GREEN_DIM, 10)
    for cx in (1125, 2250, 3375):
        draw.ellipse((cx - 24, y - 234, cx + 24, y - 186), fill=GREEN)
        draw.ellipse((cx - 24, y + 311, cx + 24, y + 359), fill=GREEN)

    art.save(OUT / "smartsleeve-ss-front-print.png")


def draw_wrapped_text(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    text: str,
    font: ImageFont.FreeTypeFont,
    fill: tuple[int, int, int, int],
    max_width: int,
    line_gap: int,
) -> int:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = (current + " " + word).strip()
        bbox = draw.textbbox((0, 0), candidate, font=font)
        if current and bbox[2] - bbox[0] > max_width:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)

    x, y = xy
    for line in lines:
        draw.text((x, y), line, font=font, fill=fill)
        bbox = draw.textbbox((0, 0), line, font=font)
        y += bbox[3] - bbox[1] + line_gap
    return y


def make_ss_preview() -> None:
    source = Image.open(OUT / "smartsleeve-ss-front-print.png").convert("RGBA")
    preview = Image.new("RGBA", (1400, 1100), (3, 9, 26, 255))
    draw = ImageDraw.Draw(preview)

    shirt = Image.new("RGBA", (820, 820), (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shirt)
    sdraw.polygon(
        [(125, 120), (290, 55), (410, 145), (530, 55), (695, 120), (620, 355), (560, 315), (560, 755), (260, 755), (260, 315), (200, 355)],
        fill=(5, 8, 15, 255),
        outline=(57, 255, 20, 90),
    )
    sdraw.rounded_rectangle((255, 152, 565, 758), radius=36, fill=(1, 3, 10, 255), outline=(57, 255, 20, 60), width=2)
    preview.alpha_composite(shirt.filter(ImageFilter.GaussianBlur(0.2)), (80, 135))

    crop = source.crop((240, 430, 4260, 3920))
    art = crop.resize((520, int(crop.height * (520 / crop.width))), Image.Resampling.LANCZOS)
    if art.height > 455:
        art = art.resize((int(art.width * (455 / art.height)), 455), Image.Resampling.LANCZOS)
    centered_paste(preview, art, 490, 320)

    y = draw_wrapped_text(draw, (875, 210), "SmartSleeve SS Chip Tee", load_font(54, bold=True), TEXT_SOFT, 455, 6)
    draw.text((875, y + 20), "$19.99 + shipping", font=load_font(46, bold=True), fill=GREEN)
    draw_wrapped_text(
        draw,
        (875, y + 92),
        "Black tee with the double-S silicon-chip mark and SQTS lockup.",
        load_font(32),
        (167, 183, 200, 255),
        445,
        5,
    )
    draw.text((905, 745), "Preview render", font=load_font(28, bold=True), fill=(57, 255, 20, 210))
    draw_wrapped_text(
        draw,
        (905, 788),
        "Upload the print PNG to Printful to generate exact production mockups.",
        load_font(22),
        (167, 183, 200, 255),
        370,
        4,
    )
    preview.save(OUT / "smartsleeve-ss-tee-preview.png")


def make_ss_tank_preview() -> None:
    source = Image.open(OUT / "smartsleeve-ss-front-print.png").convert("RGBA")
    preview = Image.new("RGBA", (1400, 1100), (3, 9, 26, 255))
    draw = ImageDraw.Draw(preview)

    tank = Image.new("RGBA", (820, 820), (0, 0, 0, 0))
    tdraw = ImageDraw.Draw(tank)
    tdraw.polygon(
        [
            (250, 70),
            (350, 70),
            (382, 210),
            (438, 210),
            (470, 70),
            (570, 70),
            (642, 220),
            (585, 760),
            (235, 760),
            (178, 220),
        ],
        fill=(5, 8, 15, 255),
        outline=(57, 255, 20, 90),
    )
    tdraw.pieslice((275, 48, 545, 270), start=0, end=180, fill=(3, 9, 26, 255))
    tdraw.arc((276, 48, 544, 270), start=0, end=180, fill=(57, 255, 20, 90), width=3)
    tdraw.rounded_rectangle(
        (236, 214, 584, 760),
        radius=28,
        fill=(1, 3, 10, 255),
        outline=(57, 255, 20, 54),
        width=2,
    )
    preview.alpha_composite(tank.filter(ImageFilter.GaussianBlur(0.2)), (82, 135))

    crop = source.crop((260, 470, 4240, 3890))
    art = crop.resize((455, int(crop.height * (455 / crop.width))), Image.Resampling.LANCZOS)
    if art.height > 395:
        art = art.resize((int(art.width * (395 / art.height)), 395), Image.Resampling.LANCZOS)
    centered_paste(preview, art, 492, 340)

    y = draw_wrapped_text(
        draw,
        (875, 210),
        "SmartSleeve SS Chip Tank",
        load_font(54, bold=True),
        TEXT_SOFT,
        455,
        6,
    )
    draw.text((875, y + 20), "$19.99 + shipping", font=load_font(46, bold=True), fill=GREEN)
    draw_wrapped_text(
        draw,
        (875, y + 92),
        "Black tank top with the double-S chip mark and SmartSleeve lockup.",
        load_font(32),
        (167, 183, 200, 255),
        445,
        5,
    )
    draw.text((905, 745), "Preview render", font=load_font(28, bold=True), fill=(57, 255, 20, 210))
    draw_wrapped_text(
        draw,
        (905, 788),
        "Use Printful's exact black tank mockups after the variants are selected.",
        load_font(22),
        (167, 183, 200, 255),
        370,
        4,
    )
    preview.save(OUT / "smartsleeve-ss-tank-preview.png")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    make_ss_front_art()
    make_ss_preview()
    make_ss_tank_preview()


if __name__ == "__main__":
    main()
