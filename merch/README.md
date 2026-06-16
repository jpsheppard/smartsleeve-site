# SmartSleeve Merch Assets

These files power the static shop preview at `/app/#shop`.

## Print Artwork

- `sqts-llc-front-print.png`: high-resolution front art using the official `SmartSleeve Quantitative Trading Systems, LLC` banner lockup and white slogan.
- `smartsleeve-ss-short-front-print.png`: high-resolution front art using the SS chip mark, short `SmartSleeve` lockup, and white slogan.
- `smartsleeve-ss-front-print.png`: compatibility copy of the short SS front art for older checkout references.
- `smartsleeve-back-print.png`: standard back art with large white `smartsleeve.ai`.
- `smartsleeve-back-qr-print.png`: promotional back art with tasteful white `smartsleeve.ai` and a 3.25 in x 3.25 in QR code at 300 DPI.
- `smartsleeve-ai-qr.png`: standalone QR code pointing to `https://smartsleeve.ai`.
- `sqts-original-front-print.png`: legacy high-resolution SQTS front art retained for old proofs.

## Web Previews

- `sqts-original-tee-preview.png`: storefront preview render for the original SQTS tee.
- `smartsleeve-ss-tee-preview.png`: storefront preview render for the SmartSleeve SS chip tee.
- `smartsleeve-ss-tank-preview.png`: storefront preview render for the SmartSleeve SS chip tank top.
- `sqts-llc-tee-preview.png`: storefront preview render for the SQTS LLC tee.
- `sqts-llc-tank-preview.png`: storefront preview render for the SQTS LLC tank.
- `smartsleeve-ss-tee-promo-preview.png`: QR promo preview for the SS tee.
- `smartsleeve-ss-tank-promo-preview.png`: QR promo preview for the SS tank.
- `sqts-llc-tee-promo-preview.png`: QR promo preview for the SQTS LLC tee.
- `sqts-llc-tank-promo-preview.png`: QR promo preview for the SQTS LLC tank.

## Launch Products

The active launch products are:

- `smartsleeve-ss-tee`: black SS tee, listed at `$19.99 + shipping`.
- `smartsleeve-ss-tank`: black SS tank top, listed at `$19.99 + shipping`.
- `sqts-llc-tee`: black SQTS LLC tee, listed at `$19.99 + shipping`.
- `sqts-llc-tank`: black SQTS LLC tank top, listed at `$19.99 + shipping`.

Founder/promo products reuse the same garment variant ids but swap the standard back art for `smartsleeve-back-qr-print.png`:

- `smartsleeve-ss-tee-promo`
- `smartsleeve-ss-tank-promo`
- `sqts-llc-tee-promo`
- `sqts-llc-tank-promo`

The promo QR is intentionally subtle rather than billboard-sized: the print file places a 975 px x 975 px QR code, which maps to 3.25 in x 3.25 in at 300 DPI, below the back `smartsleeve.ai` wordmark.

## Fulfillment Setup

SmartSleeve Quantitative Trading Systems, LLC should be the merchant of record for merch orders. The static site does not process card data directly; it opens a hosted Stripe Checkout Session created by the server-side Worker in `../merch_checkout/cloudflare_worker.js`.

Recommended production flow:

1. Create a Stripe account for SmartSleeve Quantitative Trading Systems, LLC and connect the SmartSleeve business bank account.
2. Create black tee and black tank products in Printful under a SmartSleeve-controlled account.
3. Use the appropriate front art (`smartsleeve-ss-short-front-print.png` or `sqts-llc-front-print.png`) and back art (`smartsleeve-back-print.png` or `smartsleeve-back-qr-print.png`).
4. Deploy the merch checkout Worker and configure the app meta tag `smartsleeve-merch-checkout-endpoint` to point at its `/checkout` route.
5. On checkout request, the backend creates a Stripe Checkout Session with product, quantity, shirt size, shipping, tax, and success/cancel URLs.
6. On Stripe payment success, a backend webhook submits the order to Printful with the matching garment-size variant id plus front/back print files, then stores the Stripe session id and vendor order id.
7. Customer support, refunds, chargebacks, and accounting stay under SmartSleeve; the vendor is only a fulfillment expense.

Legacy fallback: `MERCH_PROVIDER_STORE_URL` and `MERCH_PRODUCT_URLS` can still point to provider-hosted product pages for internal testing, but those should not be the primary production path if SmartSleeve is collecting customer payment and margin.

See `../merch_checkout/README.md` for Stripe, webhook, KV, and Printful setup details.

Regenerate assets with:

```bash
.venv/bin/python scripts/generate_merch_assets.py
```
