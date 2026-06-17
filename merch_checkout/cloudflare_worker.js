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
//   MERCH_PRICE_USD_<PRODUCT_KEY>
//   MERCH_FULFILLMENT_PROVIDER=printful
//   PRINTFUL_API_KEY
//   PRINTFUL_SYNC_VARIANT_ID_<PRODUCT_KEY>_<SIZE>
//   PRINTFUL_VARIANT_ID_BLACK_TEE_S
//   PRINTFUL_VARIANT_ID_BLACK_TEE_M
//   PRINTFUL_VARIANT_ID_BLACK_TEE_L
//   PRINTFUL_VARIANT_ID_BLACK_TEE_XL
//   PRINTFUL_VARIANT_ID_BLACK_TEE_2XL
//   PRINTFUL_VARIANT_ID_BLACK_TANK_S
//   PRINTFUL_VARIANT_ID_BLACK_TANK_M
//   PRINTFUL_VARIANT_ID_BLACK_TANK_L
//   PRINTFUL_VARIANT_ID_BLACK_TANK_XL
//   PRINTFUL_VARIANT_ID_BLACK_TANK_2XL
//   PRINTFUL_FILE_URL_SMARTSLEEVE_SS_FRONT
//   PRINTFUL_FILE_URL_SQTS_LLC_FRONT
//   PRINTFUL_FILE_URL_SHARED_TEE_BACK
//   PRINTFUL_FILE_URL_SHARED_TEE_BACK_QR
//   PRINTFUL_FILE_URL_SHARED_TANK_BACK
//   PRINTFUL_FILE_URL_SHARED_TANK_BACK_QR
//   PRINTFUL_CONFIRM_ORDERS=true
//
// Routes:
//   GET  /health
//   GET  /catalog
//   POST /checkout
//   POST /stripe-webhook

const DEFAULT_SITE = "https://smartsleeve.ai";
const DEFAULT_SUCCESS_PATH = "/app/#shop-success";
const DEFAULT_CANCEL_PATH = "/app/#shop";
const MAX_QUANTITY = 6;
const SIZE_OPTIONS = ["S", "M", "L", "XL", "2XL"];
const DEFAULT_SS_FRONT_FILE_URL = `${DEFAULT_SITE}/merch/smartsleeve-ss-short-front-print.png`;
const DEFAULT_SQTS_FRONT_FILE_URL = `${DEFAULT_SITE}/merch/sqts-llc-front-print.png`;
const DEFAULT_TEE_BACK_FILE_URL = `${DEFAULT_SITE}/merch/ss_and_sqts_tee_back_print.png`;
const DEFAULT_TEE_BACK_QR_FILE_URL = `${DEFAULT_SITE}/merch/ss_and_sqts_tee_back_qr_print.png`;
const DEFAULT_TANK_BACK_FILE_URL = `${DEFAULT_SITE}/merch/ss_and_sqts_tank_back_print.png`;
const DEFAULT_TANK_BACK_QR_FILE_URL = `${DEFAULT_SITE}/merch/ss_and_sqts_tank_back_qr_print.png`;

