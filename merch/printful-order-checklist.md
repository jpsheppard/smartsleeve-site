# SmartSleeve Printful Order Checklist

Use this once the Chase business checking account is approved and Stripe/fulfillment can be wired through SmartSleeve Quantitative Trading Systems, LLC.

## First Real Test Order

The clean accounting flow should be:

`John Sheppard -> SmartSleeve Stripe Checkout -> SmartSleeve bank/ledger -> Printful fulfillment -> John Sheppard shipping address`

Do not accept public payments until this flow is tested end to end.

## Recommended First Products

Start with the SS designs first because they are the stronger consumer-facing brand mark:

- SmartSleeve SS Tee - Website
- SmartSleeve SS Tank - Website
- SmartSleeve SS Tee - Website QR
- SmartSleeve SS Tank - Website QR

Add the SQTS LLC variants once the first physical SS proofs look good.

## Upload Map

| Product | Front art | Back art |
| --- | --- | --- |
| SS Tee - Brand | `smartsleeve-ss-short-front-print.png` | none |
| SS Tee - Website | `smartsleeve-ss-short-front-print.png` | `ss_and_sqts_tee_back_print.png` |
| SS Tee - Website QR | `smartsleeve-ss-short-front-print.png` | `ss_and_sqts_tee_back_qr_print.png` |
| SS Tank - Brand | `smartsleeve-ss-tank-front-print.png` | none |
| SS Tank - Website | `smartsleeve-ss-tank-front-print.png` | `ss_and_sqts_tank_back_print.png` |
| SS Tank - Website QR | `smartsleeve-ss-tank-front-print.png` | `ss_and_sqts_tank_back_qr_print.png` |
| SQTS Tee - Brand | `sqts-llc-front-print.png` | none |
| SQTS Tee - Website | `sqts-llc-front-print.png` | `ss_and_sqts_tee_back_print.png` |
| SQTS Tee - Website QR | `sqts-llc-front-print.png` | `ss_and_sqts_tee_back_qr_print.png` |
| SQTS Tank - Brand | `sqts-llc-front-print.png` | none |
| SQTS Tank - Website | `sqts-llc-front-print.png` | `ss_and_sqts_tank_back_print.png` |
| SQTS Tank - Website QR | `sqts-llc-front-print.png` | `ss_and_sqts_tank_back_qr_print.png` |

## Printful Setup Notes

- Use black garment blanks only.
- Avoid adding a transparent blank back file in Printful. For Brand variants, leave the back placement empty.
- Keep the QR variants as founder/promo variants unless you decide they should be public products.
- Use the preview PNGs for storefront thumbnails and the print PNGs for production upload.
- Verify physical proof alignment before pushing checkout live.

## Checkout Wiring Notes

- The public site already exposes product keys through `data-merch-checkout`.
- Stripe checkout should create sessions under SmartSleeve Quantitative Trading Systems, LLC.
- Product prices should be changed in Printful, then synced into the website with `scripts/sync_printful_storefront.py`.
- The sync writes `printful-storefront-catalog.json` for the public website and `printful-sync-variants.generated.toml` for private Cloudflare Worker vars.
- The payment-success webhook maps Stripe line items to the product keys in `printful-launch-manifest.json`.
- The fulfillment webhook should submit the matching published Printful sync variant for the selected product and garment size.
