#!/usr/bin/env python3
"""Render every active SS slogan asset from the explicitly approved SVG."""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps

from generate_merch_assets import OUT, ROOT, TRANSPARENT, centered_paste, render_transparent_svg


SOURCE = ROOT / "brand" / "smartsleeve-ss-current-best.svg"
PROOF = ROOT / "brand" / "smartsleeve-ss-current-best-proof.png"
PROOF_HIRES = ROOT / "brand" / "smartsleeve-ss-current-best-proof-hires.png"
TRANSPARENT_RENDER = ROOT / "brand" / "smartsleeve-ss-current-best-print-transparent.png"
PRINTFUL_FILENAME = "smartsleeve-ss-approved-reference-v2-front-print.png"

# These coordinates reproduce the user-approved 1049x682 reference crop.
FULL_RENDER_SIZE = (7500, 3875)
PROOF_CROP = (1200, 0, 6350, 3240)
PROOF_SIZE = (5150, 3350)


def validate_source() -> None:
    source = SOURCE.read_text()
    required = (
        'transform="translate(0,322)"',
        'x="600" y="490"',
        '>SmartSleeve</text>',
        '>Quantitative trading for the agentic age</text>',
        'fill="#ffffff"',
    )
    missing = [value for value in required if value not in source]
    if missing:
        raise RuntimeError(f"Canonical SS SVG does not match approved geometry: {missing}")


def render_proofs() -> Image.Image:
    with tempfile.TemporaryDirectory() as temp_dir:
        full_render = Path(temp_dir) / "approved-ss-full.png"
        subprocess.run(
            [
                "/opt/homebrew/bin/inkscape",
                str(SOURCE),
                "--export-type=png",
                f"--export-filename={full_render}",
                "--export-width=7500",
                "--export-height=3875",
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        rendered = Image.open(full_render).convert("RGBA")
        cropped = rendered.crop(PROOF_CROP)

    proof = Image.new("RGBA", PROOF_SIZE, (0, 0, 0, 255))
    proof.alpha_composite(cropped, (0, PROOF_SIZE[1] - cropped.height))
    proof.convert("RGB").save(PROOF_HIRES, optimize=True)
    preview = proof.resize((1200, 781), Image.Resampling.LANCZOS)
    preview.convert("RGB").save(PROOF, optimize=True)
    return proof


def render_print_files() -> None:
    transparent = render_transparent_svg(SOURCE, width=6000)
    transparent.save(TRANSPARENT_RENDER, optimize=True)

    source_width = 3900
    source = transparent.resize(
        (source_width, round(transparent.height * source_width / transparent.width)),
        Image.Resampling.LANCZOS,
    )
    print_art = Image.new("RGBA", (4500, 5400), TRANSPARENT)
    centered_paste(print_art, source, 2250, 300)
    for filename in (
        "smartsleeve-ss-common-front-print.png",
        "smartsleeve-ss-short-front-print.png",
        "smartsleeve-ss-tank-front-print.png",
        "smartsleeve-ss-front-print.png",
        PRINTFUL_FILENAME,
    ):
        print_art.save(OUT / filename, optimize=True)


def render_inset(proof: Image.Image) -> None:
    inset = Image.new("RGB", (1200, 825), (2, 6, 10))
    draw = ImageDraw.Draw(inset, "RGBA")
    for x in range(20, 1181, 40):
        draw.line((x, 20, x, 805), fill=(57, 255, 20, 10), width=1)
    for y in range(20, 806, 40):
        draw.line((20, y, 1180, y), fill=(57, 255, 20, 10), width=1)
    fitted = ImageOps.contain(proof.convert("RGB"), (1140, 742), Image.Resampling.LANCZOS)
    inset.paste(fitted, ((1200 - fitted.width) // 2, (825 - fitted.height) // 2))
    draw.rounded_rectangle((18, 18, 1181, 806), radius=24, outline=(210, 220, 215, 110), width=2)
    inset.save(OUT / "insets" / "smartsleeve-ss-shirt-detail.png", optimize=True)


def main() -> None:
    validate_source()
    proof = render_proofs()
    render_print_files()
    render_inset(proof)
    print(f"Rendered approved SS asset and {PRINTFUL_FILENAME}")


if __name__ == "__main__":
    main()
