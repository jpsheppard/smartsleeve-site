// SmartSleeve merch checkout Worker.
//
// Merchant-of-record model:
//   Customer -> Stripe Checkout -> SmartSleeve Quantitative Trading Systems, LLC
//   SmartSleeve -> print-on-demand vendor fulfillment expense
//
// Required Worker secrets:
//   STRIPE_SECRET_KEY
//   STRIPE_WEBHOOK_SECRET
//
// Optional Worker bindings/secrets:
//   MERCH_ORDERS KV binding
//   MERCH_ALLOWED_ORIGINS
//   MERCH_SITE_URL
//   MERCH_SUCCESS_PATH
//   MERCH_CANCEL_PATH
//   MERCH_SHIPPING_USD
//   MERCH_FULFILLMENT_PROVIDER=printful
//   PRINTFUL_API_KEY
//   PRINTFUL_VARIANT_ID_SQTS_TEE
//   PRINTFUL_VARIANT_ID_SEMISAGE_TEE
//   PRINTFUL_CONFIRM_ORDERS=true
//
// Routes:
//   GET  /health
//   POST /checkout
//   POST /stripe-webhook

const DEFAULT_SITE = "https://smartsleeve.ai";
const DEFAULT_SUCCESS_PATH = "/app/#shop-success";
const DEFAULT_CANCEL_PATH = "/app/#shop";
const MAX_QUANTITY = 6;

const PRODUCT_CATALOG = {
  "sqts-tee": {
    name: "SQTS Circuit Logo Tee",
    description: "Black SmartSleeve tee with the original SQTS neon circuit logo.",
    unit_amount: 1999,
    currency: "usd",
    fulfillment_sku: "sqts-tee",
    variant_env: "PRINTFUL_VARIANT_ID_SQTS_TEE",
  },
  "semisage-tee": {
    name: "Semi Sage Signature Tee",
    description: "Black SmartSleeve tee with Semi Sage artwork and SQTS lockup.",
    unit_amount: 1999,
    currency: "usd",
    fulfillment_sku: "semisage-tee",
    variant_env: "PRINTFUL_VARIANT_ID_SEMISAGE_TEE",
  },
};

function siteUrl(env) {
  return String(env.MERCH_SITE_URL || DEFAULT_SITE).replace(/\/$/, "");
}

function allowedOrigins(env) {
  const configured = String(env.MERCH_ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return new Set([DEFAULT_SITE, "https://www.smartsleeve.ai", ...configured]);
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = allowedOrigins(env);
  const allowOrigin = allowed.has(origin) ? origin : DEFAULT_SITE;
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Stripe-Signature",
    "Vary": "Origin",
  };
}

function jsonResponse(request, env, payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(request, env),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function clampQuantity(value) {
  const quantity = Math.floor(Number(value || 1));
  if (!Number.isFinite(quantity) || quantity < 1) {
    return 1;
  }
  return Math.min(quantity, MAX_QUANTITY);
}

function normalizeProductKey(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

function orderKey(sessionId) {
  return `stripe:session:${sessionId}`;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch (_err) {
    return {};
  }
}

function encodeForm(params, prefix = "") {
  const parts = [];
  Object.entries(params).forEach(([key, value]) => {
    const name = prefix ? `${prefix}[${key}]` : key;
    if (value === undefined || value === null) {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        parts.push(...encodeForm(item, `${name}[${index}]`).split("&").filter(Boolean));
      });
    } else if (typeof value === "object") {
      parts.push(...encodeForm(value, name).split("&").filter(Boolean));
    } else {
      parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
    }
  });
  return parts.join("&");
}

