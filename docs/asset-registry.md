# SmartSleeve Asset Registry

Last updated: 2026-07-10

This file is the source-of-truth map for brand and merch artwork. When in doubt, use the canonical source files below and regenerate derivatives instead of choosing a random PNG from `brand/`, `merch/`, or `merch/proofs/`.

## Canonical SS SmartSleeve Asset

- Editable source: `brand/smartsleeve-ss-current-best.svg`
- Human proof: `brand/smartsleeve-ss-current-best-proof.png`
- High-res human proof: `brand/smartsleeve-ss-current-best-proof-hires.png`
- Transparent production render: `brand/smartsleeve-ss-current-best-print-transparent.png`
- Immutable Printful apparel file: `merch/smartsleeve-ss-approved-tight-front-print.png`

This is the approved tight-spacing SS lockup: no dark green haze, white `SmartSleeve`, white slogan, and no period after `Quantitative trading for the agentic age`.

Do not use `brand/smartsleeve-apparel-logo-cropped.png` for current merch or homepage banners. It is a legacy green-wordmark/period-era asset.

## Canonical SQTS Assets

- Website banner: `sqts-logo-green-llc.png`
- Merch front print: `merch/sqts-llc-common-front-print.png`

The SQTS website banner and merch lockup are intentionally separate. The website uses the slimmer original banner; the SQTS merch products use the approved apparel artwork. Do not regenerate SQTS files during SS-only fixes unless the user explicitly asks.

## Generated SS Merch Derivatives

The active SS apparel front print files should all be regenerated from `brand/smartsleeve-ss-current-best.svg`:

- `merch/smartsleeve-ss-common-front-print.png`
- `merch/smartsleeve-ss-approved-tight-front-print.png` (immutable Printful upload name)
- `merch/smartsleeve-ss-short-front-print.png`
- `merch/smartsleeve-ss-tank-front-print.png`
- `merch/smartsleeve-ss-front-print.png`
- `merch/insets/smartsleeve-ss-shirt-detail.png`

These files are used by Printful product fronts and the public merch-store inlay/detail UI.

## Generated Website Derivatives

- Homepage banner: `brand/smartsleeve-ss-current-best-proof.png`
- About page SQTS banner: `sqts-logo-green-llc.png`

## Regeneration Notes

For an SS-only front-art correction, prefer a targeted regeneration of the SS files above. Avoid running the full merch generator in a dirty worktree because it may also rewrite unrelated preview, SQTS, outerwear, towel, or root logo files.

Rejected one-off SS spacing, haze, and font experiment files were quarantined outside the repo on 2026-07-10 at `/tmp/smartsleeve-asset-quarantine-20260710-140324`. The canonical files listed above supersede those experiments.

If the full generator is needed:

```bash
python3 scripts/generate_merch_assets.py
```

After regeneration, verify the rendered proof visually before any Printful upload.

## Printful Rule

Updating the repo is not enough. If SS apparel artwork changes, copy the approved print bytes to a new immutable, descriptive filename and update `FRONT_FILENAME` in `scripts/update_printful_ss_front_art.py`. Upload that exact file to every applicable SS Printful apparel design, then regenerate Printful mockups and sync them back into `merch/printful-storefront-catalog.json`. Never reuse a rejected artwork URL or an old storefront cache key.

Use `scripts/update_printful_ss_front_art.py --apply --sha <git-sha>` to replace SS tee, muscle tee, and tank fronts on Printful. The script skips SQTS, polos, fleeces, outerwear, towels, bandanas, and mousepads.

Use `scripts/generate_printful_mockups.py --force --asset-sha <git-sha> --product-regex 'smartsleeve-ss.*(tee|tank|muscle)' --exclude-regex '(polo|fleece|windbreaker|mousepad|towel|bandana)'` after the Printful update. The raw git SHA URL avoids Printful mockup-generator caching of stale `smartsleeve.ai/merch/...` assets.

Do not touch polos or fleeces for slogan-lockup updates; they use separate no-slogan chest assets.
