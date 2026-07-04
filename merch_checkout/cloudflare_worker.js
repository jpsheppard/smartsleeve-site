// SmartSleeve merch checkout Worker.
//
// Merchant-of-record model:
//   Customer -> Stripe Checkout -> SmartSleeve Quantitative Trading Systems, LLC
//   SmartSleeve -> print-on-demand vendor fulfillment expense
//
// Required Worker secrets:
//   STRIPE_SECRET_KEY
//   STRIPE_WEBHOOK_SECRET
//   MERCH_ADMIN_TOKEN, for manual fulfillment recovery
//   RESEND_API_KEY, for SmartSleeve Shop customer receipts
//
// Optional Worker bindings/secrets:
//   MERCH_ORDERS KV binding
//   MERCH_ALLOWED_ORIGINS
//   MERCH_SITE_URL
//   MERCH_SUCCESS_PATH
//   MERCH_CANCEL_PATH
//   MERCH_SHIPPING_USD
//   MERCH_INCLUDED_SHIPPING_USD
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
//   PRINTFUL_FILE_URL_SQTS_LLC_FRONT
//   PRINTFUL_FILE_URL_SHARED_TEE_BACK
//   PRINTFUL_FILE_URL_SHARED_TEE_BACK_QR
//   PRINTFUL_FILE_URL_SHARED_TANK_BACK
//   PRINTFUL_FILE_URL_SHARED_TANK_BACK_QR
//   PRINTFUL_CONFIRM_ORDERS=true
//   PRINTFUL_WEBHOOK_SECRET
//   MERCH_RECEIPT_FROM_EMAIL="SmartSleeve Shop <shop@smartsleeve.ai>"
//   MERCH_RECEIPT_REPLY_TO_EMAIL="SmartSleeve Shop <shop@smartsleeve.ai>"
//
// Routes:
//   GET  /health
//   GET  /catalog
//   POST /checkout
//   POST /stripe-webhook
//   POST /printful-webhook
//   POST /admin/retry-printful
//   POST /admin/send-receipt
//   POST /admin/poll-printful

const DEFAULT_SITE = "https://smartsleeve.ai";
const DEFAULT_SUCCESS_PATH = "/app/#shop-success";
const DEFAULT_CANCEL_PATH = "/app/#shop";
const DEFAULT_RECEIPT_FROM_EMAIL = "SmartSleeve Shop <shop@smartsleeve.ai>";
const DEFAULT_RECEIPT_REPLY_TO_EMAIL = "SmartSleeve Shop <shop@smartsleeve.ai>";
const MAX_QUANTITY = 6;
const MAX_CART_LINES = 30;
const APPAREL_SIZE_OPTIONS = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL"];
const SOCK_SIZE_OPTIONS = ["SM", "LXL"];
const DIMENSION_SIZE_OPTIONS = ["16X24", "28X16", "30X60", "36X72"];
const SIZE_OPTIONS = ["OS", ...SOCK_SIZE_OPTIONS, ...DIMENSION_SIZE_OPTIONS, ...APPAREL_SIZE_OPTIONS];
const DEFAULT_SQTS_FRONT_FILE_URL = `${DEFAULT_SITE}/merch/sqts-llc-front-print.png`;
const DEFAULT_TEE_BACK_FILE_URL = `${DEFAULT_SITE}/merch/ss_and_sqts_tee_back_print.png`;
const DEFAULT_TEE_BACK_QR_FILE_URL = `${DEFAULT_SITE}/merch/ss_and_sqts_tee_back_qr_print.png`;
const DEFAULT_TANK_BACK_FILE_URL = `${DEFAULT_SITE}/merch/ss_and_sqts_tank_back_print.png`;
const DEFAULT_TANK_BACK_QR_FILE_URL = `${DEFAULT_SITE}/merch/ss_and_sqts_tank_back_qr_print.png`;
const PRINTFUL_POLL_DEFAULT_LIMIT = 75;
const PRINTFUL_POLL_DEFAULT_LOOKBACK_DAYS = 60;

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

function dynamicProductFromEnv(env, productKey) {
  const sku = normalizeProductKey(productKey);
  if (!sku) {
    return null;
  }
  const slug = envSlug(sku);
  const hasSyncVariant = SIZE_OPTIONS.some((size) => Number(env[`PRINTFUL_SYNC_VARIANT_ID_${slug}_${size}`] || 0));
  const configuredName = String(env[`MERCH_PRODUCT_NAME_${slug}`] || "").trim();
  if (!configuredName && !hasSyncVariant) {
    return null;
  }
  return {
    name: configuredName || sku,
    description: String(env[`MERCH_PRODUCT_DESCRIPTION_${slug}`] || "Published Printful product synced for SmartSleeve checkout."),
    unit_amount: 1999,
    currency: "usd",
    fulfillment_sku: sku,
    sync_variant_env_prefixes: [`PRINTFUL_SYNC_VARIANT_ID_${slug}`],
    variant_env_prefixes: [`PRINTFUL_VARIANT_ID_${slug}`],
    fallback_variant_envs: [],
    front_file_url_env: "",
    default_front_file_url: "",
    has_back_print: false,
    back_file_url_env: "",
    default_back_file_url: "",
    preview_url: String(env[`MERCH_PRODUCT_PREVIEW_${slug}`] || "").trim(),
    front_mockup_url: String(env[`MERCH_PRODUCT_FRONT_MOCKUP_${slug}`] || env[`MERCH_PRODUCT_PREVIEW_${slug}`] || "").trim(),
    back_mockup_url: String(env[`MERCH_PRODUCT_BACK_MOCKUP_${slug}`] || "").trim(),
  };
}

function isPublicSqtsProduct(productKey, product) {
  const key = normalizeProductKey(productKey);
  const name = String(product && product.name || "").toLowerCase();
  if (!key || key.includes("smartsleeve-ss") || name.includes("smartsleeve ss") || name.includes(" ss -") || name.includes(" ss ")) {
    return false;
  }
  if (key.includes("muscle-tee") || name.includes("muscle tee")) {
    return false;
  }
  return key.includes("sqts") || name.includes("sqts");
}

function isPublicMerchProduct(productKey, product) {
  return Boolean(normalizeProductKey(productKey) && product && product.name);
}

function catalogProduct(env, productKey) {
  const normalized = normalizeProductKey(productKey);
  const product = PRODUCT_CATALOG[normalized] || dynamicProductFromEnv(env, normalized);
  return isPublicMerchProduct(normalized, product) ? product : null;
}

function siteUrl(env) {
  return String(env.MERCH_SITE_URL || DEFAULT_SITE).replace(/\/$/, "");
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function normalizedCheckoutMode(value) {
  return String(value || "").trim().toLowerCase() === "create_account" ? "create_account" : "guest";
}

function safeMetadataValue(value, maxLength = 450) {
  return String(value || "").trim().slice(0, maxLength);
}

function centsFromUsd(value, fallback = 0) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    return fallback;
  }
  return Math.round(amount * 100);
}

function formatMoney(cents, currency = "usd") {
  const amount = Math.max(0, Math.round(Number(cents) || 0)) / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: String(currency || "usd").toUpperCase(),
  }).format(amount);
}

function printfulMoney(cents) {
  return (Math.max(0, Math.round(Number(cents) || 0)) / 100).toFixed(2);
}