async function createStripeCheckoutSession(request, env) {
  if (!env.STRIPE_SECRET_KEY) {
    return jsonResponse(request, env, { error: "Stripe secret is not configured" }, 503);
  }
  const body = await readJson(request);
  const productKey = normalizeProductKey(body.product_key);
  const product = PRODUCT_CATALOG[productKey];
  if (!product) {
    return jsonResponse(request, env, { error: "Unknown merch product" }, 400);
  }
  const quantity = clampQuantity(body.quantity);
  const shippingCents = Math.max(0, Math.round(Number(env.MERCH_SHIPPING_USD || 4.99) * 100));
  const base = siteUrl(env);
  const successPath = String(env.MERCH_SUCCESS_PATH || DEFAULT_SUCCESS_PATH);
  const cancelPath = String(env.MERCH_CANCEL_PATH || DEFAULT_CANCEL_PATH);
  const params = {
    mode: "payment",
    success_url: `${base}${successPath}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}${cancelPath}`,
    "shipping_address_collection[allowed_countries][0]": "US",
    "custom_fields[0][key]": "shirt_size",
    "custom_fields[0][label][type]": "custom",
    "custom_fields[0][label][custom]": "Shirt size",
    "custom_fields[0][type]": "dropdown",
    "custom_fields[0][dropdown][options][0][label]": "S",
    "custom_fields[0][dropdown][options][0][value]": "S",
    "custom_fields[0][dropdown][options][1][label]": "M",
    "custom_fields[0][dropdown][options][1][value]": "M",
    "custom_fields[0][dropdown][options][2][label]": "L",
    "custom_fields[0][dropdown][options][2][value]": "L",
    "custom_fields[0][dropdown][options][3][label]": "XL",
    "custom_fields[0][dropdown][options][3][value]": "XL",
    "custom_fields[0][dropdown][options][4][label]": "2XL",
    "custom_fields[0][dropdown][options][4][value]": "2XL",
    "line_items[0][quantity]": quantity,
    "line_items[0][price_data][currency]": product.currency,
    "line_items[0][price_data][unit_amount]": product.unit_amount,
    "line_items[0][price_data][product_data][name]": product.name,
    "line_items[0][price_data][product_data][description]": product.description,
    "metadata[product_key]": productKey,
    "metadata[fulfillment_sku]": product.fulfillment_sku,
    "metadata[quantity]": String(quantity),
  };
  if (shippingCents > 0) {
    params["shipping_options[0][shipping_rate_data][type]"] = "fixed_amount";
    params["shipping_options[0][shipping_rate_data][fixed_amount][currency]"] = product.currency;
    params["shipping_options[0][shipping_rate_data][fixed_amount][amount]"] = shippingCents;
    params["shipping_options[0][shipping_rate_data][display_name]"] = "Standard shipping";
  }
  if (String(env.MERCH_STRIPE_AUTOMATIC_TAX || "").toLowerCase() === "true") {
    params["automatic_tax[enabled]"] = "true";
  }

  const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: encodeForm(params),
  });
  const payload = await stripeResponse.json();
  if (!stripeResponse.ok) {
    return jsonResponse(
      request,
      env,
      { error: "Stripe Checkout session creation failed", stripe_error: payload.error || payload },
      502,
    );
  }
  return jsonResponse(request, env, {
    checkout_url: payload.url,
    session_id: payload.id,
    product_key: productKey,
  });
}

