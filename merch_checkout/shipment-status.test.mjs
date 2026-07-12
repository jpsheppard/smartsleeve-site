import assert from "node:assert/strict";
import { stageFromPrintfulShipments } from "./cloudflare_worker.js";

const futureShipment = {
  id: 81382014,
  status: "waiting_for_fulfillment",
  tracking_url: "https://myorders.co/tracking/81382014/",
};

assert.equal(
  stageFromPrintfulShipments([futureShipment], { status: "waiting_for_fulfillment" }),
  "",
  "a pre-created shipment and tracking URL must not be reported as shipped",
);

assert.equal(
  stageFromPrintfulShipments([{ ...futureShipment, tracking_number: "LABEL-CREATED" }], { status: "pending" }),
  "",
  "a tracking number alone must not be reported as shipped",
);

assert.equal(
  stageFromPrintfulShipments([{
    ...futureShipment,
    tracking_events: [{ description: "Shipping information sent to carrier" }],
  }]),
  "",
  "free-form carrier text saying sent must not turn a label-created parcel into a shipment",
);

assert.equal(
  stageFromPrintfulShipments([{ ...futureShipment, shipped_at: "2026-07-12T01:02:03Z" }]),
  "shipped",
  "an explicit shipped timestamp is authoritative",
);

assert.equal(
  stageFromPrintfulShipments([{ shipment_status: "shipped", tracking_url: futureShipment.tracking_url }]),
  "shipped",
  "Printful's explicit V2 shipment status is authoritative",
);

assert.equal(
  stageFromPrintfulShipments([], { status: "fulfilled" }),
  "shipped",
  "a fulfilled Printful order is shipped",
);

assert.equal(
  stageFromPrintfulShipments([{ status: "in_transit" }]),
  "shipped",
  "an in-transit shipment is shipped",
);

assert.equal(
  stageFromPrintfulShipments([{ status: "shipped", delivered_at: "2026-07-14T01:02:03Z" }]),
  "delivered",
  "delivery takes precedence over shipment",
);

assert.equal(
  stageFromPrintfulShipments([{ tracking_events: [{ status: "delivered" }] }]),
  "delivered",
  "a delivered tracking event is authoritative",
);

console.log("ALL PASS — Printful shipment status classification");
