import assert from "node:assert/strict";
import worker from "./cloudflare_worker.js";

const origin = "https://smartsleeve.ai";
const env = { STRIPE_SECRET_KEY: "sk_test" };
let stripeSession = {};
let stripeStatus = 200;
let stripeCalls = 0;

globalThis.fetch = async (input) => {
  const url = typeof input === "string" ? input : input.url;
  assert.match(url, /^https:\/\/api\.stripe\.com\/v1\/checkout\/sessions\//);
  stripeCalls += 1;
  return new Response(JSON.stringify(stripeSession), {
    status: stripeStatus,
    headers: { "content-type": "application/json" },
  });
};

function request(sessionId) {
  return new Request("https://worker.example/checkout-status", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ session_id: sessionId }),
  });
}

stripeSession = {
  id: "cs_test_PAID",
  status: "complete",
  payment_status: "paid",
  customer_details: { email: "private@example.com" },
};
let response = await worker.fetch(request("cs_test_PAID"), env);
let payload = await response.json();
assert.equal(response.status, 200);
assert.deepEqual(payload, { ok: true, paid: true, checkout_complete: true });
assert.equal(response.headers.get("access-control-allow-origin"), origin);
assert.equal(response.headers.get("cache-control"), "no-store");
assert.doesNotMatch(JSON.stringify(payload), /private@example\.com/);

stripeSession = { id: "cs_test_OPEN", status: "open", payment_status: "unpaid" };
response = await worker.fetch(request("cs_test_OPEN"), env);
payload = await response.json();
assert.deepEqual(payload, { ok: true, paid: false, checkout_complete: false });

const callsBeforeInvalid = stripeCalls;
response = await worker.fetch(request("not-a-session"), env);
payload = await response.json();
assert.equal(response.status, 400);
assert.equal(stripeCalls, callsBeforeInvalid, "invalid session IDs must not reach Stripe");
assert.equal(typeof payload.error, "string");

stripeStatus = 404;
stripeSession = { error: { message: "No such checkout session", customer_email: "private@example.com" } };
response = await worker.fetch(request("cs_test_MISSING"), env);
payload = await response.json();
assert.equal(response.status, 404);
assert.deepEqual(payload, { error: "Stripe Checkout session could not be confirmed" });
assert.doesNotMatch(JSON.stringify(payload), /private@example\.com/);

console.log("ALL PASS — Stripe Checkout status confirmation");
