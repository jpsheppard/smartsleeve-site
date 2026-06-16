# SmartSleeve Merch Assets

These files power the static shop preview at `/app/#shop`.

## Print Artwork

- `sqts-original-front-print.png`: high-resolution SQTS front art for black shirts.
- `smartsleeve-ss-front-print.png`: high-resolution SmartSleeve SS chip front art with the SmartSleeve Quantitative Trading Systems lockup.

## Web Previews

- `sqts-original-tee-preview.png`: storefront preview render for the original SQTS tee.
- `smartsleeve-ss-tee-preview.png`: storefront preview render for the SmartSleeve SS chip tee.
- `smartsleeve-ss-tank-preview.png`: storefront preview render for the SmartSleeve SS chip tank top.

## Launch Products

The active launch products are:

- `smartsleeve-ss-tee`: black SS chip tee, listed at `$19.99 + shipping`.
- `smartsleeve-ss-tank`: black SS chip tank top, listed at `$19.99 + shipping`.

The original SQTS circuit artwork remains available for a later classic-logo product drop but is not the primary launch checkout item.

## Fulfillment Setup

SmartSleeve Quantitative Trading Systems, LLC should be the merchant of record for merch orders. The static site does not process card data directly; it opens a hosted Stripe Checkout Session created by the server-side Worker in `../merch_checkout/cloudflare_worker.js`.

Recommended production flow:

1. Create a Stripe account for SmartSleeve Quantitative Trading Systems, LLC and connect the SmartSleeve business bank account.
2. Create the black SS tee and black SS tank top products in Printful under a SmartSleeve-controlled account, using `smartsleeve-ss-front-print.png`.
3. Deploy the merch checkout Worker and configure the app meta tag `smartsleeve-merch-checkout-endpoint` to point at its `/checkout` route.
4. On checkout request, the backend creates a Stripe Checkout Session with product, quantity, shirt size, shipping, tax, and success/cancel URLs.
5. On Stripe payment success, a backend webhook submits the order to Printful with the matching garment-size variant id and print file URL, then stores the Stripe session id and vendor order id.
6. Customer support, refunds, chargebacks, and accounting stay under SmartSleeve; the vendor is only a fulfillment expense.

Legacy fallback: `MERCH_PROVIDER_STORE_URL` and `MERCH_PRODUCT_URLS` can still point to provider-hosted product pages for internal testing, but those should not be the primary production path if SmartSleeve is collecting customer payment and margin.

See `../merch_checkout/README.md` for Stripe, webhook, KV, and Printful setup details.

Regenerate assets with:

```bash
.venv/bin/python scripts/generate_merch_assets.py
```