function printfulRetailCostsForSession(session, checkoutItems) {
  const itemSubtotal = checkoutItems.reduce((sum, item) => {
    return sum + (Math.max(0, Number(item.unit_amount) || 0) * Math.max(1, Number(item.quantity) || 1));
  }, 0);
  const totalDetails = session.total_details || {};
  const subtotal = Math.max(0, Number(session.amount_subtotal) || itemSubtotal);
  const tax = Math.max(0, Number(totalDetails.amount_tax) || 0);
  const shipping = Math.max(0, Number(totalDetails.amount_shipping) || 0);
  const discount = Math.max(0, Number(totalDetails.amount_discount) || 0);
  const total = Math.max(0, Number(session.amount_total) || (subtotal + tax + shipping - discount));
  return {
    currency: String(session.currency || "usd").toUpperCase(),
    subtotal: printfulMoney(subtotal),
    discount: printfulMoney(discount),
    shipping: printfulMoney(shipping),
    tax: printfulMoney(tax),
    total: printfulMoney(total),
  };
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function productMockupUrl(env, productKey, side = "front") {
  const normalized = normalizeProductKey(productKey);
  const normalizedSide = side === "back" ? "back" : "front";
  return normalized ? `${siteUrl(env)}/merch/mockups/${normalized}-${normalizedSide}.jpg` : "";
}

function absoluteProductImageUrl(env, value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  if (text.startsWith("/")) {
    return `${siteUrl(env)}${text}`;
  }
  return /^https:\/\//i.test(text) ? text : "";
}

function productImageUrl(env, productKey) {
  const product = catalogProduct(env, productKey);
  const configured = product
    ? absoluteProductImageUrl(env, product.front_mockup_url || product.preview_url)
    : "";
  return configured || productMockupUrl(env, productKey, "front");
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
    "Access-Control-Allow-Headers": "Authorization,Content-Type,Stripe-Signature",
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
  const dimension = normalized
    .replace(/[″“”"]/g, "")
    .replace(/'/g, "")
    .replace(/×/g, "X")
    .replace(/\s+/g, "");
  if (DIMENSION_SIZE_OPTIONS.includes(dimension)) {
    return dimension;
  }
  if (/^(OS|ONE[\s_-]*SIZE|ONE SIZE)$/.test(normalized)) {
    return "OS";
  }
  if (/^(S[\s_/-]*M|SM)$/.test(normalized)) {
    return "SM";
  }
  if (/^(L[\s_/-]*XL|LXL)$/.test(normalized)) {
    return "LXL";
  }
  return SIZE_OPTIONS.includes(normalized) ? normalized : "M";
}

function isOneSizeProduct(product) {
  return /mouse\s*pad|mousepad/i.test(`${product && product.name || ""} ${product && product.fulfillment_sku || ""}`);
}

function displaySize(size) {
  const normalized = normalizeSize(size);
  if (normalized === "OS") {
    return "One Size";
  }
  if (normalized === "SM") {
    return "S/M";
  }
  if (normalized === "LXL") {
    return "L/XL";
  }
  if (normalized === "16X24") {
    return "16 x 24";
  }
  if (normalized === "28X16") {
    return "28 x 16";
  }
  if (normalized === "30X60") {
    return "30 x 60";
  }
  if (normalized === "36X72") {
    return "36 x 72";
  }
  return normalized;
}

function itemOptionLabel(size) {
  return normalizeSize(size) === "OS" ? "One Size" : `Size ${displaySize(size)}`;
}

function productNameWithOption(productName, size) {
  return `${productName} - ${displaySize(size)}`;
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
  const includedShippingCents = centsFromUsd(env.MERCH_INCLUDED_SHIPPING_USD, 0);
  const sizePriceEnv = `MERCH_PRICE_USD_${envSlug(product.fulfillment_sku)}_${normalizedSize}`;
  const sizePriceUsd = Number(env[sizePriceEnv] || 0);
  if (Number.isFinite(sizePriceUsd) && sizePriceUsd > 0) {
    return Math.round(sizePriceUsd * 100) + includedShippingCents;
  }
  const priceEnv = `MERCH_PRICE_USD_${envSlug(product.fulfillment_sku)}`;
  const priceUsd = Number(env[priceEnv] || 0);
  if (Number.isFinite(priceUsd) && priceUsd > 0) {
    return Math.round(priceUsd * 100) + includedShippingCents;
  }
  return product.unit_amount + includedShippingCents;
}

function availableSizesForProduct(env, product) {
  const slug = envSlug(product.fulfillment_sku);
  const sizes = SIZE_OPTIONS.filter((size) => (
    env[`MERCH_PRICE_USD_${slug}_${size}`] || env[`PRINTFUL_SYNC_VARIANT_ID_${slug}_${size}`]
  ));
  if (sizes.length > 0) {
    return sizes;
  }
  return isOneSizeProduct(product) ? ["OS"] : APPAREL_SIZE_OPTIONS;
}

function priceLabelForProduct(env, product) {
  const amounts = availableSizesForProduct(env, product).map((size) => productUnitAmountForSize(env, product, size));
  const min = Math.min(...amounts);
  const max = Math.max(...amounts);
  const format = (cents) => `$${(cents / 100).toFixed(2)}`;
  return min === max ? format(min) : `${format(min)}-${format(max)}`;
}

function orderKey(sessionId) {
  return `stripe:session:${sessionId}`;
}

function printfulExternalId(sessionId) {
  const clean = String(sessionId || "smartsleeve-order").replace(/[^A-Za-z0-9-]/g, "-");
  if (clean.length <= 32) {
    return clean;
  }
  return `ss-${clean.slice(-24)}`;
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

function normalizeCheckoutItems(env, body) {
  const rawItems = Array.isArray(body.items) && body.items.length > 0
    ? body.items
    : [{
        product_key: body.product_key,
        quantity: body.quantity,
        size: body.size,
      }];
  const merged = new Map();
  rawItems.slice(0, MAX_CART_LINES).forEach((rawItem) => {
    const productKey = normalizeProductKey(rawItem && rawItem.product_key);
    const product = catalogProduct(env, productKey);
    if (!product) {
      return;
    }
    const size = normalizeSize(rawItem && rawItem.size);
    const key = `${productKey}|${size}`;
    const existing = merged.get(key);
    const quantity = clampQuantity(rawItem && rawItem.quantity);
    if (existing) {
      existing.quantity = clampQuantity(existing.quantity + quantity);
    } else {
      merged.set(key, {
        product_key: productKey,
        product,
        size,
        quantity,
        unit_amount: productUnitAmountForSize(env, product, size),
      });
    }
  });
  return Array.from(merged.values());
}

function stripeLineItemProductMetadata(item) {
  return {
    product_key: item.product_key,
    fulfillment_sku: item.product.fulfillment_sku,
    merch_size: item.size,
    shirt_size: item.size,
  };
}

async function createStripeCheckoutSession(request, env) {
  if (!env.STRIPE_SECRET_KEY) {
    return jsonResponse(request, env, { error: "Stripe secret is not configured" }, 503);
  }
  const body = await readJson(request);
  const items = normalizeCheckoutItems(env, body);
  if (items.length === 0) {
    return jsonResponse(request, env, { error: "Cart is empty or contains unknown merch products" }, 400);
  }
  const customerEmail = normalizeEmail(body.customer_email || body.email);
  if (!isValidEmail(customerEmail)) {
    return jsonResponse(request, env, { error: "A valid customer email is required for merch receipts" }, 400);
  }
  const checkoutMode = normalizedCheckoutMode(body.checkout_mode);
  const accountUsername = safeMetadataValue(body.account_username || body.username, 64);
  const shippingCents = centsFromUsd(env.MERCH_SHIPPING_USD, 0);
  const base = siteUrl(env);
  const successPath = String(env.MERCH_SUCCESS_PATH || DEFAULT_SUCCESS_PATH);
  const cancelPath = String(env.MERCH_CANCEL_PATH || DEFAULT_CANCEL_PATH);
  const params = {
    mode: "payment",
    success_url: `${base}${successPath}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}${cancelPath}`,
    customer_email: customerEmail,
    "shipping_address_collection[allowed_countries][0]": "US",
    "metadata[cart_mode]": items.length > 1 ? "cart" : "single",
    "metadata[item_count]": String(items.length),
    "metadata[customer_email]": customerEmail,
    "metadata[checkout_mode]": checkoutMode,
  };
  if (accountUsername) {
    params["metadata[account_username]"] = accountUsername;
  }
  items.forEach((item, index) => {
    const metadata = stripeLineItemProductMetadata(item);
    const imageUrl = productImageUrl(env, item.product_key);
    params[`line_items[${index}][quantity]`] = item.quantity;
    params[`line_items[${index}][price_data][currency]`] = item.product.currency;
    params[`line_items[${index}][price_data][unit_amount]`] = item.unit_amount;
    params[`line_items[${index}][price_data][product_data][name]`] = productNameWithOption(item.product.name, item.size);
    params[`line_items[${index}][price_data][product_data][description]`] = item.product.description;
    if (imageUrl) {
      params[`line_items[${index}][price_data][product_data][images][0]`] = imageUrl;
    }
    Object.entries(metadata).forEach(([key, value]) => {
      params[`line_items[${index}][price_data][product_data][metadata][${key}]`] = value;
    });
  });
  if (items.length === 1) {
    params["metadata[product_key]"] = items[0].product_key;
    params["metadata[fulfillment_sku]"] = items[0].product.fulfillment_sku;
    params["metadata[quantity]"] = String(items[0].quantity);
    params["metadata[unit_amount]"] = String(items[0].unit_amount);
    params["metadata[merch_size]"] = items[0].size;
    params["metadata[shirt_size]"] = items[0].size;
  }
  if (shippingCents > 0) {
    params["shipping_options[0][shipping_rate_data][type]"] = "fixed_amount";
    params["shipping_options[0][shipping_rate_data][fixed_amount][currency]"] = "usd";
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
    item_count: items.length,
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

function timingSafeStringEqual(left, right) {
  const encoder = new TextEncoder();
  return timingSafeEqual(encoder.encode(String(left || "")), encoder.encode(String(right || "")));
}

function bearerToken(request) {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function isAdminAuthorized(request, env) {
  const expected = String(env.MERCH_ADMIN_TOKEN || "").trim();
  const actual = bearerToken(request);
  return Boolean(expected && actual && timingSafeStringEqual(actual, expected));
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

async function fetchStripeCheckoutLineItems(env, sessionId) {
  if (!env.STRIPE_SECRET_KEY || !sessionId) {
    return [];
  }
  const url = new URL(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}/line_items`);
  url.searchParams.set("limit", "100");
  url.searchParams.append("expand[]", "data.price.product");
  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(payload.data)) {
    return [];
  }
  return payload.data;
}

async function fetchStripeCheckoutSession(env, sessionId, expand = []) {
  if (!env.STRIPE_SECRET_KEY || !sessionId) {
    return null;
  }
  const url = new URL(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`);
  expand.forEach((item) => {
    if (item) {
      url.searchParams.append("expand[]", item);
    }
  });
  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { error: payload.error || payload, http_status: response.status };
  }
  return payload;
}

async function fetchStripePaymentIntent(env, paymentIntentId) {
  const id = typeof paymentIntentId === "object" && paymentIntentId ? paymentIntentId.id : paymentIntentId;
  if (!env.STRIPE_SECRET_KEY || !id) {
    return null;
  }
  const url = new URL(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(id)}`);
  url.searchParams.append("expand[]", "latest_charge");
  url.searchParams.append("expand[]", "payment_method");
  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { error: payload.error || payload, http_status: response.status };
  }
  return payload;
}

async function checkoutItemsForFulfillment(env, session) {
  const lineItems = await fetchStripeCheckoutLineItems(env, session.id);
  const fromLineItems = lineItems
    .map((lineItem) => {
      const productData = lineItem.price && lineItem.price.product && typeof lineItem.price.product === "object"
        ? lineItem.price.product
        : {};
      const metadata = productData.metadata || {};
      const productKey = normalizeProductKey(metadata.product_key);
      const product = catalogProduct(env, productKey);
      if (!product) {
        return null;
      }
      return {
        product_key: productKey,
        product,
        size: normalizeSize(metadata.merch_size || metadata.shirt_size),
        quantity: clampQuantity(lineItem.quantity),
        unit_amount: Math.max(0, Number(lineItem.price && lineItem.price.unit_amount) || productUnitAmountForSize(env, product, metadata.merch_size || metadata.shirt_size)),
      };
    })
    .filter(Boolean);
  if (fromLineItems.length > 0) {
    return fromLineItems;
  }
  const productKey = normalizeProductKey(session.metadata && session.metadata.product_key);
  const product = catalogProduct(env, productKey);
  if (!product) {
    return [];
  }
  const size = normalizeSize(customFieldValue(session, "merch_size") || customFieldValue(session, "shirt_size"));
  return [{
    product_key: productKey,
    product,
    size,
    quantity: clampQuantity(session.metadata && session.metadata.quantity),
    unit_amount: Math.max(0, Number(session.metadata && session.metadata.unit_amount) || productUnitAmountForSize(env, product, size)),
  }];
}

function publicCatalog(env) {
  const products = new Map();
  const hasSyncedPrintfulProducts = Object.keys(env).some((key) => key.startsWith("PRINTFUL_SYNC_PRODUCT_ID_"));
  if (!hasSyncedPrintfulProducts) {
    Object.entries(PRODUCT_CATALOG).forEach(([key, product]) => {
      if (isPublicMerchProduct(key, product)) {
        products.set(key, product);
      }
    });
  }
  Object.keys(env).forEach((key) => {
    const match = key.match(/^PRINTFUL_SYNC_PRODUCT_ID_(.+)$/);
    if (!match) {
      return;
    }
    const slug = match[1];
    const productKey = normalizeProductKey(env[`MERCH_PRODUCT_KEY_${slug}`] || slug.toLowerCase().replace(/_/g, "-"));
    const product = dynamicProductFromEnv(env, productKey);
    if (product && isPublicMerchProduct(productKey, product)) {
      products.set(productKey, product);
    }
  });
  return {
    generated_at: new Date().toISOString(),
    source: "worker_env",
    currency: "USD",
    sizes: SIZE_OPTIONS,
    products: Array.from(products.entries()).map(([key, product]) => {
      const sizes = availableSizesForProduct(env, product);
      const frontMockupUrl = product.front_mockup_url || productMockupUrl(env, key, "front");
      const backMockupUrl = product.back_mockup_url || productMockupUrl(env, key, "back");
      return {
        key,
        name: product.name,
        description: product.description,
        price_label: priceLabelForProduct(env, product),
        preview: product.preview_url || frontMockupUrl,
        front_mockup: frontMockupUrl,
        back_mockup: backMockupUrl,
        sizes,
        prices: sizes.reduce((acc, size) => {
          acc[size] = (productUnitAmountForSize(env, product, size) / 100).toFixed(2);
          return acc;
        }, {}),
      };
    }),
  };
}

async function submitPrintfulOrder(env, session) {
  if (!env.PRINTFUL_API_KEY) {
    return { status: "skipped", reason: "PRINTFUL_API_KEY not configured" };
  }
  const checkoutItems = await checkoutItemsForFulfillment(env, session);
  if (checkoutItems.length === 0) {
    return { status: "skipped", reason: "no fulfillable checkout line items" };
  }
  const shipping = session.shipping_details
    || (session.collected_information && session.collected_information.shipping_details)
    || {};
  const address = shipping.address || {};
  const customer = session.customer_details || {};
  const collectedInformation = session.collected_information || {};
  const printfulItems = [];
  const itemSummaries = [];
  for (const checkoutItem of checkoutItems) {
    const { productKey, product, size, quantity, unitAmount } = {
      productKey: checkoutItem.product_key,
      product: checkoutItem.product,
      size: checkoutItem.size,
      quantity: checkoutItem.quantity,
      unitAmount: checkoutItem.unit_amount,
    };
    const syncVariantId = printfulSyncVariantId(env, product, size);
    const item = {
      quantity,
      name: productNameWithOption(product.name, size),
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
    printfulItems.push(item);
    itemSummaries.push({
      product_key: productKey,
      size,
      quantity,
      fulfillment_mode: fulfillmentMode,
      sync_variant_id: syncVariantId || undefined,
      print_files: files,
    });
  }
  const order = {
    external_id: printfulExternalId(session.id),
    recipient: {
      name: shipping.name
        || customer.name
        || collectedInformation.individual_name
        || collectedInformation.business_name
        || "SmartSleeve customer",
      email: customer.email || "",
      address1: address.line1 || "",
      address2: address.line2 || "",
      city: address.city || "",
      state_code: address.state || "",
      country_code: address.country || "US",
      zip: address.postal_code || "",
    },
    items: printfulItems,
    retail_costs: printfulRetailCostsForSession(session, checkoutItems),
  };
  const confirm = String(env.PRINTFUL_CONFIRM_ORDERS || "").toLowerCase() === "true";
  const storeId = String(env.PRINTFUL_STORE_ID || "").trim();
  if (!storeId) {
    return {
      status: "skipped",
      reason: "PRINTFUL_STORE_ID not configured",
      item_count: itemSummaries.length,
    };
  }
  const response = await fetch(`https://api.printful.com/orders?confirm=${confirm ? "1" : "0"}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.PRINTFUL_API_KEY}`,
      "Content-Type": "application/json",
      "X-PF-Store-Id": storeId,
    },
    body: JSON.stringify(order),
  });
  const payload = await response.json().catch(() => ({}));
  return {
    status: response.ok ? "submitted" : "failed",
    provider: "printful",
    confirm,
    item_count: itemSummaries.length,
    items: itemSummaries,
    store_id: storeId,
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

function sessionShippingDetails(session) {
  return session.shipping_details
    || (session.collected_information && session.collected_information.shipping_details)
    || {};
}

function addressLines(contact, fallbackName = "") {
  const address = contact && contact.address ? contact.address : {};
  const lines = [];
  const name = String((contact && contact.name) || fallbackName || "").trim();
  if (name) {
    lines.push(name);
  }
  if (address.line1) {
    lines.push(address.line1);
  }
  if (address.line2) {
    lines.push(address.line2);
  }
  const cityStateZip = [
    [address.city, address.state].filter(Boolean).join(", "),
    address.postal_code,
  ].filter(Boolean).join(" ");
  if (cityStateZip) {
    lines.push(cityStateZip);
  }
  if (address.country) {
    lines.push(address.country);
  }
  return lines.length ? lines : ["Address not provided"];
}

function addressHtml(lines) {
  return lines.map((line) => escapeHtml(line)).join("<br>");
}

function addressText(lines) {
  return lines.join("\n");
}

function titleCasePaymentType(value) {
  return String(value || "payment method")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function cardDescriptor(card) {
  const last4 = card && String(card.last4 || "").replace(/\D/g, "").slice(-4);
  if (!last4) {
    return "";
  }
  const brand = titleCasePaymentType(card.brand || "Card");
  return `${brand} ********${last4}`;
}

function paymentDescriptor(paymentIntent) {
  if (!paymentIntent || paymentIntent.error) {
    return "Payment method recorded by Stripe";
  }
  const charge = paymentIntent.latest_charge && typeof paymentIntent.latest_charge === "object"
    ? paymentIntent.latest_charge
    : {};
  const details = charge.payment_method_details || {};
  const cardFromCharge = details.card ? cardDescriptor(details.card) : "";
  if (cardFromCharge) {
    return cardFromCharge;
  }
  const method = paymentIntent.payment_method && typeof paymentIntent.payment_method === "object"
    ? paymentIntent.payment_method
    : {};
  const cardFromMethod = method.card ? cardDescriptor(method.card) : "";
  if (cardFromMethod) {
    return cardFromMethod;
  }
  const type = details.type || method.type;
  return type ? titleCasePaymentType(type) : "Payment method recorded by Stripe";
}

function envInt(env, key, fallback) {
  const value = Number(env[key]);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : fallback;
}

function orderDate(session) {
  const created = Number(session && session.created);
  return Number.isFinite(created) && created > 0
    ? new Date(created * 1000)
    : new Date();
}

function addBusinessDays(date, days) {
  const result = new Date(date.getTime());
  let remaining = Math.max(0, Math.round(days));
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    const day = result.getUTCDay();
    if (day !== 0 && day !== 6) {
      remaining -= 1;
    }
  }
  return result;
}

function formatReceiptDate(date) {
  return date.toLocaleDateString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatReceiptDateRange(start, end) {
  if (!(start instanceof Date) || Number.isNaN(start.getTime())) {
    return "";
  }
  if (!(end instanceof Date) || Number.isNaN(end.getTime())) {
    return formatReceiptDate(start);
  }
  if (start.toDateString() === end.toDateString()) {
    return formatReceiptDate(start);
  }
  const sameMonth = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth();
  if (sameMonth) {
    return `${start.toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "long" })} ${start.getDate()}-${end.getDate()}, ${end.getFullYear()}`;
  }
  return `${formatReceiptDate(start)}-${formatReceiptDate(end)}`;
}

function parseReceiptDate(value) {
  if (!value) {
    return null;
  }
  const parsed = new Date(String(value).trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function metadataValue(session, keys) {
  const metadata = session && session.metadata ? session.metadata : {};
  for (const key of keys) {
    const value = metadata[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}

function objectValuesByKey(value, keyPattern, depth = 0, found = []) {
  if (!value || depth > 5 || found.length > 10) {
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => objectValuesByKey(item, keyPattern, depth + 1, found));
    return found;
  }
  if (typeof value !== "object") {
    return found;
  }
  Object.entries(value).forEach(([key, child]) => {
    if (keyPattern.test(key) && child !== undefined && child !== null && String(child).trim()) {
      found.push(String(child).trim());
    }
    objectValuesByKey(child, keyPattern, depth + 1, found);
  });
  return found;
}

function publicCustomerUrl(value) {
  const text = String(value || "").trim();
  if (!/^https:\/\/.+/i.test(text)) {
    return "";
  }
  try {
    const url = new URL(text);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    if (host === "dashboard.stripe.com" || host === "api.stripe.com") {
      return "";
    }
    if (host === "www.printful.com" && path.startsWith("/dashboard")) {
      return "";
    }
    if (host === "api.printful.com") {
      return "";
    }
    return url.toString();
  } catch (_err) {
    return "";
  }
}

function firstPublicUrl(values) {
  for (const value of values) {
    const url = publicCustomerUrl(value);
    if (url) {
      return url;
    }
  }
  return "";
}

function fulfillmentResult(fulfillment) {
  const response = fulfillment && fulfillment.provider_response ? fulfillment.provider_response : {};
  return response.result || response.data || response;
}

function fulfillmentStatusText(fulfillment) {
  if (!fulfillment) {
    return "SmartSleeve is waiting for order fulfillment.";
  }
  if (fulfillment.status === "delivered") {
    return "The carrier reported this SmartSleeve order delivered.";
  }
  if (fulfillment.status === "shipped") {
    return "This SmartSleeve order has shipped.";
  }
  if (fulfillment.status === "submitted") {
    return "SmartSleeve is waiting for order fulfillment.";
  }
  if (fulfillment.status === "failed") {
    return "SmartSleeve is reviewing the order status.";
  }
  return "SmartSleeve is processing the order.";
}

function fulfillmentTrackingUrl(session, fulfillment) {
  return firstPublicUrl([
    metadataValue(session, ["tracking_url", "shipment_tracking_url", "carrier_tracking_url"]),
    ...objectValuesByKey(fulfillmentResult(fulfillment), /tracking.*url|tracking_url|shipment.*url/i),
  ]);
}

function fulfillmentStatusUrl(session, fulfillment) {
  return firstPublicUrl([
    metadataValue(session, ["order_status_url", "status_url", "customer_order_url", "customer_status_url"]),
    ...objectValuesByKey(fulfillmentResult(fulfillment), /status.*url|order.*url|tracking.*url/i),
  ]);
}

function explicitDateRange(session, fulfillment, prefixPattern) {
  const fromKeys = prefixPattern === "delivery"
    ? ["estimated_delivery_from", "delivery_from", "delivery_estimate_from"]
    : ["estimated_fulfillment_from", "fulfillment_from", "fulfillment_estimate_from"];
  const toKeys = prefixPattern === "delivery"
    ? ["estimated_delivery_to", "delivery_to", "delivery_estimate_to"]
    : ["estimated_fulfillment_to", "fulfillment_to", "fulfillment_estimate_to"];
  const singleKeys = prefixPattern === "delivery"
    ? ["estimated_delivery_date", "estimated_delivery", "delivery_estimate"]
    : ["estimated_fulfillment_date", "estimated_fulfillment", "fulfillment_estimate"];
  const data = fulfillmentResult(fulfillment);
  const from = parseReceiptDate(metadataValue(session, fromKeys))
    || parseReceiptDate(objectValuesByKey(data, new RegExp(`${prefixPattern}.*(from|start|begin)`, "i"))[0]);
  const to = parseReceiptDate(metadataValue(session, toKeys))
    || parseReceiptDate(objectValuesByKey(data, new RegExp(`${prefixPattern}.*(to|end)`, "i"))[0]);
  const single = metadataValue(session, singleKeys)
    || objectValuesByKey(data, new RegExp(`estimated.*${prefixPattern}|${prefixPattern}.*estimate|${prefixPattern}.*date`, "i"))[0];
  const singleDate = parseReceiptDate(single);
  if (from || to) {
    return { start: from || to, end: to || from, source: prefixPattern };
  }
  if (singleDate) {
    return { start: singleDate, end: singleDate, source: prefixPattern };
  }
  if (single && /\d/.test(single)) {
    return { label: single, source: prefixPattern };
  }
  return null;
}

function estimatedDeliveryDetails(env, session, fulfillment) {
  const delivery = explicitDateRange(session, fulfillment, "delivery");
  if (delivery) {
    return {
      label: delivery.label || formatReceiptDateRange(delivery.start, delivery.end),
      basis: "carrier/vendor delivery estimate",
    };
  }
  const shippingMin = envInt(env, "MERCH_DOMESTIC_SHIPPING_BUSINESS_DAYS_MIN", 3);
  const shippingMax = envInt(env, "MERCH_DOMESTIC_SHIPPING_BUSINESS_DAYS_MAX", 8);
  const fulfillmentRange = explicitDateRange(session, fulfillment, "fulfillment");
  if (fulfillmentRange && fulfillmentRange.start) {
    return {
      label: formatReceiptDateRange(
        addBusinessDays(fulfillmentRange.start, shippingMin),
        addBusinessDays(fulfillmentRange.end || fulfillmentRange.start, shippingMax),
      ),
      basis: "estimated fulfillment plus domestic shipping",
    };
  }
  const fulfillmentMin = envInt(env, "MERCH_FULFILLMENT_BUSINESS_DAYS_MIN", 2);
  const fulfillmentMax = envInt(env, "MERCH_FULFILLMENT_BUSINESS_DAYS_MAX", 7);
  return {
    label: formatReceiptDateRange(
      addBusinessDays(orderDate(session), fulfillmentMin + shippingMin),
      addBusinessDays(orderDate(session), fulfillmentMax + shippingMax),
    ),
    basis: "best available 80% estimated range",
  };
}

function trackingText(env, session, fulfillment) {
  const url = fulfillmentTrackingUrl(session, fulfillment);
  if (url) {
    return `Track shipment: ${url}`;
  }
  const delivery = estimatedDeliveryDetails(env, session, fulfillment);
  return `${fulfillmentStatusText(fulfillment)} Estimated delivery: ${delivery.label} (${delivery.basis}). Tracking will be available after the order ships.`;
}

function trackingHtml(env, session, fulfillment) {
  const url = fulfillmentTrackingUrl(session, fulfillment);
  if (url) {
    return `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`;
  }
  return escapeHtml(trackingText(env, session, fulfillment));
}

function orderStatusText(session, fulfillment) {
  const url = fulfillmentStatusUrl(session, fulfillment);
  const status = fulfillmentStatusText(fulfillment);
  return url ? `${status} ${url}` : status;
}

function orderStatusHtml(session, fulfillment) {
  const url = fulfillmentStatusUrl(session, fulfillment);
  const status = fulfillmentStatusText(fulfillment);
  return url
    ? `${escapeHtml(status)} <a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`
    : escapeHtml(status);
}

async function receiptItemsForSession(env, session) {
  const lineItems = await fetchStripeCheckoutLineItems(env, session.id);
  return lineItems.map((lineItem) => {
    const price = lineItem.price || {};
    const productData = price.product && typeof price.product === "object" ? price.product : {};
    const metadata = productData.metadata || {};
    const quantity = Math.max(1, Number(lineItem.quantity) || 1);
    const productKey = normalizeProductKey(metadata.product_key);
    const unitAmount = Math.max(0, Number(price.unit_amount) || Math.round((Number(lineItem.amount_subtotal) || 0) / quantity));
    const amountSubtotal = Math.max(0, Number(lineItem.amount_subtotal) || unitAmount * quantity);
    const amountTotal = Math.max(0, Number(lineItem.amount_total) || amountSubtotal);
    const imageUrl = Array.isArray(productData.images) && productData.images[0]
      ? productData.images[0]
      : productImageUrl(env, productKey);
    return {
      name: productData.name || lineItem.description || "SmartSleeve merch",
      description: productData.description || "",
      product_key: productKey,
      size: normalizeSize(metadata.merch_size || metadata.shirt_size),
      quantity,
      unit_amount: unitAmount,
      amount_subtotal: amountSubtotal,
      amount_total: amountTotal,
      currency: lineItem.currency || price.currency || session.currency || "usd",
      image_url: imageUrl,
    };
  });
}

function receiptTotals(session, items) {
  const itemSubtotal = items.reduce((sum, item) => sum + item.amount_subtotal, 0);
  const totalDetails = session.total_details || {};
  const subtotal = Math.max(0, Number(session.amount_subtotal) || itemSubtotal);
  const tax = Math.max(0, Number(totalDetails.amount_tax) || 0);
  const shipping = Math.max(0, Number(totalDetails.amount_shipping) || 0);
  const discount = Math.max(0, Number(totalDetails.amount_discount) || 0);
  const total = Math.max(0, Number(session.amount_total) || (subtotal + tax + shipping - discount));
  return { subtotal, tax, shipping, discount, total, currency: session.currency || "usd" };
}

function receiptOrderNumber(session) {
  return printfulExternalId(session.id);
}

function itemSummaryHtml(items) {
  return items.map((item) => `
    <tr>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;">${escapeHtml(item.name)}</td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:center;">${escapeHtml(displaySize(item.size))}</td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:center;">${item.quantity}</td>
    </tr>
  `).join("");
}

function itemSummaryText(items) {
  return items.map((item) => `- ${item.name} | ${itemOptionLabel(item.size)} | Qty ${item.quantity}`).join("\n");
}

function lifecycleCopy(stage, env, session, fulfillment) {
  const trackingUrl = fulfillmentTrackingUrl(session, fulfillment);
  const statusUrl = fulfillmentStatusUrl(session, fulfillment);
  const delivery = estimatedDeliveryDetails(env, session, fulfillment);
  if (stage === "delivered") {
    return {
      subject: "Your SmartSleeve merch order was delivered",
      heading: "Your order was delivered",
      intro: "SmartSleeve has received a delivery update for your merch order.",
      detail: trackingUrl
        ? "Carrier tracking details are linked below."
        : "If the package is not where you expect it, check around the delivery address and contact SmartSleeve if it still cannot be found.",
      trackingLabel: trackingUrl ? "Delivery tracking" : "Tracking",
      trackingText: trackingUrl || "The carrier reported this order delivered.",
      trackingUrl,
      statusUrl,
    };
  }
  return {
    subject: "Your SmartSleeve merch order has shipped",
    heading: "Your order has shipped",
    intro: "Your SmartSleeve merch order is on its way.",
    detail: trackingUrl
      ? "Use the tracking link below for the latest carrier updates."
      : `Estimated delivery: ${delivery.label} (${delivery.basis}).`,
    trackingLabel: trackingUrl ? "Track shipment" : "Estimated delivery",
    trackingText: trackingUrl || `${delivery.label} (${delivery.basis})`,
    trackingUrl,
    statusUrl,
  };
}

function buildLifecycleEmailHtml(env, session, items, fulfillment, stage) {
  const customer = session.customer_details || {};
  const shipping = sessionShippingDetails(session);
  const customerName = shipping.name || customer.name || "SmartSleeve customer";
  const shippingLines = addressLines(shipping, customerName);
  const copy = lifecycleCopy(stage, env, session, fulfillment);
  const tracking = copy.trackingUrl
    ? `<a href="${escapeHtml(copy.trackingUrl)}">${escapeHtml(copy.trackingUrl)}</a>`
    : escapeHtml(copy.trackingText);
  const status = copy.statusUrl
    ? `<a href="${escapeHtml(copy.statusUrl)}">${escapeHtml(copy.statusUrl)}</a>`
    : escapeHtml(orderStatusText(session, fulfillment));
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
    <div style="max-width:720px;margin:0 auto;padding:28px 16px;">
      <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
        <div style="padding:24px;background:#020617;color:#f8fafc;">
          <div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#39ff14;font-weight:700;">SmartSleeve Shop</div>
          <h1 style="margin:8px 0 4px;font-size:26px;line-height:1.2;">${escapeHtml(copy.heading)}</h1>
          <div style="font-size:14px;color:#cbd5e1;">Order ${escapeHtml(receiptOrderNumber(session))}</div>
        </div>
        <div style="padding:22px;">
          <p style="margin:0 0 12px;color:#374151;">${escapeHtml(copy.intro)}</p>
          <p style="margin:0 0 18px;color:#374151;">${escapeHtml(copy.detail)}</p>
          <div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px;line-height:1.55;margin-bottom:18px;">
            <div><strong>${escapeHtml(copy.trackingLabel)}:</strong> ${tracking}</div>
            <div><strong>Order status:</strong> ${status}</div>
          </div>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
            <thead>
              <tr style="background:#f9fafb;">
                <th style="padding:10px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;">Item</th>
                <th style="padding:10px;text-align:center;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;">Size</th>
                <th style="padding:10px;text-align:center;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;">Qty</th>
              </tr>
            </thead>
            <tbody>${itemSummaryHtml(items)}</tbody>
          </table>
          <div style="margin-top:18px;border:1px solid #e5e7eb;border-radius:10px;padding:14px;">
            <div style="font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;font-weight:700;">Shipping address</div>
            <div style="margin-top:8px;line-height:1.5;">${addressHtml(shippingLines)}</div>
          </div>
        </div>
      </div>
    </div>
  </body>
</html>`;
}

function buildLifecycleEmailText(env, session, items, fulfillment, stage) {
  const customer = session.customer_details || {};
  const shipping = sessionShippingDetails(session);
  const customerName = shipping.name || customer.name || "SmartSleeve customer";
  const copy = lifecycleCopy(stage, env, session, fulfillment);
  return [
    copy.heading,
    `Order: ${receiptOrderNumber(session)}`,
    "",
    copy.intro,
    copy.detail,
    "",
    `${copy.trackingLabel}: ${copy.trackingText}`,
    `Order status: ${orderStatusText(session, fulfillment)}`,
    "",
    "Items:",
    itemSummaryText(items),
    "",
    "Shipping Address:",
    addressText(addressLines(shipping, customerName)),
  ].join("\n");
}

function buildReceiptHtml(env, session, items, paymentIntent, fulfillment) {
  const totals = receiptTotals(session, items);
  const customer = session.customer_details || {};
  const shipping = sessionShippingDetails(session);
  const customerName = shipping.name || customer.name || "SmartSleeve customer";
  const shippingLines = addressLines(shipping, customerName);
  const billingLines = addressLines(customer.address ? customer : shipping, customerName);
  const orderNumber = receiptOrderNumber(session);
  const orderDate = new Date((session.created || Math.floor(Date.now() / 1000)) * 1000);
  const itemRows = items.map((item) => `
    <tr>
      <td style="padding:12px 10px;border-bottom:1px solid #e5e7eb;width:76px;">
        ${item.image_url ? `<img src="${escapeHtml(item.image_url)}" alt="" width="64" height="64" style="display:block;width:64px;height:64px;object-fit:cover;border-radius:8px;background:#f8fafc;">` : ""}
      </td>
      <td style="padding:12px 10px;border-bottom:1px solid #e5e7eb;">
        <div style="font-weight:700;color:#111827;">${escapeHtml(item.name)}</div>
        <div style="font-size:13px;color:#6b7280;">${escapeHtml(itemOptionLabel(item.size))} &middot; Qty ${item.quantity}</div>
      </td>
      <td style="padding:12px 10px;border-bottom:1px solid #e5e7eb;text-align:right;white-space:nowrap;color:#111827;">${escapeHtml(formatMoney(item.unit_amount, item.currency))}</td>
      <td style="padding:12px 10px;border-bottom:1px solid #e5e7eb;text-align:right;white-space:nowrap;font-weight:700;color:#111827;">${escapeHtml(formatMoney(item.amount_total, item.currency))}</td>
    </tr>
  `).join("");
  const discountRow = totals.discount > 0 ? `
    <tr>
      <td style="padding:6px 0;color:#6b7280;">Discounts</td>
      <td style="padding:6px 0;text-align:right;color:#111827;">-${escapeHtml(formatMoney(totals.discount, totals.currency))}</td>
    </tr>
  ` : "";
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
    <div style="max-width:760px;margin:0 auto;padding:28px 16px;">
      <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
        <div style="padding:24px;background:#020617;color:#f8fafc;">
          <div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#39ff14;font-weight:700;">SmartSleeve Shop</div>
          <h1 style="margin:8px 0 4px;font-size:26px;line-height:1.2;">Your merch receipt</h1>
          <div style="font-size:14px;color:#cbd5e1;">Order ${escapeHtml(orderNumber)} &middot; ${escapeHtml(orderDate.toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" }))} PT</div>
        </div>
        <div style="padding:22px;">
          <p style="margin:0 0 18px;color:#374151;">Thanks, ${escapeHtml(customerName)}. Here are the details for your SmartSleeve merch purchase.</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
            <thead>
              <tr style="background:#f9fafb;">
                <th style="padding:10px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;">Image</th>
                <th style="padding:10px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;">Item</th>
                <th style="padding:10px;text-align:right;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;">Unit</th>
                <th style="padding:10px;text-align:right;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;">Line total</th>
              </tr>
            </thead>
            <tbody>${itemRows}</tbody>
          </table>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:18px;border-collapse:collapse;">
            <tr>
              <td style="padding:6px 0;color:#6b7280;">Subtotal</td>
              <td style="padding:6px 0;text-align:right;color:#111827;">${escapeHtml(formatMoney(totals.subtotal, totals.currency))}</td>
            </tr>
            ${discountRow}
            <tr>
              <td style="padding:6px 0;color:#6b7280;">Taxes</td>
              <td style="padding:6px 0;text-align:right;color:#111827;">${escapeHtml(formatMoney(totals.tax, totals.currency))}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#6b7280;">Shipping</td>
              <td style="padding:6px 0;text-align:right;color:#111827;">${totals.shipping > 0 ? escapeHtml(formatMoney(totals.shipping, totals.currency)) : "Free"}</td>
            </tr>
            <tr>
              <td style="padding:12px 0 0;border-top:1px solid #e5e7eb;font-weight:800;font-size:18px;">Total</td>
              <td style="padding:12px 0 0;border-top:1px solid #e5e7eb;text-align:right;font-weight:800;font-size:18px;">${escapeHtml(formatMoney(totals.total, totals.currency))}</td>
            </tr>
          </table>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:22px;">
            <div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px;">
              <div style="font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;font-weight:700;">Shipping address</div>
              <div style="margin-top:8px;line-height:1.5;">${addressHtml(shippingLines)}</div>
            </div>
            <div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px;">
              <div style="font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;font-weight:700;">Billing address</div>
              <div style="margin-top:8px;line-height:1.5;">${addressHtml(billingLines)}</div>
            </div>
          </div>
          <div style="margin-top:18px;border:1px solid #e5e7eb;border-radius:10px;padding:14px;line-height:1.55;">
            <div><strong>Payment:</strong> ${escapeHtml(paymentDescriptor(paymentIntent))}</div>
            <div><strong>Stripe payment:</strong> ${escapeHtml(typeof session.payment_intent === "object" ? session.payment_intent.id : session.payment_intent || "Recorded")}</div>
            <div><strong>Order status:</strong> ${orderStatusHtml(session, fulfillment)}</div>
            <div><strong>Tracking:</strong> ${trackingHtml(env, session, fulfillment)}</div>
          </div>
        </div>
      </div>
    </div>
  </body>
</html>`;
}

function buildReceiptText(env, session, items, paymentIntent, fulfillment) {
  const totals = receiptTotals(session, items);
  const customer = session.customer_details || {};
  const shipping = sessionShippingDetails(session);
  const customerName = shipping.name || customer.name || "SmartSleeve customer";
  const shippingLines = addressLines(shipping, customerName);
  const billingLines = addressLines(customer.address ? customer : shipping, customerName);
  const lines = [
    "SmartSleeve Merch Shop Receipt",
    `Order: ${receiptOrderNumber(session)}`,
    "",
    "Items:",
    ...items.map((item) => `- ${item.name} | ${itemOptionLabel(item.size)} | Qty ${item.quantity} | ${formatMoney(item.unit_amount, item.currency)} each | ${formatMoney(item.amount_total, item.currency)}`),
    "",
    `Subtotal: ${formatMoney(totals.subtotal, totals.currency)}`,
    totals.discount > 0 ? `Discounts: -${formatMoney(totals.discount, totals.currency)}` : "",
    `Taxes: ${formatMoney(totals.tax, totals.currency)}`,
    `Shipping: ${totals.shipping > 0 ? formatMoney(totals.shipping, totals.currency) : "Free"}`,
    `Total: ${formatMoney(totals.total, totals.currency)}`,
    "",
    "Shipping Address:",
    addressText(shippingLines),
    "",
    "Billing Address:",
    addressText(billingLines),
    "",
    `Payment: ${paymentDescriptor(paymentIntent)}`,
    `Order status: ${orderStatusText(session, fulfillment)}`,
    `Tracking: ${trackingText(env, session, fulfillment)}`,
  ];
  return lines.filter((line) => line !== "").join("\n");
}

async function sendResendEmail(env, message) {
  if (!env.RESEND_API_KEY) {
    return { status: "skipped", reason: "RESEND_API_KEY not configured" };
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(message),
  });
  const payload = await response.json().catch(() => ({}));
  return {
    status: response.ok ? "sent" : "failed",
    http_status: response.status,
    provider_response: payload,
  };
}

async function sendCustomerReceipt(env, session, options = {}) {
  const fullSession = session.id && (!session.total_details || typeof session.payment_intent === "string")
    ? await fetchStripeCheckoutSession(env, session.id, ["payment_intent.latest_charge", "payment_intent.payment_method"])
    : session;
  if (!fullSession || fullSession.error) {
    return { status: "failed", reason: "Stripe session lookup failed", stripe_error: fullSession && fullSession.error };
  }
  const customer = fullSession.customer_details || {};
  const to = normalizeEmail(options.to || customer.email || (fullSession.metadata && fullSession.metadata.customer_email));
  if (!isValidEmail(to)) {
    return { status: "skipped", reason: "No valid customer email available" };
  }
  const items = await receiptItemsForSession(env, fullSession);
  if (items.length === 0) {
    return { status: "skipped", reason: "No receipt line items available" };
  }
  const paymentIntent = typeof fullSession.payment_intent === "object"
    ? fullSession.payment_intent
    : await fetchStripePaymentIntent(env, fullSession.payment_intent);
  const subject = options.subject || "Your SmartSleeve Merch Shop Receipt";
  const message = {
    from: String(env.MERCH_RECEIPT_FROM_EMAIL || DEFAULT_RECEIPT_FROM_EMAIL),
    to,
    reply_to: String(env.MERCH_RECEIPT_REPLY_TO_EMAIL || DEFAULT_RECEIPT_REPLY_TO_EMAIL),
    subject,
    html: buildReceiptHtml(env, fullSession, items, paymentIntent, options.fulfillment),
    text: buildReceiptText(env, fullSession, items, paymentIntent, options.fulfillment),
  };
  const result = await sendResendEmail(env, message);
  return Object.assign(result, {
    to,
    subject,
    item_count: items.length,
    order_number: receiptOrderNumber(fullSession),
    payment_method: paymentDescriptor(paymentIntent),
  });
}

async function sendLifecycleEmail(env, session, stage, fulfillment, options = {}) {
  const fullSession = session.id && (!session.customer_details || !session.total_details)
    ? await fetchStripeCheckoutSession(env, session.id, ["payment_intent.latest_charge", "payment_intent.payment_method"])
    : session;
  if (!fullSession || fullSession.error) {
    return { status: "failed", reason: "Stripe session lookup failed", stripe_error: fullSession && fullSession.error };
  }
  const customer = fullSession.customer_details || {};
  const to = normalizeEmail(options.to || customer.email || (fullSession.metadata && fullSession.metadata.customer_email));
  if (!isValidEmail(to)) {
    return { status: "skipped", reason: "No valid customer email available" };
  }
  const items = await receiptItemsForSession(env, fullSession);
  if (items.length === 0) {
    return { status: "skipped", reason: "No order line items available" };
  }
  const copy = lifecycleCopy(stage, env, fullSession, fulfillment);
  const message = {
    from: String(env.MERCH_RECEIPT_FROM_EMAIL || DEFAULT_RECEIPT_FROM_EMAIL),
    to,
    reply_to: String(env.MERCH_RECEIPT_REPLY_TO_EMAIL || DEFAULT_RECEIPT_REPLY_TO_EMAIL),
    subject: options.subject || copy.subject,
    html: buildLifecycleEmailHtml(env, fullSession, items, fulfillment, stage),
    text: buildLifecycleEmailText(env, fullSession, items, fulfillment, stage),
  };
  const result = await sendResendEmail(env, message);
  return Object.assign(result, {
    to,
    subject: message.subject,
    stage,
    item_count: items.length,
    order_number: receiptOrderNumber(fullSession),
  });
}

function printfulExternalIndexKey(externalId) {
  return `printful:external:${String(externalId || "").trim()}`;
}

function printfulOrderIndexKey(orderId) {
  return `printful:order:${String(orderId || "").trim()}`;
}

function notificationKey(sessionId, stage) {
  return `stripe:session:${sessionId}:notification:${stage}`;
}

function printfulOrderIdentifiersFromFulfillment(session, fulfillment) {
  const result = fulfillmentResult(fulfillment);
  const externalIds = new Set([
    printfulExternalId(session && session.id),
    ...objectValuesByKey(result, /external_id/i),
  ].filter(Boolean));
  const orderIds = new Set(objectValuesByKey(result, /(^id$|order_id|printful_order_id)/i).filter(Boolean));
  return { externalIds: Array.from(externalIds), orderIds: Array.from(orderIds) };
}

async function storePrintfulIndexes(env, session, fulfillment) {
  if (!env.MERCH_ORDERS || !session || !session.id || !fulfillment || fulfillment.provider !== "printful") {
    return;
  }
  const identifiers = printfulOrderIdentifiersFromFulfillment(session, fulfillment);
  await Promise.all([
    ...identifiers.externalIds.map((externalId) => env.MERCH_ORDERS.put(printfulExternalIndexKey(externalId), session.id)),
    ...identifiers.orderIds.map((orderId) => env.MERCH_ORDERS.put(printfulOrderIndexKey(orderId), session.id)),
  ]);
}

function printfulWebhookStage(payload) {
  const text = [
    payload && payload.type,
    payload && payload.event,
    payload && payload.event_type,
    payload && payload.status,
    ...objectValuesByKey(payload, /status|type|event/i),
  ].join(" ").toLowerCase();
  if (/\bdelivered\b/.test(text)) {
    return "delivered";
  }
  if (/\b(shipped|shipment_sent|sent|in_transit|fulfilled)\b/.test(text)) {
    return "shipped";
  }
  return "";
}

async function sessionIdForPrintfulPayload(env, payload) {
  if (!env.MERCH_ORDERS) {
    return "";
  }
  const externalIds = objectValuesByKey(payload, /external_id/i).filter(Boolean);
  for (const externalId of externalIds) {
    if (/^cs_(test|live)_/i.test(externalId)) {
      return externalId;
    }
    const sessionId = await env.MERCH_ORDERS.get(printfulExternalIndexKey(externalId));
    if (sessionId) {
      return sessionId;
    }
  }
  const orderIds = objectValuesByKey(payload, /(^id$|order_id|printful_order_id)/i).filter(Boolean);
  for (const orderId of orderIds) {
    const sessionId = await env.MERCH_ORDERS.get(printfulOrderIndexKey(orderId));
    if (sessionId) {
      return sessionId;
    }
  }
  return "";
}

function printfulWebhookFulfillment(payload, stage) {
  return {
    status: stage === "delivered" ? "delivered" : "shipped",
    provider: "printful",
    provider_response: payload,
  };
}

function printfulPollingFulfillment(payload, stage) {
  return {
    status: stage === "delivered" ? "delivered" : "shipped",
    provider: "printful",
    provider_response: {
      result: Object.assign({ source: "scheduled_printful_poll" }, payload),
    },
  };
}

function positiveEnvInt(env, key, fallback) {
  const value = Number(env[key]);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

function storedOrderSessionIdFromKey(key) {
  const match = String(key || "").match(/^stripe:session:(cs_(?:test|live)_[A-Za-z0-9]+)$/);
  return match ? match[1] : "";
}

function storedOrderIsPollable(stored, lookbackDays) {
  if (!stored || typeof stored !== "object") {
    return false;
  }
  const fulfillment = stored.fulfillment || {};
  if (fulfillment.provider !== "printful") {
    return false;
  }
  if (!["submitted", "shipped"].includes(String(fulfillment.status || ""))) {
    return false;
  }
  const storedAt = parseReceiptDate(stored.stored_at);
  if (!storedAt || lookbackDays <= 0) {
    return true;
  }
  return Date.now() - storedAt.getTime() <= lookbackDays * 24 * 60 * 60 * 1000;
}

function storedNotificationExists(stored, stage) {
  return Boolean(stored && stored.notifications && stored.notifications[stage]);
}

function uniqueNonEmpty(values) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function printfulOrderCandidatesForStoredOrder(sessionId, stored) {
  const result = fulfillmentResult(stored && stored.fulfillment);
  const order = result && typeof result.order === "object" ? result.order : {};
  const orderIds = uniqueNonEmpty([
    result && result.id,
    result && result.order_id,
    result && result.printful_order_id,
    order.id,
  ]);
  const externalIds = uniqueNonEmpty([
    result && result.external_id,
    result && result.order_external_id,
    order.external_id,
    printfulExternalId(sessionId),
  ]);
  return [
    ...orderIds.map((value) => ({ type: "id", value })),
    ...externalIds.map((value) => ({ type: "external", value: `@${value.replace(/^@/, "")}` })),
  ];
}

async function fetchPrintfulV2Shipments(env, candidate) {
  const storeId = String(env.PRINTFUL_STORE_ID || "").trim();
  const url = new URL(`https://api.printful.com/v2/orders/${encodeURIComponent(candidate.value)}/shipments`);
  url.searchParams.set("limit", "100");
  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${env.PRINTFUL_API_KEY}`,
      ...(storeId ? { "X-PF-Store-Id": storeId } : {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, http_status: response.status, payload };
  }
  return {
    ok: true,
    source: "printful_v2_shipments",
    candidate,
    shipments: Array.isArray(payload.data) ? payload.data : [],
    provider_response: payload,
  };
}

async function fetchPrintfulV1OrderShipments(env, candidate) {
  const storeId = String(env.PRINTFUL_STORE_ID || "").trim();
  const legacyId = candidate.type === "external" ? candidate.value.replace(/^@/, "") : candidate.value;
  const response = await fetch(`https://api.printful.com/orders/${encodeURIComponent(legacyId)}`, {
    headers: {
      Authorization: `Bearer ${env.PRINTFUL_API_KEY}`,
      ...(storeId ? { "X-PF-Store-Id": storeId } : {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, http_status: response.status, payload };
  }
  const result = payload.result || {};
  return {
    ok: true,
    source: "printful_v1_order",
    candidate,
    shipments: Array.isArray(result.shipments) ? result.shipments : [],
    order: result,
    provider_response: payload,
  };
}

async function fetchPrintfulShipmentsForStoredOrder(env, sessionId, stored) {
  const candidates = printfulOrderCandidatesForStoredOrder(sessionId, stored);
  const failures = [];
  for (const candidate of candidates) {
    const v2 = await fetchPrintfulV2Shipments(env, candidate);
    if (v2.ok) {
      return v2;
    }
    failures.push({ source: "printful_v2_shipments", candidate, http_status: v2.http_status });
  }
  for (const candidate of candidates) {
    const v1 = await fetchPrintfulV1OrderShipments(env, candidate);
    if (v1.ok) {
      return v1;
    }
    failures.push({ source: "printful_v1_order", candidate, http_status: v1.http_status });
  }
  return { ok: false, failures };
}

function textFromUnknown(value) {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(textFromUnknown).join(" ");
  }
  if (typeof value === "object") {
    return Object.values(value).map(textFromUnknown).join(" ");
  }
  return "";
}

function stageFromPrintfulShipments(shipments, order = {}) {
  const shipmentList = Array.isArray(shipments) ? shipments : [];
  const combined = textFromUnknown([
    order && order.status,
    ...shipmentList.map((shipment) => [
      shipment.status,
      shipment.shipment_status,
      shipment.delivery_status,
      shipment.delivered_at,
      shipment.tracking_events,
    ]),
  ]).toLowerCase();
  if (/\bdelivered\b/.test(combined) || shipmentList.some((shipment) => shipment && shipment.delivered_at)) {
    return "delivered";
  }
  if (shipmentList.some((shipment) => shipment && (shipment.shipped_at || shipment.tracking_url || shipment.tracking_number))) {
    return "shipped";
  }
  if (/\b(shipped|shipment_sent|sent|in_transit|fulfilled)\b/.test(combined)) {
    return "shipped";
  }
  return "";
}

async function sendOrderStageNotification(env, sessionId, stage, fulfillment) {
  if (!sessionId || !stage) {
    return { status: "skipped", reason: "missing session id or stage" };
  }
  const alreadySent = env.MERCH_ORDERS
    ? await env.MERCH_ORDERS.get(notificationKey(sessionId, stage))
    : null;
  if (alreadySent) {
    return { status: "duplicate", stage, session_id: sessionId };
  }
  const session = await fetchStripeCheckoutSession(env, sessionId, ["payment_intent.latest_charge", "payment_intent.payment_method"]);
  if (!session || session.error) {
    return {
      status: "failed",
      reason: "Stripe Checkout session lookup failed",
      stripe_error: session && session.error,
      stage,
      session_id: sessionId,
    };
  }
  const notification = await sendLifecycleEmail(env, session, stage, fulfillment);
  if (notification.status === "failed") {
    console.error("SmartSleeve lifecycle email failed", JSON.stringify({
      stripe_session_id: sessionId,
      stage,
      http_status: notification.http_status,
      reason: notification.reason,
    }));
    return { status: "failed", stage, session_id: sessionId, notification };
  }
  await recordOrderNotification(env, sessionId, stage, notification);
  return { status: notification.status, stage, session_id: sessionId, notification };
}

async function markInferredNotification(env, sessionId, stage, reason) {
  if (!env.MERCH_ORDERS || !sessionId || !stage) {
    return;
  }
  const alreadySent = await env.MERCH_ORDERS.get(notificationKey(sessionId, stage));
  if (!alreadySent) {
    await recordOrderNotification(env, sessionId, stage, {
      status: "inferred",
      reason,
      email_sent: false,
    });
  }
}

async function processPolledPrintfulOrder(env, sessionId, stored) {
  const shippedAlready = storedNotificationExists(stored, "shipped")
    || (env.MERCH_ORDERS ? await env.MERCH_ORDERS.get(notificationKey(sessionId, "shipped")) : null);
  const deliveredAlready = storedNotificationExists(stored, "delivered")
    || (env.MERCH_ORDERS ? await env.MERCH_ORDERS.get(notificationKey(sessionId, "delivered")) : null);
  if (deliveredAlready) {
    return { status: "skipped", reason: "delivered notification already recorded", session_id: sessionId };
  }
  const shipmentResult = await fetchPrintfulShipmentsForStoredOrder(env, sessionId, stored);
  if (!shipmentResult.ok) {
    return { status: "failed", reason: "Printful shipment lookup failed", session_id: sessionId, failures: shipmentResult.failures };
  }
  const stage = stageFromPrintfulShipments(shipmentResult.shipments, shipmentResult.order || {});
  if (!stage) {
    return { status: "skipped", reason: "no shipped or delivered status yet", session_id: sessionId };
  }
  const fulfillment = printfulPollingFulfillment({
    shipments: shipmentResult.shipments,
    order: shipmentResult.order,
    lookup_source: shipmentResult.source,
    lookup_candidate_type: shipmentResult.candidate && shipmentResult.candidate.type,
  }, stage);
  if (stage === "shipped" && shippedAlready) {
    return { status: "skipped", reason: "shipped notification already recorded", session_id: sessionId };
  }
  if (stage === "delivered") {
    const delivered = await sendOrderStageNotification(env, sessionId, "delivered", fulfillment);
    if (!shippedAlready && delivered.status !== "failed") {
      await markInferredNotification(env, sessionId, "shipped", "delivery status was observed before a shipped email was sent");
    }
    return delivered;
  }
  return sendOrderStageNotification(env, sessionId, "shipped", fulfillment);
}

async function pollPrintfulShipmentStatuses(env, context = {}) {
  if (!env.MERCH_ORDERS) {
    return { status: "skipped", reason: "MERCH_ORDERS KV binding not configured" };
  }
  if (!env.PRINTFUL_API_KEY) {
    return { status: "skipped", reason: "PRINTFUL_API_KEY not configured" };
  }
  if (String(env.MERCH_PRINTFUL_POLL_ENABLED || "true").toLowerCase() === "false") {
    return { status: "skipped", reason: "MERCH_PRINTFUL_POLL_ENABLED=false" };
  }
  const limit = Math.min(1000, positiveEnvInt(env, "MERCH_PRINTFUL_POLL_LIMIT", PRINTFUL_POLL_DEFAULT_LIMIT));
  const lookbackDays = positiveEnvInt(env, "MERCH_PRINTFUL_POLL_LOOKBACK_DAYS", PRINTFUL_POLL_DEFAULT_LOOKBACK_DAYS);
  let cursor;
  let scanned = 0;
  let considered = 0;
  let notifications = 0;
  const failures = [];
  do {
    const listed = await env.MERCH_ORDERS.list({
      prefix: "stripe:session:",
      limit: Math.min(1000, limit - scanned),
      cursor,
    });
    cursor = listed.cursor;
    for (const key of listed.keys || []) {
      scanned += 1;
      const sessionId = storedOrderSessionIdFromKey(key.name);
      if (!sessionId) {
        continue;
      }
      const raw = await env.MERCH_ORDERS.get(key.name);
      if (!raw) {
        continue;
      }
      let stored;
      try {
        stored = JSON.parse(raw);
      } catch (_err) {
        failures.push({ session_id: sessionId, reason: "stored order JSON parse failed" });
        continue;
      }
      if (!storedOrderIsPollable(stored, lookbackDays)) {
        continue;
      }
      considered += 1;
      const result = await processPolledPrintfulOrder(env, sessionId, stored);
      if (result.status === "sent") {
        notifications += 1;
      }
      if (result.status === "failed") {
        failures.push(result);
      }
    }
  } while (cursor && scanned < limit);
  return {
    status: failures.length ? "completed_with_failures" : "completed",
    cron: context.cron,
    scheduled_time: context.scheduledTime,
    scanned,
    considered,
    notifications,
    failures: failures.slice(0, 10),
  };
}

function isPrintfulWebhookAuthorized(request, env, url) {
  const secret = String(env.PRINTFUL_WEBHOOK_SECRET || "").trim();
  if (!secret) {
    return false;
  }
  const header = request.headers.get("x-smartsleeve-webhook-secret")
    || request.headers.get("x-printful-webhook-secret")
    || request.headers.get("authorization")
    || "";
  const token = url.searchParams.get("token") || url.searchParams.get("secret") || "";
  return header === secret || header === `Bearer ${secret}` || token === secret;
}

async function storeOrder(env, session, fulfillment, receipt) {
  if (!env.MERCH_ORDERS || !session.id) {
    return;
  }
  await storePrintfulIndexes(env, session, fulfillment);
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
      size: customFieldValue(session, "merch_size") || customFieldValue(session, "shirt_size"),
      fulfillment,
      receipt,
    }),
  );
}

async function recordOrderNotification(env, sessionId, stage, notification) {
  if (!env.MERCH_ORDERS || !sessionId || !stage) {
    return;
  }
  const storedAt = new Date().toISOString();
  await env.MERCH_ORDERS.put(
    notificationKey(sessionId, stage),
    JSON.stringify({ stored_at: storedAt, stage, notification }),
  );
  const existingRaw = await env.MERCH_ORDERS.get(orderKey(sessionId));
  if (!existingRaw) {
    return;
  }
  try {
    const existing = JSON.parse(existingRaw);
    const notifications = existing.notifications && typeof existing.notifications === "object"
      ? existing.notifications
      : {};
    notifications[stage] = { stored_at: storedAt, notification };
    await env.MERCH_ORDERS.put(orderKey(sessionId), JSON.stringify(Object.assign(existing, { notifications })));
  } catch (_err) {
    // Keep the idempotency record even if the historical order payload is malformed.
  }
}

async function handlePrintfulWebhook(request, env) {
  const url = new URL(request.url);
  if (!isPrintfulWebhookAuthorized(request, env, url)) {
    return jsonResponse(request, env, { error: "Unauthorized Printful webhook" }, 401);
  }
  const payload = await readJson(request);
  const stage = printfulWebhookStage(payload);
  if (!stage) {
    return jsonResponse(request, env, { received: true, ignored: true });
  }
  const sessionId = await sessionIdForPrintfulPayload(env, payload);
  if (!sessionId) {
    return jsonResponse(request, env, {
      received: true,
      queued: false,
      reason: "No SmartSleeve order mapping found for Printful webhook",
      stage,
    }, 202);
  }
  const fulfillment = printfulWebhookFulfillment(payload, stage);
  const result = await sendOrderStageNotification(env, sessionId, stage, fulfillment);
  if (result.status === "duplicate") {
    return jsonResponse(request, env, { received: true, duplicate: true, stage, session_id: sessionId });
  }
  if (result.reason === "Stripe Checkout session lookup failed") {
    return jsonResponse(request, env, {
      error: "Stripe Checkout session lookup failed",
      stripe_error: result.stripe_error,
      stage,
      session_id: sessionId,
    }, 502);
  }
  if (result.status === "failed") {
    return jsonResponse(request, env, { received: true, stage, session_id: sessionId, notification: result.notification }, 502);
  }
  return jsonResponse(request, env, { received: true, stage, session_id: sessionId, notification: result.notification });
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
  const receipt = paymentStatus === "paid"
    ? await sendCustomerReceipt(env, session, { fulfillment })
    : { status: "skipped", reason: `payment_status=${paymentStatus || "unknown"}` };
  if (receipt.status === "failed") {
    console.error("SmartSleeve receipt email failed", JSON.stringify({
      stripe_session_id: session.id,
      http_status: receipt.http_status,
      reason: receipt.reason,
    }));
  }
  await storeOrder(env, session, fulfillment, receipt);
  const fulfillmentFailed = paymentStatus === "paid"
    && String(env.MERCH_FULFILLMENT_PROVIDER || "none").toLowerCase() === "printful"
    && fulfillment.status !== "submitted";
  if (fulfillmentFailed) {
    console.error("SmartSleeve Printful fulfillment failed", JSON.stringify({
      stripe_session_id: session.id,
      fulfillment_status: fulfillment.status,
      reason: fulfillment.reason,
      http_status: fulfillment.http_status,
      item_count: fulfillment.item_count,
    }));
    return jsonResponse(request, env, { received: true, fulfillment }, 502);
  }
  return jsonResponse(request, env, { received: true, fulfillment, receipt });
}

async function retryPrintfulOrder(request, env) {
  if (!isAdminAuthorized(request, env)) {
    return jsonResponse(request, env, { error: "Unauthorized" }, 401);
  }
  const body = await readJson(request);
  const sessionId = String(body.session_id || "").trim();
  if (!/^cs_(test|live)_[A-Za-z0-9]+/.test(sessionId)) {
    return jsonResponse(request, env, { error: "A valid Stripe Checkout session_id is required" }, 400);
  }
  const session = await fetchStripeCheckoutSession(env, sessionId);
  if (!session || session.error) {
    return jsonResponse(request, env, {
      error: "Stripe Checkout session lookup failed",
      stripe_error: session && session.error,
    }, 502);
  }
  const paymentStatus = String(session.payment_status || "").toLowerCase();
  if (paymentStatus !== "paid") {
    return jsonResponse(request, env, {
      error: "Stripe session is not paid",
      payment_status: paymentStatus || "unknown",
    }, 409);
  }
  const fulfillment = await maybeFulfill(env, session);
  await storeOrder(env, session, fulfillment, { status: "skipped", reason: "retry_printful_only" });
  const status = fulfillment.status === "submitted" ? 200 : 502;
  return jsonResponse(request, env, { retried: true, session_id: sessionId, fulfillment }, status);
}

async function sendReceiptForOrder(request, env) {
  if (!isAdminAuthorized(request, env)) {
    return jsonResponse(request, env, { error: "Unauthorized" }, 401);
  }
  const body = await readJson(request);
  const sessionId = String(body.session_id || "").trim();
  if (!/^cs_(test|live)_[A-Za-z0-9]+/.test(sessionId)) {
    return jsonResponse(request, env, { error: "A valid Stripe Checkout session_id is required" }, 400);
  }
  const session = await fetchStripeCheckoutSession(env, sessionId, ["payment_intent.latest_charge", "payment_intent.payment_method"]);
  if (!session || session.error) {
    return jsonResponse(request, env, {
      error: "Stripe Checkout session lookup failed",
      stripe_error: session && session.error,
    }, 502);
  }
  const paymentStatus = String(session.payment_status || "").toLowerCase();
  if (paymentStatus !== "paid") {
    return jsonResponse(request, env, {
      error: "Stripe session is not paid",
      payment_status: paymentStatus || "unknown",
    }, 409);
  }
  const receipt = await sendCustomerReceipt(env, session, {
    to: body.to,
    subject: body.subject || "Your SmartSleeve Merch Shop Receipt",
  });
  const status = receipt.status === "failed" ? 502 : 200;
  return jsonResponse(request, env, { sent: receipt.status === "sent", session_id: sessionId, receipt }, status);
}

async function pollPrintfulForOrders(request, env) {
  if (!isAdminAuthorized(request, env)) {
    return jsonResponse(request, env, { error: "Unauthorized" }, 401);
  }
  const result = await pollPrintfulShipmentStatuses(env, { manual: true });
  const status = result.status === "completed_with_failures" ? 207 : 200;
  return jsonResponse(request, env, result, status);
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
        printful_api_configured: Boolean(env.PRINTFUL_API_KEY),
        printful_store_configured: Boolean(env.PRINTFUL_STORE_ID),
        admin_retry_configured: Boolean(env.MERCH_ADMIN_TOKEN),
        resend_configured: Boolean(env.RESEND_API_KEY),
        printful_webhook_configured: Boolean(env.PRINTFUL_WEBHOOK_SECRET),
        printful_poll_configured: Boolean(env.MERCH_ORDERS && env.PRINTFUL_API_KEY),
        printful_poll_enabled: String(env.MERCH_PRINTFUL_POLL_ENABLED || "true").toLowerCase() !== "false",
        printful_poll_limit: positiveEnvInt(env, "MERCH_PRINTFUL_POLL_LIMIT", PRINTFUL_POLL_DEFAULT_LIMIT),
        receipt_from_email: String(env.MERCH_RECEIPT_FROM_EMAIL || DEFAULT_RECEIPT_FROM_EMAIL),
        fulfillment_provider: env.MERCH_FULFILLMENT_PROVIDER || "none",
        printful_confirm_orders: String(env.PRINTFUL_CONFIRM_ORDERS || "").toLowerCase() === "true",
        products: publicCatalog(env).products.map((product) => product.key),
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
    if (request.method === "POST" && url.pathname === "/printful-webhook") {
      return handlePrintfulWebhook(request, env);
    }
    if (request.method === "POST" && url.pathname === "/admin/retry-printful") {
      return retryPrintfulOrder(request, env);
    }
    if (request.method === "POST" && url.pathname === "/admin/send-receipt") {
      return sendReceiptForOrder(request, env);
    }
    if (request.method === "POST" && url.pathname === "/admin/poll-printful") {
      return pollPrintfulForOrders(request, env);
    }
    return jsonResponse(request, env, { error: "Not found" }, 404);
  },
  async scheduled(controller, env) {
    const result = await pollPrintfulShipmentStatuses(env, {
      cron: controller && controller.cron,
      scheduledTime: controller && controller.scheduledTime,
    });
    console.log("SmartSleeve Printful shipment poll", JSON.stringify(result));
  },
};
