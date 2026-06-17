# SmartSleeve Merch Checkout Worker

This Worker is the production path for the SmartSleeve shop merchant-of-record model:

```text
Customer pays SmartSleeve via Stripe Checkout
SmartSleeve receives the revenue
SmartSleeve pays a print-on-demand vendor to make and ship the merch
SmartSleeve keeps the spread after Stripe, tax, shipping, and fulfillment costs
```

Do not put the LLC EIN, bank details, Stripe keys, Printful/Printify keys, or customer payment details in the static site or git history.

## Routes

- `GET /health`: lightweight configuration check.
- `GET /catalog`: returns the Worker-visible product keys and price config.
- `POST /checkout`: creates a hosted Stripe Checkout Session.
- `POST /stripe-webhook`: receives Stripe `checkout.session.completed` events and optionally submits a fulfillment order.

## Required Stripe Setup

1. Create or finish the Stripe account for `SmartSleeve Quantitative Trading Systems, LLC`.
2. Use the LLC EIN and business details in Stripe onboarding.
3. Connect the SmartSleeve business bank account for payouts.
4. Enable the payment methods you want Stripe Checkout to offer.
5. Add a webhook endpoint pointing at:

```text
https://<your-worker-host>/stripe-webhook
```

6. Subscribe the webhook to `checkout.session.completed`.

## Cloudflare Worker Bindings And Secrets

Required secrets:

```bash
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
```

Recommended KV binding:

```toml
[[kv_namespaces]]
binding = "MERCH_ORDERS"
id = "<cloudflare-kv-namespace-id>"
```

Useful variables:

```toml
[vars]
MERCH_SITE_URL = "https://smartsleeve.ai"
MERCH_SUCCESS_PATH = "/app/#shop-success"
MERCH_CANCEL_PATH = "/app/#shop"
MERCH_SHIPPING_USD = "4.99"
MERCH_ALLOWED_ORIGINS = "https://smartsleeve.ai,https://www.smartsleeve.ai"
```

## Printful Catalog Sync

Because the launch products are now published in Printful, use Printful as the price and fulfillment source of truth. The static website reads a generated public storefront catalog:

```text
merch/printful-storefront-catalog.json
```

The Worker reads private sync variant ids and per-size prices from Worker vars. Generate both from Printful:

```bash
PRINTFUL_API_KEY=... python3 scripts/sync_printful_storefront.py
```

This writes:

- `merch/printful-storefront-catalog.json`: public product names, sizes, and prices for the website.
- `merch_checkout/printful-sync-variants.generated.toml`: private Worker vars mapping product/size to Printful sync variant ids and Printful retail prices.

If the script cannot confidently match your product names, copy:

```bash
cp merch/printful-product-map.example.json merch/printful-product-map.json
```

Then fill `printful_product_id` for each published product from Printful and rerun the sync. Printful’s help docs note that product IDs appear in **Stores/My products**, and variant IDs appear inside each product’s variants.

## Fulfillment

The Worker supports these published Printful product keys:

- `smartsleeve-ss-tee-brand`: SS front, blank back
- `smartsleeve-ss-tee`: SS front, standard back
- `smartsleeve-ss-tee-promo`: SS front, QR promo back
- `smartsleeve-ss-tank-brand`: SS front, blank back
- `smartsleeve-ss-tank`: SS front, standard back
- `smartsleeve-ss-tank-promo`: SS front, QR promo back
- `sqts-llc-tee-brand`: official SQTS LLC front, blank back
- `sqts-llc-tee`: official SQTS LLC front, standard back
- `sqts-llc-tee-promo`: official SQTS LLC front, QR promo back
- `sqts-llc-tank-brand`: official SQTS LLC front, blank back
- `sqts-llc-tank`: official SQTS LLC front, standard back
- `sqts-llc-tank-promo`: official SQTS LLC front, QR promo back

The QR promo back art uses a deliberately understated 3.25 in x 3.25 in QR code, generated as 975 px x 975 px at 300 DPI, underneath a centered `smartsleeve.ai` wordmark.

Keep `PRINTFUL_CONFIRM_ORDERS` unset or `false` while testing; that creates draft orders instead of immediately charging SmartSleeve for production.

```toml
[vars]
MERCH_FULFILLMENT_PROVIDER = "printful"
PRINTFUL_CONFIRM_ORDERS = "false"
```

Secrets/vars:

```bash
wrangler secret put PRINTFUL_API_KEY
```

Then paste the generated `[vars]` values from `merch_checkout/printful-sync-variants.generated.toml` into `wrangler.toml` or Cloudflare Worker variables. The size-specific sync variant ids matter: Printful uses a different sync variant for each published product/size combination, and that sync variant preserves the print files, placement, print method, and product price you configured in Printful.

The Worker still has a raw catalog variant + print-file fallback for future custom products, but published Printful sync variants are the preferred launch path.

If you choose Printify instead, keep `MERCH_FULFILLMENT_PROVIDER` unset initially. The Stripe checkout still works, and paid orders are stored in KV for manual fulfillment until a Printify-specific handoff is added.

## Frontend Wiring

Set the static app meta value during deployment:

```html
<meta name="smartsleeve-merch-checkout-endpoint" content="https://<your-worker-host>/checkout">
```

The public site currently keeps this blank until the Worker is deployed and tested.

## Test Plan

1. Run `scripts/sync_printful_storefront.py` and confirm the public catalog shows the prices you set in Printful.
2. Deploy the Worker with Stripe test-mode keys and `PRINTFUL_CONFIRM_ORDERS=false`.
3. Visit `GET /health` and `GET /catalog`.
4. Set the frontend endpoint to `/checkout`.
5. Pick a product and size on the shop page; confirm the button price matches Printful.
6. Complete checkout with Stripe test card `4242 4242 4242 4242`.
7. Confirm the Stripe webhook records an order in `MERCH_ORDERS`.
8. Confirm Printful order creation stays draft while `PRINTFUL_CONFIRM_ORDERS=false`.
9. Review the draft order in Printful and confirm garment, size, design, address, and cost.
10. Switch to live Stripe and live fulfillment only after one end-to-end test order is correct.
