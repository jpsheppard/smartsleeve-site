# Incident: split shipment email listed the full order — 2026-07-11

**Worker:** `smartsleeve-merch-checkout` · **Severity:** medium (incorrect customer fulfillment information) · **Status:** fixed

## Summary

A six-item SmartSleeve order was split into multiple Printful packages. SmartSleeve sent shipped/delivered email describing all six items even though the delivery contained only the SmartSleeve Gym Towel.

## Root cause

The scheduled poll classified the complete array returned by Printful as one order-level lifecycle event:

- one shipped or delivered record promoted the entire response to that stage;
- every tracking number in the response was recorded as notified, including pre-created future shipments;
- parcel item scoping looked only for legacy `items`/`order_items`, while Printful v2 returns `shipment_items` with `order_item_id` and `order_item_name`;
- delivered email was always rendered with the full order item list.

## Fix

- Process every Printful shipment record independently for shipped and delivered stages.
- Accept Printful v1 webhook item ids and v2 `shipment_items` names/ids.
- Scope both shipped and delivered email to the current parcel.
- Fail closed for multi-item orders when parcel contents cannot be resolved; retry/enrich rather than report the full order.
- Ignore pre-created tracking URLs, tracking numbers, and free-form carrier text unless an explicit shipped status or timestamp exists.
- Deduplicate both shipped and delivered messages per parcel.
- Reconcile legacy notification state so future/unshipped tracking numbers are unmarked without repeating the already-sent July 11 delivery email.

Regression coverage: `merch_checkout/shipment-status.test.mjs` and `merch_checkout/split-shipment.test.mjs`.

## Product action

Both SmartSleeve and SQTS Gym Towel listings are retired. Static catalog, frontend, sync pipeline, Worker catalog, and direct checkout all enforce the removal.
