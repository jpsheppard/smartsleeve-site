import assert from "node:assert/strict";
import worker, { processPolledPrintfulOrder } from "./cloudflare_worker.js";

const SID = "cs_test_SPLIT";
const ORDER_KEY = `stripe:session:${SID}`;

function makeKV(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value) { store.set(key, String(value)); },
    async delete(key) { store.delete(key); },
    async list({ prefix } = {}) {
      return {
        keys: [...store.keys()].filter((key) => !prefix || key.startsWith(prefix)).map((name) => ({ name })),
        list_complete: true,
      };
    },
  };
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

const lineItems = [
  "SmartSleeve Gym Towel - 28 x 16",
  "SmartSleeve Fleece Jacket - M",
  "SmartSleeve Beach Towel - 36 x 72",
].map((name, index) => ({
  description: name,
  quantity: 1,
  amount_subtotal: 2000 + index,
  amount_total: 2000 + index,
  currency: "usd",
  price: {
    unit_amount: 2000 + index,
    currency: "usd",
    product: { name, metadata: {} },
  },
}));

function shipment(id, tracking, stage, orderItemId, orderItemName) {
  return {
    id,
    tracking_number: tracking,
    tracking_url: `https://tracking.example/${tracking}`,
    shipment_status: stage === "waiting" ? "waiting_for_fulfillment" : "shipped",
    shipped_at: stage === "waiting" ? null : "2026-07-11T18:00:00Z",
    delivery_status: stage === "delivered" ? "delivered" : "unknown",
    delivered_at: stage === "delivered" ? "2026-07-11T23:30:00Z" : null,
    shipment_items: [{
      id: 9000 + orderItemId,
      order_item_id: orderItemId,
      order_item_name: orderItemName,
      quantity: 1,
    }],
  };
}

const gym = () => shipment(11, "GYM-TRACK", "delivered", 101, lineItems[0].description);
const fleece = () => shipment(12, "FLEECE-TRACK", "shipped", 102, lineItems[1].description);
const beach = (stage = "waiting") => shipment(13, "BEACH-TRACK", stage, 103, lineItems[2].description);

function storedOrder(notifications) {
  return {
    stored_at: "2026-07-04T07:04:53.413Z",
    stripe_session_id: SID,
    fulfillment: {
      status: "submitted",
      provider: "printful",
      provider_response: {
        result: {
          orders: [{
            id: 777,
            external_id: "ss-split-order-rest",
            items: lineItems.map((item, index) => ({ id: 101 + index, name: item.description })),
          }],
        },
      },
    },
    ...(notifications ? { notifications } : {}),
  };
}

let currentShipments = [gym(), fleece(), beach()];
let sentEmails = [];
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  if (url.includes("api.printful.com/v2/orders/777/shipments")) {
    return jsonResponse({ data: currentShipments });
  }
  if (url.includes("api.stripe.com") && url.includes("/line_items")) {
    return jsonResponse({ data: lineItems });
  }
  if (url.includes("api.stripe.com") && url.includes("/checkout/sessions/")) {
    return jsonResponse({
      id: SID,
      customer_details: { email: "customer@example.com", name: "Customer" },
      metadata: { customer_email: "customer@example.com" },
      amount_subtotal: 6003,
      amount_total: 6003,
      currency: "usd",
      total_details: {},
    });
  }
  if (url.includes("api.resend.com/emails")) {
    sentEmails.push(JSON.parse(init.body));
    return jsonResponse({ id: `email-${sentEmails.length}` });
  }
  return jsonResponse({}, 404);
};

function makeEnv(order) {
  return {
    MERCH_ORDERS: makeKV({ [ORDER_KEY]: JSON.stringify(order) }),
    PRINTFUL_API_KEY: "printful-test",
    RESEND_API_KEY: "resend-test",
    STRIPE_SECRET_KEY: "stripe-test",
  };
}

