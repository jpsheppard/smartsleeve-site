# Incident: duplicate "order shipped" email — 2026-07-09

**Worker:** `smartsleeve-merch-checkout` · **Severity:** low (cosmetic; one extra customer email) · **Status:** fixed & deployed (worker version `7b2e5805`, later + observability logging).

## Summary

A customer (John) received **two identical** "Your SmartSleeve merch order has shipped" emails for the fleece parcel of order `ss-GHsCGPv2oDaZBqeokGfhPy6t`, both at **2026-07-09 10:09:38 UTC** (03:09 PT). Root cause: two near-simultaneous Printful shipment webhooks both passed the per-parcel dedup check **before** either recorded it, because the check and the record straddle the email send (not atomic).

## Timeline (UTC)

| Time | Event |
|---|---|
| ~10:09:38 | Printful delivers the fleece shipment webhook (at least) twice |
| 10:09:38 | SmartSleeve sends "order shipped" email **#1** |
| 10:09:38 | SmartSleeve sends "order shipped" email **#2** (duplicate, same second) |
| 10:19:37 | Printful's own "has been sent out" email arrives |

The earlier socks/rest parcel shipped 2026-07-07 and correctly produced **one** email, so per-parcel dedup itself was working.

## Root cause

`sendOrderStageNotification` is reached from two paths — the real-time `/printful-webhook` and the scheduled poll (`scheduled` cron → `processPolledPrintfulOrder`). The worker already dedupes **per parcel** via shipment signatures (`shippedShipmentIsNew`), so a *sequential* re-delivery is caught. The defect was **timing** — the dedup state is only written *after* the email is sent:

```
1. read stored order (KV)
2. alreadyNotified = !shippedShipmentIsNew(stored, fulfillment)   ← READ only
3. if alreadyNotified → return duplicate
4. await fetchStripeCheckoutSession(...)     ~100–300ms
5. await sendLifecycleEmail(...)             ← EMAIL SENT
6. await recordOrderNotification(...)        ← dedup state WRITTEN (only here)
```

Two invocations executed step 2 before either reached step 6, so both saw "not notified," both sent, then both recorded.

### Trigger: duplicate webhook, not the poll

The poll cron is `*/30 * * * *` → it only fires at `:00` and `:30`. The duplicates were at `:09`, so **the poll did not run then**. The trigger was a **duplicate/retried Printful webhook delivery** (Printful webhooks are at-least-once). The poll is a *second* way to hit the same window (at `:00`/`:30`); both are now closed.

## Fix

`sendOrderStageNotification` now **claims the `(session, stage, parcel)` slot before step 4** using a `NotificationLock` **Durable Object** (one instance per key, serialized via `blockConcurrencyWhile` — strongly consistent). Two simultaneous webhooks compute the same claim key (same parcel signature); the DO grants it to exactly one, the other returns `duplicate`. The claim is released on send failure and self-heals after 2 minutes if a send crashes mid-flight. If the DO binding is absent, it degrades to KV claim-before-send.

Split orders still get **one email per parcel** because the claim key includes the parcel signature.

Regression test: `merch_checkout/dedup.test.mjs` (`npm test`) — same-parcel idempotency, per-parcel fan-out, webhook/poll overlap, and the exact incident shape (**3 truly-simultaneous triggers → 1 email**).

## Observability

`/printful-webhook` now logs every delivery (`SmartSleeve Printful webhook received`, with Printful's `type`/`created`/`retries` + parcel signature) and warns on each suppressed duplicate (`SmartSleeve duplicate Printful webhook suppressed`, tagged `in_flight_claim` vs `already_recorded`). Watch with:

```bash
cd merch_checkout && npx wrangler tail --format pretty
```

This makes it visible how often Printful double-fires (harmless now, but worth knowing).

## Follow-ups / notes

- Printful does not send a stable per-event id; `retries` + `created` + `type` are the best available correlation fields.
- Deploy topology footnote: the real worker is developed/deployed from the local `site/merch_checkout/` copy via `wrangler deploy` (existing OAuth login). Keep GitHub `main` in sync — during this incident `main` was stale, which caused a bad deploy that had to be rolled forward.
