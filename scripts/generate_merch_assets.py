#!/usr/bin/env python3
"""Generate SmartSleeve public shop merch artwork."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "merch"
BLACK = (2, 6, 23, 255)
TRANSPARENT = (0, 0, 0, 0)
GREEN = (57, 255, 20, 255)
GREEN_DIM = (57, 255, 20, 150)
TEXT_SOFT = (205, 255, 210, 255)
WHITE = (245, 247, 250, 255)
WHITE_SOFT = (226, 232, 240, 255)
SLOGAN = "Quantitative trading for the agentic age."
SITE_URL = "smartsleeve.ai"
SITE_QR_URL = "https://smartsleeve.ai"
PRINT_DPI = 300
QR_PRINT_INCHES = 3.25
QR_PRINT_PX = round(PRINT_DPI * QR_PRINT_INCHES)
BACK_URL_SIZE_MULTIPLIER = 1.18


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


def fit_font(
    draw: ImageDraw.ImageDraw,
    text: str,
    max_width: int,
    start_size: int,
    *,
    bold: bool = False,
    min_size: int = 24,
) -> ImageFont.FreeTypeFont:
    size = start_size
    while size > min_size:
        font = load_font(size, bold=bold)
        bbox = draw.textbbox((0, 0), text, font=font)
        if bbox[2] - bbox[0] <= max_width:
            return font
        size -= 3
    return load_font(size, bold=bold)


def centered_paste(base: Image.Image, overlay: Image.Image, center_x: int, top: int) -> None:
    base.alpha_composite(overlay.convert("RGBA"), (round(center_x - overlay.width / 2), top))


def crop_green_subject(image: Image.Image, margin: int = 28) -> Image.Image:
    """Crop source artwork to the actual neon-green subject, not its padded canvas."""
    rgba = image.convert("RGBA")
    pixels = rgba.load()
    width, height = rgba.size
    xs: list[int] = []
    ys: list[int] = []
    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            if a > 20 and g > 80 and g > r * 1.2 and g > b * 1.2:
                xs.append(x)
                ys.append(y)
    if not xs:
        return rgba
    left = max(0, min(xs) - margin)
    top = max(0, min(ys) - margin)
    right = min(width, max(xs) + margin + 1)
    bottom = min(height, max(ys) + margin + 1)
    return rgba.crop((left, top, right, bottom))


def transparentize_dark_background(image: Image.Image, *, threshold: int = 38, green_floor: int = 24) -> Image.Image:
    """Drop near-black logo backplates while preserving neon glow pixels."""
    rgba = image.convert("RGBA")
    pixels = rgba.load()
    for y in range(rgba.height):
        for x in range(rgba.width):
            r, g, b, a = pixels[x, y]
            if a == 0:
                continue
            max_channel = max(r, g, b)
            is_green_glow = g > green_floor and g > r * 1.25 and g > b * 1.15
            is_light_detail = max_channel > 120
            if is_green_glow or is_light_detail:
                continue
            if max_channel <= threshold:
                pixels[x, y] = (r, g, b, 0)
            elif max_channel < threshold + 54:
                fade = (max_channel - threshold) / 54
                pixels[x, y] = (r, g, b, round(a * fade * 0.45))
    return rgba


def glow_line(base: Image.Image, xy: tuple[int, int, int, int], fill: tuple[int, int, int, int], width: int) -> None:
    glow = Image.new("RGBA", base.size, TRANSPARENT)
    gdraw = ImageDraw.Draw(glow)
    gdraw.line(xy, fill=fill, width=width * 4)
    base.alpha_composite(glow.filter(ImageFilter.GaussianBlur(width * 2)))
    ImageDraw.Draw(base).line(xy, fill=fill, width=width)


def draw_centered_glow_text(
    image: Image.Image,
    text: str,
    center_x: int,
    y: int,
    font: ImageFont.FreeTypeFont,
    fill: tuple[int, int, int, int],
    *,
    glow_fill: tuple[int, int, int, int] | None = None,
    stroke: int = 0,
) -> tuple[int, int, int, int]:
    draw = ImageDraw.Draw(image)
    bbox = draw.textbbox((0, 0), text, font=font, stroke_width=stroke)
    x = round(center_x - (bbox[2] - bbox[0]) / 2)
    if glow_fill:
        glow = Image.new("RGBA", image.size, TRANSPARENT)
        gdraw = ImageDraw.Draw(glow)
        for offset in range(16, 0, -4):
            gdraw.text(
                (x, y),
                text,
                font=font,
                fill=(glow_fill[0], glow_fill[1], glow_fill[2], 18 + offset * 3),
                stroke_width=max(1, offset // 3),
                stroke_fill=(glow_fill[0], glow_fill[1], glow_fill[2], 24),
            )
        image.alpha_composite(glow.filter(ImageFilter.GaussianBlur(5)))
    draw.text((x, y), text, font=font, fill=fill, stroke_width=stroke, stroke_fill=fill)
    return (x, y, x + bbox[2] - bbox[0], y + bbox[3] - bbox[1])


def draw_neon_lockup_text(
    image: Image.Image,
    text: str,
    y: int,
    *,
    max_width: int,
    start_size: int,
    line_left: int,
    line_right: int,
    top_line_offset: int = 210,
    bottom_line_offset: int = 335,
) -> tuple[int, int, int, int]:
    draw = ImageDraw.Draw(image)
    font = fit_font(draw, text, max_width, start_size, min_size=36)
    bbox = draw_centered_glow_text(image, text, image.width // 2, y, font, GREEN, glow_fill=GREEN)
    top_line_y = y - top_line_offset
    bottom_line_y = y + bottom_line_offset
    glow_line(image, (line_left, top_line_y, line_right, top_line_y), GREEN_DIM, 10)
    glow_line(image, (line_left, bottom_line_y, line_right, bottom_line_y), GREEN_DIM, 10)
    draw = ImageDraw.Draw(image)
    for cx in (line_left + (line_right - line_left) // 4, image.width // 2, line_right - (line_right - line_left) // 4):
        draw.ellipse((cx - 24, top_line_y - 24, cx + 24, top_line_y + 24), fill=GREEN)
        draw.ellipse((cx - 24, bottom_line_y - 24, cx + 24, bottom_line_y + 24), fill=GREEN)
    return bbox


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


def gf_tables() -> tuple[list[int], list[int]]:
    exp = [0] * 512
    log = [0] * 256
    x = 1
    for i in range(255):
        exp[i] = x
        log[x] = i
        x <<= 1
        if x & 0x100:
            x ^= 0x11D
    for i in range(255, 512):
        exp[i] = exp[i - 255]
    return exp, log


GF_EXP, GF_LOG = gf_tables()


def gf_mul(a: int, b: int) -> int:
    if a == 0 or b == 0:
        return 0
    return GF_EXP[GF_LOG[a] + GF_LOG[b]]


def poly_mul(a: list[int], b: list[int]) -> list[int]:
    result = [0] * (len(a) + len(b) - 1)
    for i, av in enumerate(a):
        for j, bv in enumerate(b):
            result[i + j] ^= gf_mul(av, bv)
    return result


def rs_generator(degree: int) -> list[int]:
    gen = [1]
    for i in range(degree):
        gen = poly_mul(gen, [1, GF_EXP[i]])
    return gen


def rs_remainder(data: list[int], degree: int) -> list[int]:
    gen = rs_generator(degree)
    result = [0] * degree
    for byte in data:
        factor = byte ^ result[0]
        result = result[1:] + [0]
        for i in range(degree):
            result[i] ^= gf_mul(gen[i + 1], factor)
    return result


def bits_from_int(value: int, width: int) -> list[int]:
    return [((value >> shift) & 1) for shift in range(width - 1, -1, -1)]


def qr_data_codewords(payload: str) -> list[int]:
    data = payload.encode("utf-8")
    bits: list[int] = []
    bits.extend([0, 1, 0, 0])  # Byte mode.
    bits.extend(bits_from_int(len(data), 8))
    for byte in data:
        bits.extend(bits_from_int(byte, 8))
    capacity_bits = 34 * 8  # QR version 2-L.
    bits.extend([0] * min(4, capacity_bits - len(bits)))
    while len(bits) % 8:
        bits.append(0)
    codewords = [int("".join(str(bit) for bit in bits[i : i + 8]), 2) for i in range(0, len(bits), 8)]
    pads = [0xEC, 0x11]
    index = 0
    while len(codewords) < 34:
        codewords.append(pads[index % 2])
        index += 1
    return codewords


def qr_format_bits(mask: int) -> int:
    # Error correction level L is encoded as 01.
    data = (1 << 3) | mask
    rem = data
    for _ in range(10):
        rem = (rem << 1) ^ ((rem >> 9) * 0x537)
    return ((data << 10) | (rem & 0x3FF)) ^ 0x5412


def qr_mask(mask: int, x: int, y: int) -> bool:
    return (
        (x + y) % 2 == 0
        if mask == 0
        else y % 2 == 0
        if mask == 1
        else x % 3 == 0
        if mask == 2
        else (x + y) % 3 == 0
        if mask == 3
        else ((y // 2) + (x // 3)) % 2 == 0
        if mask == 4
        else ((x * y) % 2 + (x * y) % 3) == 0
        if mask == 5
        else (((x * y) % 2 + (x * y) % 3) % 2) == 0
        if mask == 6
        else (((x + y) % 2 + (x * y) % 3) % 2) == 0
    )


def draw_finder(modules: list[list[bool]], function: list[list[bool]], x: int, y: int) -> None:
    size = len(modules)
    for dy in range(-1, 8):
        for dx in range(-1, 8):
            xx, yy = x + dx, y + dy
            if not (0 <= xx < size and 0 <= yy < size):
                continue
            function[yy][xx] = True
            modules[yy][xx] = (
                0 <= dx <= 6
                and 0 <= dy <= 6
                and (dx in (0, 6) or dy in (0, 6) or (2 <= dx <= 4 and 2 <= dy <= 4))
            )


def draw_alignment(modules: list[list[bool]], function: list[list[bool]], cx: int, cy: int) -> None:
    for dy in range(-2, 3):
        for dx in range(-2, 3):
            xx, yy = cx + dx, cy + dy
            function[yy][xx] = True
            modules[yy][xx] = max(abs(dx), abs(dy)) != 1


def reserve_format(modules: list[list[bool]], function: list[list[bool]]) -> None:
    size = len(modules)

    def set_func(x: int, y: int, value: bool = False) -> None:
        modules[y][x] = value
        function[y][x] = True

    for i in range(6):
        set_func(8, i)
    set_func(8, 7)
    set_func(8, 8)
    set_func(7, 8)
    for i in range(9, 15):
        set_func(14 - i, 8)
    for i in range(8):
        set_func(size - 1 - i, 8)
    for i in range(8, 15):
        set_func(8, size - 15 + i)
    set_func(8, size - 8, True)


def draw_format(modules: list[list[bool]], mask: int) -> None:
    size = len(modules)
    bits = qr_format_bits(mask)

    def bit(i: int) -> bool:
        return ((bits >> i) & 1) != 0

    for i in range(6):
        modules[i][8] = bit(i)
    modules[7][8] = bit(6)
    modules[8][8] = bit(7)
    modules[8][7] = bit(8)
    for i in range(9, 15):
        modules[8][14 - i] = bit(i)
    for i in range(8):
        modules[8][size - 1 - i] = bit(i)
    for i in range(8, 15):
        modules[size - 15 + i][8] = bit(i)
    modules[size - 8][8] = True


def qr_penalty(modules: list[list[bool]]) -> int:
    size = len(modules)
    penalty = 0
    for rows in (modules, [[modules[y][x] for y in range(size)] for x in range(size)]):
        for row in rows:
            run_color = row[0]
            run_len = 1
            for value in row[1:]:
                if value == run_color:
                    run_len += 1
                    continue
                if run_len >= 5:
                    penalty += 3 + run_len - 5
                run_color = value
                run_len = 1
            if run_len >= 5:
                penalty += 3 + run_len - 5
            for i in range(size - 10):
                window = row[i : i + 11]
                if window in (
                    [True, False, True, True, True, False, True, False, False, False, False],
                    [False, False, False, False, True, False, True, True, True, False, True],
                ):
                    penalty += 40
    for y in range(size - 1):
        for x in range(size - 1):
            color = modules[y][x]
            if modules[y][x + 1] == color and modules[y + 1][x] == color and modules[y + 1][x + 1] == color:
                penalty += 3
    dark = sum(1 for row in modules for value in row if value)
    total = size * size
    k = abs(dark * 20 - total * 10) // total
    penalty += k * 10
    return penalty


def qr_matrix(payload: str) -> list[list[bool]]:
    size = 25  # Version 2.
    data = qr_data_codewords(payload)
    full_codewords = data + rs_remainder(data, 10)
    bitstream: list[bool] = []
    for codeword in full_codewords:
        bitstream.extend(bool((codeword >> shift) & 1) for shift in range(7, -1, -1))

    modules = [[False] * size for _ in range(size)]
    function = [[False] * size for _ in range(size)]
    draw_finder(modules, function, 0, 0)
    draw_finder(modules, function, size - 7, 0)
    draw_finder(modules, function, 0, size - 7)
    draw_alignment(modules, function, 18, 18)
    for i in range(8, size - 8):
        modules[6][i] = i % 2 == 0
        modules[i][6] = i % 2 == 0
        function[6][i] = True
        function[i][6] = True
    reserve_format(modules, function)

    bit_index = 0
    y = size - 1
    direction = -1
    x = size - 1
    while x > 0:
        if x == 6:
            x -= 1
        while True:
            for dx in (0, 1):
                xx = x - dx
                if not function[y][xx]:
                    modules[y][xx] = bitstream[bit_index] if bit_index < len(bitstream) else False
                    bit_index += 1
            y += direction
            if y < 0 or y >= size:
                y -= direction
                direction = -direction
                break
        x -= 2

    best_modules: list[list[bool]] | None = None
    best_penalty = 10**9
    for mask in range(8):
        candidate = [row[:] for row in modules]
        for yy in range(size):
            for xx in range(size):
                if not function[yy][xx] and qr_mask(mask, xx, yy):
                    candidate[yy][xx] = not candidate[yy][xx]
        draw_format(candidate, mask)
        penalty = qr_penalty(candidate)
        if penalty < best_penalty:
            best_penalty = penalty
            best_modules = candidate
    assert best_modules is not None
    return best_modules


def render_qr_png(path: Path, payload: str, size_px: int = 1200) -> Image.Image:
    matrix = qr_matrix(payload)
    modules = len(matrix)
    border = 4
    module_px = size_px // (modules + border * 2)
    canvas_px = module_px * (modules + border * 2)
    qr = Image.new("RGBA", (canvas_px, canvas_px), WHITE)
    draw = ImageDraw.Draw(qr)
    for y, row in enumerate(matrix):
        for x, value in enumerate(row):
            if value:
                x0 = (x + border) * module_px
                y0 = (y + border) * module_px
                draw.rectangle((x0, y0, x0 + module_px - 1, y0 + module_px - 1), fill=(0, 0, 0, 255))
    if canvas_px != size_px:
        qr = qr.resize((size_px, size_px), Image.Resampling.NEAREST)
    qr.save(path)
    return qr


def make_sqts_llc_logo() -> None:
    source = Image.open(ROOT / "sqts-logo-green.png").convert("RGBA")
    logo = Image.new("RGBA", (1200, 512), TRANSPARENT)
    logo.alpha_composite(transparentize_dark_background(source.crop((0, 0, 1200, 342))), (0, 0))

    draw = ImageDraw.Draw(logo)
    text = "SmartSleeve Quantitative Trading Systems, LLC"
    font = fit_font(draw, text, 1010, 42, min_size=28)
    draw_centered_glow_text(logo, text, 600, 340, font, GREEN, glow_fill=GREEN)
    glow_line(logo, (138, 394, 1062, 394), GREEN_DIM, 4)
    glow_line(logo, (138, 430, 1062, 430), GREEN_DIM, 4)
    for cx in (285, 600, 915):
        draw.ellipse((cx - 8, 386, cx + 8, 402), fill=GREEN)
        draw.ellipse((cx - 8, 422, cx + 8, 438), fill=GREEN)
    logo.save(ROOT / "sqts-logo-green-llc.png")
    logo.save(ROOT / "sqts-logo-green.png")


def make_sqts_llc_front_art() -> None:
    logo = Image.open(ROOT / "sqts-logo-green-llc.png").convert("RGBA")
    art = Image.new("RGBA", (4500, 5400), TRANSPARENT)
    logo = logo.resize((4000, 1707), Image.Resampling.LANCZOS)
    centered_paste(art, logo, 2250, 500)
    slogan_font = fit_font(ImageDraw.Draw(art), SLOGAN, 4100, 235, min_size=100)
    draw_centered_glow_text(art, SLOGAN, 2250, 2145, slogan_font, WHITE, glow_fill=(255, 255, 255, 255))
    art.save(OUT / "sqts-llc-front-print.png")


def make_ss_short_front_art() -> None:
    icon_source = transparentize_dark_background(
        Image.open(ROOT / "favicon-512x512.png").convert("RGBA"),
        threshold=72,
        green_floor=76,
    )
    icon = crop_green_subject(icon_source)
    for filename, vertical_shift, lockup_lift in (
        ("smartsleeve-ss-short-front-print.png", 0, 0),
        ("smartsleeve-ss-tank-front-print.png", 320, 95),
    ):
        art = Image.new("RGBA", (4500, 5400), TRANSPARENT)
        icon_width = 2350
        placed_icon = icon.resize((icon_width, round(icon.height * (icon_width / icon.width))), Image.Resampling.LANCZOS)
        centered_paste(art, placed_icon, 2250, 360 + vertical_shift)
        draw_neon_lockup_text(
            art,
            "SmartSleeve",
            1815 + vertical_shift - lockup_lift,
            max_width=4000,
            start_size=395,
            line_left=430,
            line_right=4070,
            top_line_offset=140,
            bottom_line_offset=350,
        )
        slogan_font = fit_font(ImageDraw.Draw(art), SLOGAN, 4100, 230, min_size=100)
        draw_centered_glow_text(
            art,
            SLOGAN,
            2250,
            2350 + vertical_shift - lockup_lift,
            slogan_font,
            WHITE,
            glow_fill=(255, 255, 255, 255),
        )
        art.save(OUT / filename)


def make_back_art() -> None:
    blank = Image.new("RGBA", (4500, 5400), TRANSPARENT)
    blank.save(OUT / "smartsleeve-back-blank-print.png")

    def save_back_variant(filename: str, *, qr: bool, url_y: int, qr_top: int) -> Image.Image:
        art = Image.new("RGBA", (4500, 5400), TRANSPARENT)
        # Keep the back URL at upper-back / chest-print height, visually aligned
        # with the SS chip centers on the front design.
        url_font = fit_font(
            ImageDraw.Draw(art),
            SITE_URL,
            round(2700 * BACK_URL_SIZE_MULTIPLIER),
            round(340 * BACK_URL_SIZE_MULTIPLIER),
            bold=True,
            min_size=120,
        )
        draw_centered_glow_text(art, SITE_URL, 2250, url_y, url_font, WHITE, glow_fill=(255, 255, 255, 255))
        if qr:
            qr_image = Image.open(OUT / "smartsleeve-ai-qr.png").convert("RGBA").resize(
                (QR_PRINT_PX, QR_PRINT_PX),
                Image.Resampling.NEAREST,
            )
            centered_paste(art, qr_image, 2250, qr_top)
        art.save(OUT / filename)
        return art

    tee_back = save_back_variant("ss_and_sqts_tee_back_print.png", qr=False, url_y=960, qr_top=1590)
    tee_back.save(OUT / "smartsleeve-back-print.png")
    tee_back_qr = save_back_variant("ss_and_sqts_tee_back_qr_print.png", qr=True, url_y=960, qr_top=1590)
    tee_back_qr.save(OUT / "smartsleeve-back-qr-print.png")
    tank_back = save_back_variant("ss_and_sqts_tank_back_print.png", qr=False, url_y=1280, qr_top=1910)
    tank_back.save(OUT / "smartsleeve-tank-back-print.png")
    tank_back_qr = save_back_variant("ss_and_sqts_tank_back_qr_print.png", qr=True, url_y=1280, qr_top=1910)
    tank_back_qr.save(OUT / "smartsleeve-tank-back-qr-print.png")


def make_legacy_ss_front_art() -> None:
    """Keep a compatibility copy for existing checkout references."""
    source = Image.open(OUT / "smartsleeve-ss-short-front-print.png").convert("RGBA")
    source.save(OUT / "smartsleeve-ss-front-print.png")


def draw_garment(draw: ImageDraw.ImageDraw, kind: str, x: int, y: int, w: int, h: int) -> None:
    if kind == "tank":
        points = [
            (x + int(w * 0.30), y + int(h * 0.03)),
            (x + int(w * 0.42), y + int(h * 0.03)),
            (x + int(w * 0.46), y + int(h * 0.20)),
            (x + int(w * 0.54), y + int(h * 0.20)),
            (x + int(w * 0.58), y + int(h * 0.03)),
            (x + int(w * 0.70), y + int(h * 0.03)),
            (x + int(w * 0.80), y + int(h * 0.20)),
            (x + int(w * 0.73), y + int(h * 0.94)),
            (x + int(w * 0.27), y + int(h * 0.94)),
            (x + int(w * 0.20), y + int(h * 0.20)),
        ]
        draw.polygon(points, fill=(5, 8, 15, 255), outline=(57, 255, 20, 90))
        draw.arc((x + int(w * 0.34), y, x + int(w * 0.66), y + int(h * 0.26)), 0, 180, fill=(57, 255, 20, 90), width=3)
    else:
        points = [
            (x + int(w * 0.15), y + int(h * 0.13)),
            (x + int(w * 0.36), y + int(h * 0.04)),
            (x + int(w * 0.50), y + int(h * 0.16)),
            (x + int(w * 0.64), y + int(h * 0.04)),
            (x + int(w * 0.85), y + int(h * 0.13)),
            (x + int(w * 0.76), y + int(h * 0.36)),
            (x + int(w * 0.69), y + int(h * 0.31)),
            (x + int(w * 0.69), y + int(h * 0.93)),
            (x + int(w * 0.31), y + int(h * 0.93)),
            (x + int(w * 0.31), y + int(h * 0.31)),
            (x + int(w * 0.24), y + int(h * 0.36)),
        ]
        draw.polygon(points, fill=(5, 8, 15, 255), outline=(57, 255, 20, 90))
        draw.rounded_rectangle(
            (x + int(w * 0.31), y + int(h * 0.17), x + int(w * 0.69), y + int(h * 0.93)),
            radius=24,
            fill=(1, 3, 10, 255),
            outline=(57, 255, 20, 55),
            width=2,
        )


def make_preview(
    filename: str,
    title: str,
    front_art_path: Path,
    back_art_path: Path,
    *,
    kind: str,
    subtitle: str,
    promo: bool = False,
    back_style: str = "url",
    front_top: int = 320,
    back_url_y: int = 382,
    back_qr_top: int = 500,
) -> None:
    preview = Image.new("RGBA", (1400, 1100), (3, 9, 26, 255))
    draw = ImageDraw.Draw(preview)

    for label, path, x in (("Front", front_art_path, 80), ("Back", back_art_path, 440)):
        draw_garment(draw, kind, x, 185, 430, 650)
        if label == "Back":
            if back_style != "blank":
                url_font = fit_font(draw, SITE_URL, 205, 46, bold=True, min_size=24)
                draw_centered_glow_text(preview, SITE_URL, x + 215, back_url_y, url_font, WHITE, glow_fill=(255, 255, 255, 255))
            if promo or back_style == "qr":
                qr = Image.open(OUT / "smartsleeve-ai-qr.png").convert("RGBA").resize((108, 108), Image.Resampling.NEAREST)
                centered_paste(preview, qr, x + 215, back_qr_top)
        else:
            art = Image.open(path).convert("RGBA")
            bbox = art.getbbox()
            if bbox:
                art = art.crop(bbox)
            target_w = 295
            target_h = 390
            ratio = min(target_w / art.width, target_h / art.height)
            art = art.resize((max(1, int(art.width * ratio)), max(1, int(art.height * ratio))), Image.Resampling.LANCZOS)
            centered_paste(preview, art, x + 215, front_top)
        draw.text((x + 170, 860), label, font=load_font(28, bold=True), fill=(167, 183, 200, 255))

    y = draw_wrapped_text(draw, (850, 205), title, load_font(52, bold=True), TEXT_SOFT, 455, 6)
    draw.text((850, y + 20), "$19.99 + shipping", font=load_font(44, bold=True), fill=GREEN)
    draw_wrapped_text(draw, (850, y + 92), subtitle, load_font(30), (167, 183, 200, 255), 455, 5)
    badge = (
        "Brand blank back"
        if back_style == "blank"
        else "QR promo back"
        if promo or back_style == "qr"
        else "Website promo back"
    )
    draw.text((880, 754), badge, font=load_font(30, bold=True), fill=(57, 255, 20, 215))
    draw_wrapped_text(
        draw,
        (880, 802),
        "Production art is split into front and back PNGs for Printful placement.",
        load_font(23),
        (167, 183, 200, 255),
        390,
        4,
    )
    preview.save(OUT / filename)


def make_all_previews() -> None:
    blank_back = OUT / "smartsleeve-back-blank-print.png"
    standard_back = OUT / "ss_and_sqts_tee_back_print.png"
    promo_back = OUT / "ss_and_sqts_tee_back_qr_print.png"
    tank_back = OUT / "ss_and_sqts_tank_back_print.png"
    tank_promo_back = OUT / "ss_and_sqts_tank_back_qr_print.png"
    ss_front = OUT / "smartsleeve-ss-short-front-print.png"
    ss_tank_front = OUT / "smartsleeve-ss-tank-front-print.png"
    sqts_front = OUT / "sqts-llc-front-print.png"
    make_preview(
        "smartsleeve-ss-tee-brand-preview.png",
        "SmartSleeve SS Tee Brand",
        ss_front,
        blank_back,
        kind="tee",
        subtitle="Black tee with the SS chip mark, SmartSleeve lockup, and slogan front. Blank back.",
        back_style="blank",
    )
    make_preview(
        "smartsleeve-ss-tee-preview.png",
        "SmartSleeve SS Tee Website",
        ss_front,
        standard_back,
        kind="tee",
        subtitle="Black tee with the SS chip mark, SmartSleeve lockup, slogan front, and site URL back.",
        back_url_y=346,
    )
    make_preview(
        "smartsleeve-ss-tee-website-preview.png",
        "SmartSleeve SS Tee Website",
        ss_front,
        standard_back,
        kind="tee",
        subtitle="Black tee with the SS chip mark, SmartSleeve lockup, slogan front, and site URL back.",
        back_url_y=346,
    )
    make_preview(
        "smartsleeve-ss-tank-brand-preview.png",
        "SmartSleeve SS Tank Brand",
        ss_tank_front,
        blank_back,
        kind="tank",
        subtitle="Black tank with the SS chip mark, SmartSleeve lockup, and slogan front. Blank back.",
        back_style="blank",
        front_top=369,
    )
    make_preview(
        "smartsleeve-ss-tank-preview.png",
        "SmartSleeve SS Tank Website",
        ss_tank_front,
        tank_back,
        kind="tank",
        subtitle="Black tank with the SS chip mark, SmartSleeve lockup, slogan front, and site URL back.",
        front_top=369,
        back_url_y=430,
    )
    make_preview(
        "smartsleeve-ss-tank-website-preview.png",
        "SmartSleeve SS Tank Website",
        ss_tank_front,
        tank_back,
        kind="tank",
        subtitle="Black tank with the SS chip mark, SmartSleeve lockup, slogan front, and site URL back.",
        front_top=369,
        back_url_y=430,
    )
    make_preview(
        "sqts-llc-tee-brand-preview.png",
        "SQTS LLC Tee Brand",
        sqts_front,
        blank_back,
        kind="tee",
        subtitle="Black tee with the official SQTS LLC banner and slogan front. Blank back.",
        back_style="blank",
    )
    make_preview(
        "sqts-llc-tee-preview.png",
        "SQTS LLC Tee Website",
        sqts_front,
        standard_back,
        kind="tee",
        subtitle="Black tee with the official SQTS LLC banner, slogan front, and site URL back.",
        back_url_y=316,
    )
    make_preview(
        "sqts-llc-tee-website-preview.png",
        "SQTS LLC Tee Website",
        sqts_front,
        standard_back,
        kind="tee",
        subtitle="Black tee with the official SQTS LLC banner, slogan front, and site URL back.",
        back_url_y=316,
    )
    make_preview(
        "sqts-llc-tank-brand-preview.png",
        "SQTS LLC Tank Brand",
        sqts_front,
        blank_back,
        kind="tank",
        subtitle="Black tank with the official SQTS LLC banner and slogan front. Blank back.",
        back_style="blank",
        front_top=372,
    )
    make_preview(
        "sqts-llc-tank-preview.png",
        "SQTS LLC Tank Website",
        sqts_front,
        tank_back,
        kind="tank",
        subtitle="Black tank with the official SQTS LLC banner, slogan front, and site URL back.",
        front_top=372,
        back_url_y=430,
    )
    make_preview(
        "sqts-llc-tank-website-preview.png",
        "SQTS LLC Tank Website",
        sqts_front,
        tank_back,
        kind="tank",
        subtitle="Black tank with the official SQTS LLC banner, slogan front, and site URL back.",
        front_top=372,
        back_url_y=430,
    )
    make_preview(
        "smartsleeve-ss-tee-promo-preview.png",
        "SS Tee QR Promo",
        ss_front,
        promo_back,
        kind="tee",
        subtitle="Same SS front design with a scan-ready QR code on the back for in-person promotion.",
        promo=True,
        back_style="qr",
        back_url_y=346,
        back_qr_top=452,
    )
    make_preview(
        "smartsleeve-ss-tank-promo-preview.png",
        "SS Tank QR Promo",
        ss_tank_front,
        tank_promo_back,
        kind="tank",
        subtitle="Same SS tank design with a scan-ready QR code on the back for in-person promotion.",
        promo=True,
        back_style="qr",
        front_top=369,
        back_url_y=430,
        back_qr_top=548,
    )
    make_preview(
        "sqts-llc-tee-promo-preview.png",
        "SQTS Tee QR Promo",
        sqts_front,
        promo_back,
        kind="tee",
        subtitle="Same SQTS LLC front design with a scan-ready QR code on the back for in-person promotion.",
        promo=True,
        back_style="qr",
        back_url_y=316,
        back_qr_top=422,
    )
    make_preview(
        "sqts-llc-tank-promo-preview.png",
        "SQTS Tank QR Promo",
        sqts_front,
        tank_promo_back,
        kind="tank",
        subtitle="Same SQTS LLC tank design with a scan-ready QR code on the back for in-person promotion.",
        promo=True,
        back_style="qr",
        front_top=372,
        back_url_y=430,
        back_qr_top=548,
    )


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    make_sqts_llc_logo()
    render_qr_png(OUT / "smartsleeve-ai-qr.png", SITE_QR_URL)
    make_sqts_llc_front_art()
    make_ss_short_front_art()
    make_back_art()
    make_legacy_ss_front_art()
    make_all_previews()


if __name__ == "__main__":
    main()