{
  const env = makeEnv(storedOrder());
  sentEmails = [];
  const result = await processPolledPrintfulOrder(env, SID, storedOrder());
  assert.equal(result.notification_count, 2, "one delivered and one shipped parcel should produce two emails");
  assert.equal(sentEmails.length, 2);

  const delivered = sentEmails.find((email) => email.subject.includes("was delivered"));
  const shipped = sentEmails.find((email) => email.subject.includes("has shipped"));
  assert.ok(delivered.subject.startsWith("Part of"), "split delivery subject must say it is partial");
  assert.match(delivered.text, /SmartSleeve Gym Towel/);
  assert.doesNotMatch(delivered.text, /Fleece Jacket|Beach Towel/);
  assert.ok(shipped.subject.startsWith("Part of"), "split shipment subject must say it is partial");
  assert.match(shipped.text, /Fleece Jacket/);
  assert.doesNotMatch(shipped.text, /Gym Towel|Beach Towel/);

  const saved = JSON.parse(await env.MERCH_ORDERS.get(ORDER_KEY));
  assert.deepEqual(Object.keys(saved.notifications.delivered_shipments), ["GYM-TRACK"]);
  assert.deepEqual(Object.keys(saved.notifications.shipped_shipments).sort(), ["FLEECE-TRACK", "GYM-TRACK"]);
  assert.ok(!saved.notifications.shipped_shipments["BEACH-TRACK"], "a future parcel must not be marked shipped");

  currentShipments = [gym(), fleece(), beach("shipped")];
  const next = await processPolledPrintfulOrder(env, SID, saved);
  assert.equal(next.notification_count, 1, "the later parcel should get its own shipped email");
  assert.equal(sentEmails.length, 3);
  assert.match(sentEmails[2].text, /Beach Towel/);
  assert.doesNotMatch(sentEmails[2].text, /Gym Towel|Fleece Jacket/);
}

{
  currentShipments = [gym(), fleece(), beach()];
  const legacyNotifications = {
    shipped: { stored_at: "2026-07-10T19:06:14Z", notification: { status: "sent", item_count: 3 } },
    shipped_shipments: {
      "GYM-TRACK": { stored_at: "2026-07-10T19:06:14Z" },
      "FLEECE-TRACK": { stored_at: "2026-07-10T19:06:14Z" },
      "BEACH-TRACK": { stored_at: "2026-07-10T19:06:14Z" },
    },
    delivered: { stored_at: "2026-07-11T23:30:49Z", notification: { status: "sent", item_count: 3 } },
  };
  const order = storedOrder(legacyNotifications);
  const env = makeEnv(order);
  sentEmails = [];
  const migrated = await processPolledPrintfulOrder(env, SID, order);
  assert.equal(migrated.notification_count, 0, "deploy migration must not repeat today's customer emails");
  const saved = JSON.parse(await env.MERCH_ORDERS.get(ORDER_KEY));
  assert.ok(!saved.notifications.shipped_shipments["BEACH-TRACK"], "legacy false-positive future parcel must be unmarked");
  assert.ok(saved.notifications.delivered_shipments["GYM-TRACK"], "the already-emailed delivered parcel must be inferred");

  currentShipments = [gym(), fleece(), beach("shipped")];
  const next = await processPolledPrintfulOrder(env, SID, saved);
  assert.equal(next.notification_count, 1);
  assert.equal(sentEmails.length, 1);
  assert.match(sentEmails[0].text, /Beach Towel/);
  assert.doesNotMatch(sentEmails[0].text, /Gym Towel|Fleece Jacket/);
}

{
  const gymSlug = "PRINTFUL_444665351_SMARTSLEEVE_GYM_TOWEL";
  const rallySlug = "PRINTFUL_444665358_SMARTSLEEVE_RALLY_TOWEL";
  const env = {
    STRIPE_SECRET_KEY: "stripe-test",
    [`PRINTFUL_SYNC_PRODUCT_ID_${gymSlug}`]: "444665351",
    [`MERCH_PRODUCT_NAME_${gymSlug}`]: "SmartSleeve Gym Towel",
    [`PRINTFUL_SYNC_VARIANT_ID_${gymSlug}_28X16`]: "1",
    [`PRINTFUL_SYNC_PRODUCT_ID_${rallySlug}`]: "444665358",
    [`MERCH_PRODUCT_NAME_${rallySlug}`]: "SmartSleeve Rally Towel",
    [`PRINTFUL_SYNC_VARIANT_ID_${rallySlug}_16X24`]: "2",
  };
  const catalog = await (await worker.fetch(new Request("https://worker.example/catalog"), env)).json();
  assert.deepEqual(catalog.products.map((product) => product.name), ["SmartSleeve Rally Towel"]);
  const checkout = await worker.fetch(new Request("https://worker.example/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      customer_email: "customer@example.com",
      items: [{ product_key: "printful-444665351-smartsleeve-gym-towel", size: "28X16", quantity: 1 }],
    }),
  }), env);
  assert.equal(checkout.status, 400, "a retired gym towel must be rejected before any request reaches Stripe");
}

console.log("ALL PASS — split shipment lifecycle and gym-towel retirement");