function hexToBytes(hex) {
  const clean = String(hex || "").trim();
  if (!/^[0-9a-f]+$/i.test(clean) || clean.length % 2 !== 0) {
    return new Uint8Array();
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = parseInt(clean.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a[index] ^ b[index];
  }
  return diff === 0;
}

async function hmacSha256Hex(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function verifyStripeSignature(request, env, rawBody) {
  const header = request.headers.get("Stripe-Signature") || "";
  const timestamp = (header.match(/(?:^|,)t=([^,]+)/) || [])[1] || "";
  const signatures = [...header.matchAll(/(?:^|,)v1=([^,]+)/g)].map((match) => match[1]);
  if (!timestamp || signatures.length === 0 || !env.STRIPE_WEBHOOK_SECRET) {
    return false;
  }
  const expected = await hmacSha256Hex(env.STRIPE_WEBHOOK_SECRET, `${timestamp}.${rawBody}`);
  const expectedBytes = hexToBytes(expected);
  return signatures.some((signature) => timingSafeEqual(expectedBytes, hexToBytes(signature)));
}

function customFieldValue(session, key) {
  const field = (session.custom_fields || []).find((item) => item.key === key);
  if (!field) {
    return "";
  }
  if (field.dropdown && field.dropdown.value) {
    return field.dropdown.value;
  }
  return field.text && field.text.value ? field.text.value : "";
}

async function submitPrintfulOrder(env, session) {
  if (!env.PRINTFUL_API_KEY) {
    return { status: "skipped", reason: "PRINTFUL_API_KEY not configured" };
  }
  const productKey = normalizeProductKey(session.metadata && session.metadata.product_key);
  const product = PRODUCT_CATALOG[productKey];
  if (!product) {
    return { status: "skipped", reason: "unknown product metadata" };
  }
  const variantId = Number(env[product.variant_env] || 0);
  if (!variantId) {
    return { status: "skipped", reason: `${product.variant_env} not configured` };
  }
  const shipping = session.shipping_details || {};
  const address = shipping.address || {};
  const customer = session.customer_details || {};
  const quantity = clampQuantity(session.metadata && session.metadata.quantity);
  const size = customFieldValue(session, "shirt_size") || "M";
  const order = {
    external_id: session.id,
    recipient: {
      name: shipping.name || customer.name || "SmartSleeve customer",
      email: customer.email || "",
      address1: address.line1 || "",
      address2: address.line2 || "",
      city: address.city || "",
      state_code: address.state || "",
      country_code: address.country || "US",
      zip: address.postal_code || "",
    },
    items: [
      {
        variant_id: variantId,
        quantity,
        name: `${product.name} - ${size}`,
      },
    ],
  };
  const confirm = String(env.PRINTFUL_CONFIRM_ORDERS || "").toLowerCase() === "true";
  const response = await fetch(`https://api.printful.com/orders?confirm=${confirm ? "1" : "0"}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.PRINTFUL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(order),
  });
  const payload = await response.json().catch(() => ({}));
  return {
    status: response.ok ? "submitted" : "failed",
    provider: "printful",
    confirm,
    http_status: response.status,
    provider_response: payload,
  };
}

async function maybeFulfill(env, session) {
  const provider = String(env.MERCH_FULFILLMENT_PROVIDER || "none").toLowerCase();
  if (provider === "printful") {
    return submitPrintfulOrder(env, session);
  }
  return { status: "skipped", reason: "MERCH_FULFILLMENT_PROVIDER not configured" };
}

async function storeOrder(env, session, fulfillment) {
  if (!env.MERCH_ORDERS || !session.id) {
    return;
  }
  await env.MERCH_ORDERS.put(
    orderKey(session.id),
    JSON.stringify({
      stored_at: new Date().toISOString(),
      stripe_session_id: session.id,
      product_key: session.metadata && session.metadata.product_key,
      amount_total: session.amount_total,
      currency: session.currency,
      payment_status: session.payment_status,
      customer_email: session.customer_details && session.customer_details.email,
      fulfillment,
    }),
  );
}

async function handleStripeWebhook(request, env) {
  const rawBody = await request.text();
  if (!(await verifyStripeSignature(request, env, rawBody))) {
    return jsonResponse(request, env, { error: "Invalid Stripe signature" }, 400);
  }
  const event = JSON.parse(rawBody);
  if (event.type !== "checkout.session.completed") {
    return jsonResponse(request, env, { received: true, ignored: event.type });
  }
  const session = event.data && event.data.object ? event.data.object : {};
  const alreadyStored = env.MERCH_ORDERS && session.id
    ? await env.MERCH_ORDERS.get(orderKey(session.id))
    : null;
  if (alreadyStored) {
    return jsonResponse(request, env, { received: true, duplicate: true });
  }
  const fulfillment = await maybeFulfill(env, session);
  await storeOrder(env, session, fulfillment);
  return jsonResponse(request, env, { received: true, fulfillment });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(request, env) });
    }
    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse(request, env, {
        ok: true,
        merchant_of_record: "SmartSleeve Quantitative Trading Systems, LLC",
        stripe_configured: Boolean(env.STRIPE_SECRET_KEY),
        webhook_configured: Boolean(env.STRIPE_WEBHOOK_SECRET),
        fulfillment_provider: env.MERCH_FULFILLMENT_PROVIDER || "none",
      });
    }
    if (request.method === "POST" && url.pathname === "/checkout") {
      return createStripeCheckoutSession(request, env);
    }
    if (request.method === "POST" && url.pathname === "/stripe-webhook") {
      return handleStripeWebhook(request, env);
    }
    return jsonResponse(request, env, { error: "Not found" }, 404);
  },
};
