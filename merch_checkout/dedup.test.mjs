import worker, { NotificationLock } from "./cloudflare_worker.js";

const SECRET = "whsec_test";
const SID = "cs_test_ABC";

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

const baseEnv = () => ({ PRINTFUL_WEBHOOK_SECRET: SECRET, RESEND_API_KEY: "re_test", STRIPE_SECRET_KEY: "sk_test", MERCH_RECEIPT_FROM_EMAIL: "SmartSleeve Orders <orders@smartsleeve.ai>" });
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

{ // S1: same parcel twice -> one email
  const env = makeEnvDO(); resendSends = []; resendDelayMs = 0;
  const r1 = await (await post(env, "TRK111")).json();
  const r2 = await (await post(env, "TRK111")).json();
  console.log("S1 same parcel x2:");
  check("one email", resendSends.length === 1, `sends=${resendSends.length} r1=${JSON.stringify(r1)}`);
  check("second is duplicate", r2.duplicate === true, JSON.stringify(r2));
}
{ // S2: two different parcels -> one email each (split-order per-package)
  const env = makeEnvDO(); resendSends = []; resendDelayMs = 0;
  await post(env, "TRK-A");
  await post(env, "TRK-B");
  console.log("S2 two parcels:");
  check("two emails (one per parcel)", resendSends.length === 2, `sends=${resendSends.length}`);
}
{ // S5: realistic overlap (2nd arrives during 1st send)
  const env = makeEnvDO(); resendSends = []; resendDelayMs = 50;
  const p1 = post(env, "TRK111");
  await new Promise((r) => setTimeout(r, 10));
  const p2 = post(env, "TRK111");
  const [, b] = await Promise.all([p1, p2]);
  const r2 = await b.json();
  console.log("S5 realistic overlap:");
  check("exactly 1 email", resendSends.length === 1, `sends=${resendSends.length}`);
  check("overlapping is duplicate", r2.duplicate === true, JSON.stringify(r2));
}
{ // S6: truly simultaneous x3 -> DO must yield exactly 1
  const env = makeEnvDO(); resendSends = []; resendDelayMs = 5;
  await Promise.all([post(env, "TRK111"), post(env, "TRK111"), post(env, "TRK111")]);
  console.log("S6 DO simultaneous x3:");
  check("exactly 1 email (atomic)", resendSends.length === 1, `sends=${resendSends.length}`);
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