function envSlug(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function merchProduct({
  name,
  description,
  sku,
  garment,
  frontFileUrlEnv,
  defaultFrontFileUrl,
  backFileUrlEnv,
  defaultBackFileUrl,
  hasBackPrint = true,
  unitAmount = 1999,
}) {
  const isTank = garment === "tank";
  const syncVariantPrefix = `PRINTFUL_SYNC_VARIANT_ID_${envSlug(sku)}`;
  return {
    name,
    description,
    unit_amount: unitAmount,
    currency: "usd",
    fulfillment_sku: sku,
    sync_variant_env_prefixes: [syncVariantPrefix],
    variant_env_prefixes: [
      isTank ? "PRINTFUL_VARIANT_ID_BLACK_TANK" : "PRINTFUL_VARIANT_ID_BLACK_TEE",
      isTank ? "PRINTFUL_VARIANT_ID_SMARTSLEEVE_SS_TANK" : "PRINTFUL_VARIANT_ID_SMARTSLEEVE_SS_TEE",
    ],
    fallback_variant_envs: [
      isTank ? "PRINTFUL_VARIANT_ID_BLACK_TANK" : "PRINTFUL_VARIANT_ID_BLACK_TEE",
      isTank ? "PRINTFUL_VARIANT_ID_SMARTSLEEVE_SS_TANK" : "PRINTFUL_VARIANT_ID_SMARTSLEEVE_SS_TEE",
    ],
    front_file_url_env: frontFileUrlEnv,
    default_front_file_url: defaultFrontFileUrl,
    has_back_print: hasBackPrint,
    back_file_url_env: hasBackPrint
      ? (backFileUrlEnv || (isTank ? "PRINTFUL_FILE_URL_SHARED_TANK_BACK" : "PRINTFUL_FILE_URL_SHARED_TEE_BACK"))
      : "",
    default_back_file_url: hasBackPrint
      ? (defaultBackFileUrl || (isTank ? DEFAULT_TANK_BACK_FILE_URL : DEFAULT_TEE_BACK_FILE_URL))
      : "",
  };
}

const PRODUCT_CATALOG = {
  "smartsleeve-ss-tee-brand": merchProduct({
    name: "SmartSleeve SS Tee",
    description: "Black tee with the SS chip mark, SmartSleeve lockup, and slogan front.",
    sku: "smartsleeve-ss-tee-brand",
    garment: "tee",
    frontFileUrlEnv: "PRINTFUL_FILE_URL_SMARTSLEEVE_SS_FRONT",
    defaultFrontFileUrl: DEFAULT_SS_FRONT_FILE_URL,
    hasBackPrint: false,
  }),
  "smartsleeve-ss-tee": merchProduct({
    name: "SmartSleeve SS Tee",
    description: "Black tee with the SS chip mark, SmartSleeve lockup, slogan front, and site URL back.",
    sku: "smartsleeve-ss-tee",
    garment: "tee",
    frontFileUrlEnv: "PRINTFUL_FILE_URL_SMARTSLEEVE_SS_FRONT",
    defaultFrontFileUrl: DEFAULT_SS_FRONT_FILE_URL,
  }),
  "smartsleeve-ss-tank-brand": merchProduct({
    name: "SmartSleeve SS Tank",
    description: "Black tank top with the SS chip mark, SmartSleeve lockup, and slogan front.",
    sku: "smartsleeve-ss-tank-brand",
    garment: "tank",
    frontFileUrlEnv: "PRINTFUL_FILE_URL_SMARTSLEEVE_SS_FRONT",
    defaultFrontFileUrl: DEFAULT_SS_FRONT_FILE_URL,
    hasBackPrint: false,
  }),
  "smartsleeve-ss-tank": merchProduct({
    name: "SmartSleeve SS Tank",
    description: "Black tank top with the SS chip mark, SmartSleeve lockup, slogan front, and site URL back.",
    sku: "smartsleeve-ss-tank",
    garment: "tank",
    frontFileUrlEnv: "PRINTFUL_FILE_URL_SMARTSLEEVE_SS_FRONT",
    defaultFrontFileUrl: DEFAULT_SS_FRONT_FILE_URL,
  }),
  "sqts-llc-tee-brand": merchProduct({
    name: "SQTS LLC Tee",
    description: "Black tee with the official SQTS LLC banner and slogan front.",
    sku: "sqts-llc-tee-brand",
    garment: "tee",
    frontFileUrlEnv: "PRINTFUL_FILE_URL_SQTS_LLC_FRONT",
    defaultFrontFileUrl: DEFAULT_SQTS_FRONT_FILE_URL,
    hasBackPrint: false,
  }),
  "sqts-llc-tee": merchProduct({
    name: "SQTS LLC Tee",
    description: "Black tee with the official SQTS LLC banner, slogan front, and site URL back.",
    sku: "sqts-llc-tee",
    garment: "tee",
    frontFileUrlEnv: "PRINTFUL_FILE_URL_SQTS_LLC_FRONT",
    defaultFrontFileUrl: DEFAULT_SQTS_FRONT_FILE_URL,
  }),
  "sqts-llc-tank-brand": merchProduct({
    name: "SQTS LLC Tank",
    description: "Black tank top with the official SQTS LLC banner and slogan front.",
    sku: "sqts-llc-tank-brand",
    garment: "tank",
    frontFileUrlEnv: "PRINTFUL_FILE_URL_SQTS_LLC_FRONT",
    defaultFrontFileUrl: DEFAULT_SQTS_FRONT_FILE_URL,
    hasBackPrint: false,
  }),
  "sqts-llc-tank": merchProduct({
    name: "SQTS LLC Tank",
    description: "Black tank top with the official SQTS LLC banner, slogan front, and site URL back.",
    sku: "sqts-llc-tank",
    garment: "tank",
    frontFileUrlEnv: "PRINTFUL_FILE_URL_SQTS_LLC_FRONT",
    defaultFrontFileUrl: DEFAULT_SQTS_FRONT_FILE_URL,
  }),
  "smartsleeve-ss-tee-promo": merchProduct({
    name: "SmartSleeve SS Tee QR Promo",
    description: "Black promotional tee with the SS front design and a scan-ready QR code on the back.",
    sku: "smartsleeve-ss-tee-promo",
    garment: "tee",
    frontFileUrlEnv: "PRINTFUL_FILE_URL_SMARTSLEEVE_SS_FRONT",
    defaultFrontFileUrl: DEFAULT_SS_FRONT_FILE_URL,
    backFileUrlEnv: "PRINTFUL_FILE_URL_SHARED_TEE_BACK_QR",
    defaultBackFileUrl: DEFAULT_TEE_BACK_QR_FILE_URL,
  }),
  "smartsleeve-ss-tank-promo": merchProduct({
    name: "SmartSleeve SS Tank QR Promo",
    description: "Black promotional tank with the SS front design and a scan-ready QR code on the back.",
    sku: "smartsleeve-ss-tank-promo",
    garment: "tank",
    frontFileUrlEnv: "PRINTFUL_FILE_URL_SMARTSLEEVE_SS_FRONT",
    defaultFrontFileUrl: DEFAULT_SS_FRONT_FILE_URL,
    backFileUrlEnv: "PRINTFUL_FILE_URL_SHARED_TANK_BACK_QR",
    defaultBackFileUrl: DEFAULT_TANK_BACK_QR_FILE_URL,
  }),
  "sqts-llc-tee-promo": merchProduct({
    name: "SQTS LLC Tee QR Promo",
    description: "Black promotional tee with the SQTS LLC front design and a scan-ready QR code on the back.",
    sku: "sqts-llc-tee-promo",
    garment: "tee",
    frontFileUrlEnv: "PRINTFUL_FILE_URL_SQTS_LLC_FRONT",
    defaultFrontFileUrl: DEFAULT_SQTS_FRONT_FILE_URL,
    backFileUrlEnv: "PRINTFUL_FILE_URL_SHARED_TEE_BACK_QR",
    defaultBackFileUrl: DEFAULT_TEE_BACK_QR_FILE_URL,
  }),
  "sqts-llc-tank-promo": merchProduct({
    name: "SQTS LLC Tank QR Promo",
    description: "Black promotional tank with the SQTS LLC front design and a scan-ready QR code on the back.",
    sku: "sqts-llc-tank-promo",
    garment: "tank",
    frontFileUrlEnv: "PRINTFUL_FILE_URL_SQTS_LLC_FRONT",
    defaultFrontFileUrl: DEFAULT_SQTS_FRONT_FILE_URL,
    backFileUrlEnv: "PRINTFUL_FILE_URL_SHARED_TANK_BACK_QR",
    defaultBackFileUrl: DEFAULT_TANK_BACK_QR_FILE_URL,
  }),
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

function normalizeSize(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return SIZE_OPTIONS.includes(normalized) ? normalized : "M";
}

function sizeVariantEnvName(product, size) {
  return `${product.variant_env_prefixes[0]}_${normalizeSize(size)}`;
}

function printfulVariantId(env, product, size) {
  const normalizedSize = normalizeSize(size);
  for (const prefix of product.variant_env_prefixes) {
    const sizeSpecific = Number(env[`${prefix}_${normalizedSize}`] || 0);
    if (sizeSpecific) {
      return sizeSpecific;
    }
  }
  for (const fallback of product.fallback_variant_envs) {
    const fallbackId = Number(env[fallback] || 0);
    if (fallbackId) {
      return fallbackId;
    }
  }
  return 0;
}

function printfulSyncVariantId(env, product, size) {
  const normalizedSize = normalizeSize(size);
  for (const prefix of product.sync_variant_env_prefixes || []) {
    const sizeSpecific = Number(env[`${prefix}_${normalizedSize}`] || 0);
    if (sizeSpecific) {
      return sizeSpecific;
    }
  }
  return 0;
}

function printfulFiles(env, product) {
  const frontUrl = String(env[product.front_file_url_env] || product.default_front_file_url || "").trim();
  const backUrl = product.has_back_print === false
    ? ""
    : String(env[product.back_file_url_env] || product.default_back_file_url || "").trim();
  const files = [];
  if (frontUrl) {
    files.push({ type: "front", url: frontUrl });
  }
  if (backUrl) {
    files.push({ type: "back", url: backUrl });
  }
  return files;
}

function productUnitAmount(env, product) {
  return productUnitAmountForSize(env, product, "M");
}

function productUnitAmountForSize(env, product, size) {
  const normalizedSize = normalizeSize(size);
  const sizePriceEnv = `MERCH_PRICE_USD_${envSlug(product.fulfillment_sku)}_${normalizedSize}`;
  const sizePriceUsd = Number(env[sizePriceEnv] || 0);
  if (Number.isFinite(sizePriceUsd) && sizePriceUsd > 0) {
    return Math.round(sizePriceUsd * 100);
  }
  const priceEnv = `MERCH_PRICE_USD_${envSlug(product.fulfillment_sku)}`;
  const priceUsd = Number(env[priceEnv] || 0);
  if (Number.isFinite(priceUsd) && priceUsd > 0) {
    return Math.round(priceUsd * 100);
  }
  return product.unit_amount;
}

function priceLabelForProduct(env, product) {
  const amounts = SIZE_OPTIONS.map((size) => productUnitAmountForSize(env, product, size));
  const min = Math.min(...amounts);
  const max = Math.max(...amounts);
  const format = (cents) => `$${(cents / 100).toFixed(2)}`;
  return min === max ? format(min) : `${format(min)}-${format(max)}`;
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
  const requestedSize = normalizeSize(body.size);
  const hasLockedSize = SIZE_OPTIONS.includes(String(body.size || "").trim().toUpperCase());
  const unitAmount = productUnitAmountForSize(env, product, requestedSize);
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
    "line_items[0][quantity]": quantity,
    "line_items[0][price_data][currency]": product.currency,
    "line_items[0][price_data][unit_amount]": unitAmount,
    "line_items[0][price_data][product_data][name]": hasLockedSize ? `${product.name} - ${requestedSize}` : product.name,
    "line_items[0][price_data][product_data][description]": product.description,
    "metadata[product_key]": productKey,
    "metadata[fulfillment_sku]": product.fulfillment_sku,
    "metadata[quantity]": String(quantity),
    "metadata[unit_amount]": String(unitAmount),
    "metadata[shirt_size]": requestedSize,
  };
  if (!hasLockedSize) {
    params["custom_fields[0][key]"] = "shirt_size";
    params["custom_fields[0][label][type]"] = "custom";
    params["custom_fields[0][label][custom]"] = "Shirt size";
    params["custom_fields[0][type]"] = "dropdown";
    SIZE_OPTIONS.forEach((size, index) => {
      params[`custom_fields[0][dropdown][options][${index}][label]`] = size;
      params[`custom_fields[0][dropdown][options][${index}][value]`] = size;
    });
  }
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
  if (session.metadata && session.metadata[key]) {
    return session.metadata[key];
  }
  const field = (session.custom_fields || []).find((item) => item.key === key);
  if (!field) {
    return "";
  }
  if (field.dropdown && field.dropdown.value) {
    return field.dropdown.value;
  }
  return field.text && field.text.value ? field.text.value : "";
}

function publicCatalog(env) {
  return {
    generated_at: new Date().toISOString(),
    source: "worker_env",
    currency: "USD",
    sizes: SIZE_OPTIONS,
    products: Object.entries(PRODUCT_CATALOG).map(([key, product]) => ({
      key,
      name: product.name,
      description: product.description,
      price_label: priceLabelForProduct(env, product),
      prices: SIZE_OPTIONS.reduce((acc, size) => {
        acc[size] = (productUnitAmountForSize(env, product, size) / 100).toFixed(2);
        return acc;
      }, {}),
    })),
  };
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
  const size = normalizeSize(customFieldValue(session, "shirt_size"));
  const shipping = session.shipping_details || {};
  const address = shipping.address || {};
  const customer = session.customer_details || {};
  const quantity = clampQuantity(session.metadata && session.metadata.quantity);
  const unitAmount = Math.max(0, Number(session.metadata && session.metadata.unit_amount) || product.unit_amount);
  const syncVariantId = printfulSyncVariantId(env, product, size);
  const item = {
    quantity,
    name: `${product.name} - ${size}`,
    retail_price: (unitAmount / 100).toFixed(2),
  };
  let fulfillmentMode = "sync_variant";
  let files = [];
  if (syncVariantId) {
    item.sync_variant_id = syncVariantId;
  } else {
    fulfillmentMode = "catalog_variant_files";
    const variantId = printfulVariantId(env, product, size);
    if (!variantId) {
      return {
        status: "skipped",
        reason: `${sizeVariantEnvName(product, size)} or ${product.sync_variant_env_prefixes[0]}_${size} not configured`,
        product_key: productKey,
        size,
      };
    }
    files = printfulFiles(env, product);
    if (files.length === 0) {
      return {
        status: "skipped",
        reason: "Printful front/back print file URLs not configured",
        product_key: productKey,
        size,
      };
    }
    item.variant_id = variantId;
    item.files = files;
  }
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
    items: [item],
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
    product_key: productKey,
    size,
    fulfillment_mode: fulfillmentMode,
    sync_variant_id: syncVariantId || undefined,
    print_files: files,
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
      size: customFieldValue(session, "shirt_size"),
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
  const paymentStatus = String(session.payment_status || "").toLowerCase();
  const fulfillment = paymentStatus === "paid"
    ? await maybeFulfill(env, session)
    : { status: "skipped", reason: `payment_status=${paymentStatus || "unknown"}` };
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
        products: Object.keys(PRODUCT_CATALOG),
      });
    }
    if (request.method === "GET" && url.pathname === "/catalog") {
      return jsonResponse(request, env, publicCatalog(env));
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
