import worker, { NotificationLock } from "./cloudflare_worker.js";

const SECRET = "whsec_test";
const SID = "cs_test_ABC";

// --- replicate the worker's key derivation so we can pre-seed the KV path precisely ---
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
  };
}

// --- mock Durable Object namespace backed by the REAL NotificationLock class ---
// The mock DurableObjectState serializes blockConcurrencyWhile via a per-instance
// promise chain, mirroring the real runtime's input gate so the concurrency test is
// faithful.
function makeMockState() {
  const store = new Map();
  let chain = Promise.resolve();
  return {
    storage: {
      async get(k) { return store.has(k) ? store.get(k) : undefined; },
      async put(k, v) { store.set(k, v); },
      async delete(k) { store.delete(k); },
    },
    blockConcurrencyWhile(fn) {
      const run = chain.then(() => fn());
      chain = run.then(() => {}, () => {});
      return run;
    },
  };
}
function makeDONamespace() {
  const instances = new Map();
  return {
    idFromName(name) { return { name }; },
    get(id) {
      let inst = instances.get(id.name);
      if (!inst) { inst = new NotificationLock(makeMockState()); instances.set(id.name, inst); }
      return { fetch: (url, init) => inst.fetch(new Request(url, init)) };
    },
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

function baseEnv() {
  return { PRINTFUL_WEBHOOK_SECRET: SECRET, RESEND_API_KEY: "re_test", STRIPE_SECRET_KEY: "sk_test", MERCH_RECEIPT_FROM_EMAIL: "SmartSleeve Shop <shop@smartsleeve.ai>" };
}
const makeEnvKV = () => Object.assign(baseEnv(), { MERCH_ORDERS: makeKV() });
const makeEnvDO = () => Object.assign(baseEnv(), { MERCH_ORDERS: makeKV(), NOTIFICATION_LOCK: makeDONamespace() });

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

async function runShared(label, makeEnv) {
  console.log(`\n### ${label} backend ###`);

  { // S1: same package twice sequential -> one email
    const env = makeEnv(); resendSends = []; resendDelayMs = 0;
    await post(env, "TRK111");
    const r2 = await (await post(env, "TRK111")).json();
    console.log("S1 same-package x2 sequential:");
    check(`[${label}] one email`, resendSends.length === 1, `sends=${resendSends.length}`);
    check(`[${label}] second is duplicate`, r2.duplicate === true, JSON.stringify(r2));
  }
  { // S2: two different packages -> one email each
    const env = makeEnv(); resendSends = []; resendDelayMs = 0;
    await post(env, "TRK-A");
    await post(env, "TRK-B");
    console.log("S2 two different packages:");
    check(`[${label}] one email per package (2)`, resendSends.length === 2, `sends=${resendSends.length}`);
  }
  if (label === "KV") { // S4: stale claim recovery (pre-seed only meaningful for the KV path)
    const env = makeEnv(); resendSends = []; resendDelayMs = 0;
    const old = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await env.MERCH_ORDERS.put(notifKey("shipped", stableHash("TRK111")), JSON.stringify({ status: "claiming", stored_at: old }));
    await post(env, "TRK111");
    console.log("S4 stale claim recovery:");
    check(`[${label}] stale claim reclaimed -> 1 email`, resendSends.length === 1, `sends=${resendSends.length}`);
  }
  { // S5: realistic overlap (2nd trigger arrives during 1st send)
    const env = makeEnv(); resendSends = []; resendDelayMs = 50;
    const p1 = post(env, "TRK111");
    await new Promise((r) => setTimeout(r, 10));
    const p2 = post(env, "TRK111");
    const [, b] = await Promise.all([p1, p2]);
    const r2 = await b.json();
    console.log("S5 realistic overlap (webhook + poll during send):");
    check(`[${label}] exactly 1 email`, resendSends.length === 1, `sends=${resendSends.length}`);
    check(`[${label}] overlapping trigger is duplicate`, r2.duplicate === true, JSON.stringify(r2));
  }
}

await runShared("KV", makeEnvKV);
await runShared("DO", makeEnvDO);

// S6: TRULY simultaneous identical triggers (Promise.all, no head start). The DO lock
// must still yield exactly one email; KV cannot guarantee this and is only reported.
{
  console.log("\n### true-simultaneous race ###");
  { // KV — informational only (demonstrates the DO's advantage), not asserted
    const env = makeEnvKV(); resendSends = []; resendDelayMs = 5;
    await Promise.all([post(env, "TRK111"), post(env, "TRK111"), post(env, "TRK111")]);
    console.log(`S6 KV simultaneous x3 -> ${resendSends.length} email(s) (informational; KV is not atomic)`);
  }
  { // DO — must collapse to exactly one
    const env = makeEnvDO(); resendSends = []; resendDelayMs = 5;
    await Promise.all([post(env, "TRK111"), post(env, "TRK111"), post(env, "TRK111")]);
    console.log("S6 DO simultaneous x3:");
    check("[DO] simultaneous triggers -> exactly 1 email", resendSends.length === 1, `sends=${resendSends.length}`);
  }
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
