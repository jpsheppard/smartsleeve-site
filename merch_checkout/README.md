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

The Worker supports a first Printful path. Keep `PRINTFUL_CONFIRM_ORDERS` unset or `false` while testing; that creates draft orders instead of immediately charging SmartSleeve for production.

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
PRINTFUL_VARIANT_ID_SQTS_TEE = "<printful-black-tee-variant-id>"
PRINTFUL_VARIANT_ID_SEMISAGE_TEE = "<printful-black-tee-variant-id>"
```

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
8. Switch to live Stripe and live fulfillment only after one end-to-end test order is correct.
