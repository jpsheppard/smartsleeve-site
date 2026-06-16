# SmartSleeve Merch Assets

These files power the static shop preview at `/app/#shop`.

## Print Artwork

- `sqts-original-front-print.png`: high-resolution SQTS front art for black shirts.
- `semisage-signature-front-print.png`: high-resolution Semi Sage front art with the SmartSleeve Quantitative Trading Systems lockup.

## Web Previews

- `sqts-original-tee-preview.png`: storefront preview render for the original SQTS tee.
- `semisage-signature-tee-preview.png`: storefront preview render for the Semi Sage signature tee.

## Fulfillment Setup

The static site does not process merch payments. Create the products in a hosted fulfillment store such as Printify Pop-Up Store or Printful Quick Stores, then paste the published storefront/product URLs into `MERCH_PROVIDER_STORE_URL` and `MERCH_PRODUCT_URLS` in `/app/app.js`.

Regenerate assets with:

```bash
.venv/bin/python scripts/generate_merch_assets.py
```
