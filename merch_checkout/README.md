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

## Fulfillment

The Worker supports the first Printful path for the black tee/tank products:

- `smartsleeve-ss-tee`: SS front, standard back
- `smartsleeve-ss-tank`: SS front, standard back
- `sqts-llc-tee`: official SQTS LLC front, standard back
- `sqts-llc-tank`: official SQTS LLC front, standard back
- `smartsleeve-ss-tee-promo`: SS front, QR promo back
- `smartsleeve-ss-tank-promo`: SS front, QR promo back
- `sqts-llc-tee-promo`: official SQTS LLC front, QR promo back
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

```toml
[vars]
PRINTFUL_FILE_URL_SMARTSLEEVE_SS_FRONT = "https://smartsleeve.ai/merch/smartsleeve-ss-short-front-print.png"
PRINTFUL_FILE_URL_SQTS_LLC_FRONT = "https://smartsleeve.ai/merch/sqts-llc-front-print.png"
PRINTFUL_FILE_URL_SMARTSLEEVE_BACK = "https://smartsleeve.ai/merch/smartsleeve-back-print.png"
PRINTFUL_FILE_URL_SMARTSLEEVE_BACK_QR = "https://smartsleeve.ai/merch/smartsleeve-back-qr-print.png"
PRINTFUL_VARIANT_ID_BLACK_TEE_S = "<black-tee-size-s-variant-id>"
PRINTFUL_VARIANT_ID_BLACK_TEE_M = "<black-tee-size-m-variant-id>"
PRINTFUL_VARIANT_ID_BLACK_TEE_L = "<black-tee-size-l-variant-id>"
PRINTFUL_VARIANT_ID_BLACK_TEE_XL = "<black-tee-size-xl-variant-id>"
PRINTFUL_VARIANT_ID_BLACK_TEE_2XL = "<black-tee-size-2xl-variant-id>"
PRINTFUL_VARIANT_ID_BLACK_TANK_S = "<black-tank-size-s-variant-id>"
PRINTFUL_VARIANT_ID_BLACK_TANK_M = "<black-tank-size-m-variant-id>"
PRINTFUL_VARIANT_ID_BLACK_TANK_L = "<black-tank-size-l-variant-id>"
PRINTFUL_VARIANT_ID_BLACK_TANK_XL = "<black-tank-size-xl-variant-id>"
PRINTFUL_VARIANT_ID_BLACK_TANK_2XL = "<black-tank-size-2xl-variant-id>"
```

The size-specific ids matter: Printful uses different variant ids for different garments, colors, and sizes. The Worker asks the customer for size in Stripe Checkout, then maps that size to the matching black tee or black tank variant id and attaches the correct front/back print files for the selected design.

If you choose Printify instead, keep `MERCH_FULFILLMENT_PROVIDER` unset initially. The Stripe checkout still works, and paid orders are stored in KV for manual fulfillment until a Printify-specific handoff is added.

## Frontend Wiring

Set the static app meta value during deployment:

```html
<meta name="smartsleeve-merch-checkout-endpoint" content="https://<your-worker-host>/checkout">
```

The public site currently keeps this blank until the Worker is deployed and tested.

## Test Plan

1. Deploy the Worker with Stripe test-mode keys.
2. Visit `GET /health`.
3. Set the frontend endpoint to `/checkout`.
4. Click a shop button and confirm Stripe Checkout opens.
5. Complete checkout with Stripe test card `4242 4242 4242 4242`.
6. Confirm the Stripe webhook records an order in `MERCH_ORDERS`.
7. Confirm Printful order creation stays draft while `PRINTFUL_CONFIRM_ORDERS=false`.
8. Review the draft order in Printful and confirm the black garment, size, front art, shipping address, and cost are correct.
9. Switch to live Stripe and live fulfillment only after one end-to-end test order is correct.
