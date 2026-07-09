import worker from "./cloudflare_worker.js";

const SECRET = "whsec_test";
const SID = "cs_test_ABC";

// --- replicate the worker's key derivation so we can pre-seed KV precisely ---
function stableHash(value) {
  const str = String(value === undefined || value === null ? "" : value);
  let hash = 5381;
  for (let i = 0; i < str.length; i += 1) hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}
const notifKey = (stage, shipKey) =>
  `stripe:session:${SID}:notification:${stage}${shipKey ? ":" + shipKey : ""}`;

// --- in-memory KV ---
function makeKV() {
  const store = new Map();
  return {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, typeof v === "string" ? v : String(v)); },
    async delete(k) { store.delete(k); },
    async list({ prefix } = {}) {
      return { keys: [...store.keys()].filter((k) => !prefix || k.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
    },
    _store: store,
  };
}

// --- mocked network: count Resend sends, answer Stripe ---
let resendSends = [];
let resendDelayMs = 0;
function jsonRes(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  const method = (init.method || "GET").toUpperCase();
  if (url.includes("api.resend.com/emails")) {
    if (resendDelayMs) await new Promise((r) => setTimeout(r, resendDelayMs));
    resendSends.push(JSON.parse(init.body));
    return jsonRes({ id: "email_" + resendSends.length });
  }
  if (url.includes("api.stripe.com") && url.includes("/line_items")) {
    return jsonRes({ data: [{ description: "SmartSleeve Fleece Jacket - M", quantity: 1, amount_subtotal: 8099, amount_total: 8099, currency: "usd", price: { unit_amount: 8099, currency: "usd", product: { name: "SmartSleeve Fleece Jacket - M", metadata: {} } } }] });
  }
  if (url.includes("api.stripe.com") && url.includes("/checkout/sessions/")) {
    return jsonRes({ id: SID, customer_details: { email: "jpsheppard88@gmail.com", name: "John" }, metadata: { customer_email: "jpsheppard88@gmail.com" }, amount_total: 8099, amount_subtotal: 8099, currency: "usd", total_details: {} });
  }
  return jsonRes({});
};

function makeEnv() {
  return { MERCH_ORDERS: makeKV(), PRINTFUL_WEBHOOK_SECRET: SECRET, RESEND_API_KEY: "re_test", STRIPE_SECRET_KEY: "sk_test", MERCH_RECEIPT_FROM_EMAIL: "SmartSleeve Shop <shop@smartsleeve.ai>" };
}
function webhookReq(tracking) {
  return new Request("https://w/printful-webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-smartsleeve-webhook-secret": SECRET },
    body: JSON.stringify({ type: "package_shipped", status: "shipped", data: { order: { external_id: SID }, shipment: { tracking_number: tracking, tracking_url: "https://track/" + tracking, carrier: "USPS" } } }),
  });
}
const post = (env, tracking) => worker.fetch(webhookReq(tracking), env);

let pass = 0, fail = 0;
function check(name, cond, extra = "") { if (cond) { pass++; console.log("  PASS", name); } else { fail++; console.log("  FAIL", name, extra); } }

// S1: same package twice (sequential) -> exactly one email
{
  const env = makeEnv(); resendSends = []; resendDelayMs = 0;
  const r1 = await (await post(env, "TRK111")).json();
  const r2 = await (await post(env, "TRK111")).json();
  console.log("S1 same-package x2 sequential:");
  check("first send emits 1 email", resendSends.length === 1, `sends=${resendSends.length}`);
  check("second is duplicate", r2.duplicate === true, JSON.stringify(r2));
  check("still only 1 email total", resendSends.length === 1, `sends=${resendSends.length}`);
}

// S2: two different packages -> one email per package
{
  const env = makeEnv(); resendSends = []; resendDelayMs = 0;
  await post(env, "TRK-A");
  await post(env, "TRK-B");
  console.log("S2 two different packages:");
  check("2 emails (one per package)", resendSends.length === 2, `sends=${resendSends.length}`);
}

// S3: a fresh 'claiming' reservation already present -> new trigger backs off
{
  const env = makeEnv(); resendSends = []; resendDelayMs = 0;
  await env.MERCH_ORDERS.put(notifKey("shipped", stableHash("TRK111")), JSON.stringify({ status: "claiming", stored_at: new Date().toISOString() }));
  const r = await (await post(env, "TRK111")).json();
  console.log("S3 fresh claim present:");
  check("backs off (duplicate)", r.duplicate === true, JSON.stringify(r));
  check("no email sent", resendSends.length === 0, `sends=${resendSends.length}`);
}

// S4: a STALE 'claiming' reservation (crashed mid-send) -> reclaimed and sent
{
  const env = makeEnv(); resendSends = []; resendDelayMs = 0;
  const old = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min ago > 2 min stale window
  await env.MERCH_ORDERS.put(notifKey("shipped", stableHash("TRK111")), JSON.stringify({ status: "claiming", stored_at: old }));
  await post(env, "TRK111");
  console.log("S4 stale claim recovery:");
  check("stale claim reclaimed -> 1 email", resendSends.length === 1, `sends=${resendSends.length}`);
}

// S5: realistic overlap — 2nd trigger arrives during the 1st send (after claim, before commit)
{
  const env = makeEnv(); resendSends = []; resendDelayMs = 50;
  const p1 = post(env, "TRK111");             // starts, claims, then blocks in resend for 50ms
  await new Promise((r) => setTimeout(r, 10)); // let p1 write its claim
  const p2 = post(env, "TRK111");             // arrives mid-send
  const [_a, b] = await Promise.all([p1, p2]);
  const r2 = await b.json();
  console.log("S5 realistic overlap (webhook + poll during send):");
  check("exactly 1 email despite overlap", resendSends.length === 1, `sends=${resendSends.length}`);
  check("overlapping trigger is duplicate", r2.duplicate === true, JSON.stringify(r2));
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
