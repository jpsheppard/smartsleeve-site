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
//   RESEND_API_KEY, for SmartSleeve Orders customer receipts
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
//   MERCH_RECEIPT_FROM_EMAIL="SmartSleeve Orders <orders@smartsleeve.ai>"
//   MERCH_RECEIPT_REPLY_TO_EMAIL="SmartSleeve Orders <orders@smartsleeve.ai>"
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
//   POST /admin/poll-printful-order
//   POST /admin/preflight-printful

const DEFAULT_SITE = "https://smartsleeve.ai";
const DEFAULT_SUCCESS_PATH = "/app/#shop-success";
const DEFAULT_CANCEL_PATH = "/app/#shop";
const DEFAULT_RECEIPT_FROM_EMAIL = "SmartSleeve Orders <orders@smartsleeve.ai>";
const DEFAULT_RECEIPT_REPLY_TO_EMAIL = "SmartSleeve Orders <orders@smartsleeve.ai>";
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
const PRINTFUL_POLL_DEFAULT_SCAN_LIMIT = 200;
const PRINTFUL_PENDING_TTL_BUFFER_DAYS = 2;

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
  const key = normalizeProductKey(productKey);
  const label = `${key} ${String(product && product.name || "")}`
    .toLowerCase()
    .replace(/[-_]+/g, " ");
  return Boolean(key && product && product.name && !/\bgym\s+towel\b/.test(label));
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
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "create_account" || normalized === "signed_in" ? normalized : "guest";
}

function safeMetadataValue(value, maxLength = 450) {
  return String(value || "").trim().slice(0, maxLength);
}

function safeAddressValue(value, maxLength = 96) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[<>]/g, "")
    .slice(0, maxLength);
}

function normalizeCheckoutShippingAddress(value) {
  const source = value && typeof value === "object" ? value : {};
  const address = {
    name: safeAddressValue(source.name, 120),
    line1: safeAddressValue(source.line1 || source.address1),
    line2: safeAddressValue(source.line2 || source.address2),
    city: safeAddressValue(source.city, 80),
    state: safeAddressValue(source.state || source.state_code, 40),
    postal_code: safeAddressValue(source.postal_code || source.zip, 20),
    country: safeAddressValue(source.country || source.country_code || "US", 2).toUpperCase() || "US",
    phone: safeAddressValue(source.phone, 32),
  };
  return address.line1 && address.city && address.state && address.postal_code && address.country ? address : null;
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

async function createStripeCustomerForCheckout(env, customerEmail, customerName, shippingAddress, metadata = {}) {
  if (!shippingAddress) {
    return "";
  }
  const params = {
    email: customerEmail,
    name: customerName || shippingAddress.name || customerEmail,
    "shipping[name]": shippingAddress.name || customerName || customerEmail,
    "shipping[address][line1]": shippingAddress.line1,
    "shipping[address][city]": shippingAddress.city,
    "shipping[address][state]": shippingAddress.state,
    "shipping[address][postal_code]": shippingAddress.postal_code,
    "shipping[address][country]": shippingAddress.country,
  };
  if (shippingAddress.line2) {
    params["shipping[address][line2]"] = shippingAddress.line2;
  }
  if (shippingAddress.phone) {
    params.phone = shippingAddress.phone;
    params["shipping[phone]"] = shippingAddress.phone;
  }
  Object.entries(metadata).forEach(([key, value]) => {
    if (value) {
      params[`metadata[${key}]`] = safeMetadataValue(value, 120);
    }
  });
  const response = await fetch("https://api.stripe.com/v1/customers", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: encodeForm(params),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.id) {
    console.warn("SmartSleeve Stripe customer prefill failed", JSON.stringify({
      status: response.status,
      error: payload.error && payload.error.message || payload.error || "unknown",
    }));
    return "";
  }
  return payload.id;
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
  const smartsleeveAccountEmail = normalizeEmail(body.smartsleeve_account_email || "");
  const customerName = safeMetadataValue(body.customer_name || body.name, 120);
  const shippingAddress = normalizeCheckoutShippingAddress(body.shipping_address);
  const stripeCustomerId = await createStripeCustomerForCheckout(env, customerEmail, customerName, shippingAddress, {
    smartsleeve_account_email: smartsleeveAccountEmail,
    account_username: accountUsername,
    checkout_mode: checkoutMode,
  });
  const shippingCents = centsFromUsd(env.MERCH_SHIPPING_USD, 0);
  const base = siteUrl(env);
  const successPath = String(env.MERCH_SUCCESS_PATH || DEFAULT_SUCCESS_PATH);
  const cancelPath = String(env.MERCH_CANCEL_PATH || DEFAULT_CANCEL_PATH);
  const params = {
    mode: "payment",
    success_url: `${base}${successPath}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}${cancelPath}`,
    "shipping_address_collection[allowed_countries][0]": "US",
    "metadata[cart_mode]": items.length > 1 ? "cart" : "single",
    "metadata[item_count]": String(items.length),
    "metadata[customer_email]": customerEmail,
    "metadata[checkout_mode]": checkoutMode,
  };
  if (stripeCustomerId) {
    params.customer = stripeCustomerId;
  } else {
    params.customer_email = customerEmail;
  }
  if (accountUsername) {
    params["metadata[account_username]"] = accountUsername;
  }
  if (smartsleeveAccountEmail) {
    params["metadata[smartsleeve_account_email]"] = smartsleeveAccountEmail;
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

function isAdminAuthorized(request, env, options = {}) {
  const actual = bearerToken(request);
  const expectedTokens = [
    env.MERCH_ADMIN_TOKEN,
    options.allowRecoveryToken ? env.MERCH_RECOVERY_TOKEN : "",
  ].map((value) => String(value || "").trim()).filter(Boolean);
  return Boolean(actual && expectedTokens.some((expected) => timingSafeStringEqual(actual, expected)));
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

async function fetchStripeCheckoutSessionForPaymentIntent(env, paymentIntentId) {
  const id = typeof paymentIntentId === "object" && paymentIntentId ? paymentIntentId.id : paymentIntentId;
  if (!env.STRIPE_SECRET_KEY || !id) {
    return null;
  }
  const url = new URL("https://api.stripe.com/v1/checkout/sessions");
  url.searchParams.set("payment_intent", id);
  url.searchParams.set("limit", "1");
  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { error: payload.error || payload, http_status: response.status };
  }
  const session = Array.isArray(payload.data) && payload.data[0] ? payload.data[0] : null;
  return session && session.id
    ? fetchStripeCheckoutSession(env, session.id, ["payment_intent.latest_charge", "payment_intent.payment_method"])
    : null;
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

function printfulRecipientForSession(session) {
  const shipping = session.shipping_details
    || (session.collected_information && session.collected_information.shipping_details)
    || {};
  const address = shipping.address || {};
  const customer = session.customer_details || {};
  const collectedInformation = session.collected_information || {};
  return {
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
  };
}

function printfulStoreId(env) {
  return String(env.PRINTFUL_STORE_ID || "").trim();
}

function printfulRequestHeaders(env) {
  const storeId = printfulStoreId(env);
  return {
    Authorization: `Bearer ${env.PRINTFUL_API_KEY}`,
    "Content-Type": "application/json",
    ...(storeId ? { "X-PF-Store-Id": storeId } : {}),
  };
}

async function printfulJsonRequest(env, path, options = {}) {
  const response = await fetch(`https://api.printful.com${path}`, {
    method: options.method || "GET",
    headers: printfulRequestHeaders(env),
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

function printfulV2ThreadColorOption(options, placement) {
  const suffix = String(placement || "").replace(/^embroidery_/, "");
  const candidates = [`thread_colors_${suffix}`, "thread_colors"];
  for (const id of candidates) {
    const option = (options || []).find((item) => item && item.id === id);
    if (option && Array.isArray(option.value) && option.value.length > 0) {
      return option.value;
    }
  }
  return null;
}

function printfulV2CatalogProductOptionNames(catalogProduct) {
  const optionList = [
    ...(Array.isArray(catalogProduct && catalogProduct.product_options) ? catalogProduct.product_options : []),
    ...(Array.isArray(catalogProduct && catalogProduct.options) ? catalogProduct.options : []),
  ];
  return new Set(optionList
    .map((option) => option && (option.name || option.id || option.key))
    .map((value) => String(value || "").trim())
    .filter(Boolean));
}

function printfulV2ProductOptions(options, catalogProduct) {
  const validOptionNames = printfulV2CatalogProductOptionNames(catalogProduct);
  const fallbackAllowed = new Set(["lifelike", "notes", "stitch_color"]);
  return (options || [])
    .filter((option) => option && option.id && option.value !== undefined && option.value !== null)
    .filter((option) => !/^thread_colors(?:_|$)/.test(String(option.id)))
    .filter((option) => !/^text_thread_colors(?:_|$)/.test(String(option.id)))
    .filter((option) => String(option.id) !== "embroidery_type")
    .filter((option) => validOptionNames.size > 0
      ? validOptionNames.has(String(option.id))
      : fallbackAllowed.has(String(option.id)))
    .map((option) => ({ name: String(option.id), value: option.value }));
}

function printfulV2CatalogProductId(syncVariant) {
  const product = syncVariant && syncVariant.product ? syncVariant.product : {};
  const candidates = [
    product.product_id,
    product.catalog_product_id,
    syncVariant && syncVariant.catalog_product_id,
  ];
  for (const candidate of candidates) {
    const id = Number(candidate);
    if (Number.isFinite(id) && id > 0) {
      return Math.round(id);
    }
  }
  return 0;
}

async function printfulV2CatalogProduct(env, syncVariant, catalogProductCache) {
  const catalogProductId = printfulV2CatalogProductId(syncVariant);
  if (!catalogProductId) {
    return null;
  }
  if (catalogProductCache && catalogProductCache.has(catalogProductId)) {
    return catalogProductCache.get(catalogProductId);
  }
  const { response, payload } = await printfulJsonRequest(env, `/v2/catalog-products/${encodeURIComponent(catalogProductId)}`);
  const catalogProduct = response.ok ? (payload.data || null) : null;
  if (catalogProductCache) {
    catalogProductCache.set(catalogProductId, catalogProduct);
  }
  return catalogProduct;
}

function printfulV2TechniqueForPlacement(fileType, catalogProduct) {
  const placement = printfulV2PlacementName(fileType, catalogProduct);
  const placements = Array.isArray(catalogProduct && catalogProduct.placements)
    ? catalogProduct.placements
    : [];
  const exact = placements.find((item) => item && item.placement === placement);
  if (exact && exact.technique) {
    return String(exact.technique);
  }
  if (placement === "default") {
    const defaultPlacement = placements.find((item) => item && item.placement === "default")
      || (placements.length === 1 ? placements[0] : null);
    if (defaultPlacement && defaultPlacement.technique) {
      return String(defaultPlacement.technique);
    }
  }
  return placement.includes("embroidery") ? "embroidery" : "dtg";
}

function printfulV2PlacementName(fileType, catalogProduct) {
  const placement = String(fileType || "");
  const placements = Array.isArray(catalogProduct && catalogProduct.placements)
    ? catalogProduct.placements
    : [];
  if (placements.some((item) => item && item.placement === placement)) {
    return placement;
  }
  if (placement === "default") {
    const front = placements.find((item) => item && item.placement === "front");
    if (front) {
      return "front";
    }
    const printable = placements.find((item) => item && item.placement && item.placement !== "label_inside");
    if (printable) {
      return printable.placement;
    }
  }
  return placement;
}

function printfulV2LayerPosition(file) {
  const source = file && typeof file.position === "object" ? file.position : null;
  if (!source) {
    return null;
  }
  const position = {};
  ["area_width", "area_height", "width", "height", "top", "left"].forEach((key) => {
    const value = Number(source[key]);
    if (Number.isFinite(value)) {
      position[key] = value;
    }
  });
  return Object.keys(position).length ? position : null;
}

async function printfulV2OrderItem(env, checkoutItem, options = {}) {
  const product = checkoutItem.product;
  const size = checkoutItem.size;
  const syncVariantId = printfulSyncVariantId(env, product, size);
  if (!syncVariantId) {
    return { error: `${product.sync_variant_env_prefixes[0]}_${size} not configured` };
  }
  const { response, payload } = await printfulJsonRequest(env, `/store/variants/${encodeURIComponent(syncVariantId)}`);
  const syncVariant = payload.result || {};
  if (!response.ok || !syncVariant.variant_id) {
    return {
      error: "Printful sync variant lookup failed",
      sync_variant_id: syncVariantId,
      http_status: response.status,
      provider_response: payload,
    };
  }
  const catalogProduct = await printfulV2CatalogProduct(env, syncVariant, options.catalogProductCache);
  const placements = (syncVariant.files || [])
    .filter((file) => file && file.type && file.type !== "preview" && (file.url || file.id))
    .map((file) => {
      const layer = { type: "file" };
      if (file.url) {
        layer.url = file.url;
      } else {
        layer.id = file.id;
      }
      const placementName = printfulV2PlacementName(file.type, catalogProduct);
      const threadColors = printfulV2ThreadColorOption(syncVariant.options || [], file.type);
      if (threadColors) {
        layer.layer_options = [{ name: "thread_colors", value: threadColors }];
      }
      const position = printfulV2LayerPosition(file);
      if (position) {
        layer.position = position;
      }
      return {
        placement: placementName,
        technique: printfulV2TechniqueForPlacement(placementName, catalogProduct),
        layers: [layer],
      };
    });
  if (placements.length === 0) {
    return {
      error: "Printful sync variant has no reusable print placements",
      sync_variant_id: syncVariantId,
    };
  }
  const productOptions = printfulV2ProductOptions(syncVariant.options || [], catalogProduct);
  const item = {
    source: "catalog",
    catalog_variant_id: syncVariant.variant_id,
    quantity: checkoutItem.quantity,
    name: productNameWithOption(product.name, size),
    retail_price: (checkoutItem.unit_amount / 100).toFixed(2),
    placements,
  };
  if (productOptions.length > 0) {
    item.product_options = productOptions;
  }
  return {
    item,
    summary: {
      product_key: checkoutItem.product_key,
      size,
      quantity: checkoutItem.quantity,
      fulfillment_mode: "v2_catalog_variant_files",
      sync_variant_id: syncVariantId,
      catalog_variant_id: syncVariant.variant_id,
      catalog_product_id: printfulV2CatalogProductId(syncVariant) || undefined,
      placement_count: placements.length,
      product_option_count: productOptions.length,
    },
  };
}

async function waitForPrintfulV2Costs(env, orderId) {
  let latest = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { response, payload } = await printfulJsonRequest(env, `/v2/orders/${encodeURIComponent(orderId)}`);
    latest = payload;
    const order = payload.data || {};
    const status = order.costs && order.costs.calculation_status;
    if (!response.ok) {
      return { ok: false, http_status: response.status, provider_response: payload };
    }
    if (status === "done") {
      return { ok: true, order };
    }
    if (status === "failed") {
      return { ok: false, reason: "Printful v2 cost calculation failed", provider_response: payload };
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return { ok: false, reason: "Printful v2 cost calculation timed out", provider_response: latest };
}

async function submitPrintfulV2Order(env, session, checkoutItems, externalId) {
  const itemResults = [];
  const catalogProductCache = new Map();
  for (const checkoutItem of checkoutItems) {
    const result = await printfulV2OrderItem(env, checkoutItem, { catalogProductCache });
    if (result.error) {
      return {
        status: "failed",
        provider: "printful",
        api_version: "v2",
        reason: result.error,
        http_status: result.http_status,
        provider_response: result.provider_response,
      };
    }
    itemResults.push(result);
  }
  const retailCosts = printfulRetailCostsForSession(session, checkoutItems);
  const order = {
    external_id: externalId,
    shipping: "STANDARD",
    recipient: printfulRecipientForSession(session),
    order_items: itemResults.map((result) => result.item),
    retail_costs: {
      currency: retailCosts.currency,
      discount: retailCosts.discount,
      shipping: retailCosts.shipping,
      tax: retailCosts.tax,
    },
  };
  const confirm = String(env.PRINTFUL_CONFIRM_ORDERS || "").toLowerCase() === "true";
  const storeId = printfulStoreId(env);
  if (!storeId) {
    return {
      status: "skipped",
      reason: "PRINTFUL_STORE_ID not configured",
      item_count: itemResults.length,
    };
  }
  const created = await printfulJsonRequest(env, "/v2/orders", {
    method: "POST",
    body: order,
  });
  const createdOrder = created.payload.data || {};
  if (!created.response.ok || !createdOrder.id) {
    return {
      status: "failed",
      provider: "printful",
      api_version: "v2",
      confirm,
      item_count: itemResults.length,
      items: itemResults.map((result) => result.summary),
      store_id: storeId,
      http_status: created.response.status,
      provider_response: created.payload,
    };
  }
  let finalOrder = createdOrder;
  let confirmationPayload = null;
  let confirmationStatus = 200;
  if (confirm) {
    const costs = await waitForPrintfulV2Costs(env, createdOrder.id);
    if (!costs.ok) {
      return {
        status: "failed",
        provider: "printful",
        api_version: "v2",
        confirm,
        item_count: itemResults.length,
        items: itemResults.map((result) => result.summary),
        store_id: storeId,
        http_status: costs.http_status || 409,
        reason: costs.reason,
        provider_response: { result: finalOrder, create: created.payload, cost_lookup: costs.provider_response },
      };
    }
    finalOrder = costs.order;
    const confirmed = await printfulJsonRequest(env, `/v2/orders/${encodeURIComponent(createdOrder.id)}/confirmation`, {
      method: "POST",
      body: {},
    });
    confirmationPayload = confirmed.payload;
    confirmationStatus = confirmed.response.status;
    if (!confirmed.response.ok) {
      return {
        status: "failed",
        provider: "printful",
        api_version: "v2",
        confirm,
        item_count: itemResults.length,
        items: itemResults.map((result) => result.summary),
        store_id: storeId,
        http_status: confirmationStatus,
        provider_response: { result: finalOrder, create: created.payload, confirmation: confirmationPayload },
      };
    }
    finalOrder = confirmationPayload.data || finalOrder;
  }
  return {
    status: "submitted",
    provider: "printful",
    api_version: "v2",
    confirm,
    item_count: itemResults.length,
    items: itemResults.map((result) => result.summary),
    store_id: storeId,
    http_status: confirmationStatus,
    provider_response: { result: finalOrder, create: created.payload, confirmation: confirmationPayload },
  };
}

function printfulPreflightRecipient() {
  return {
    name: "SmartSleeve Preflight",
    email: "orders@smartsleeve.ai",
    address1: "19749 Dearborn St",
    city: "Chatsworth",
    state_code: "CA",
    country_code: "US",
    zip: "91311",
  };
}

function preflightCheckoutItems(env, body = {}) {
  const allProducts = publicCatalog(env).products;
  const requestedKeys = Array.isArray(body.product_keys)
    ? new Set(body.product_keys.map(normalizeProductKey).filter(Boolean))
    : null;
  const requestedSize = body.size ? normalizeSize(body.size) : "";
  const allSizes = body.all_sizes === true;
  const candidates = [];
  allProducts.forEach((catalogEntry) => {
    const productKey = normalizeProductKey(catalogEntry.key);
    if (requestedKeys && !requestedKeys.has(productKey)) {
      return;
    }
    const product = catalogProduct(env, productKey);
    if (!product) {
      return;
    }
    const sizes = Array.isArray(catalogEntry.sizes) && catalogEntry.sizes.length
      ? catalogEntry.sizes.map(normalizeSize)
      : ["M"];
    const selectedSizes = requestedSize
      ? (sizes.includes(requestedSize) ? [requestedSize] : [])
      : (allSizes ? sizes : [sizes[0]]);
    selectedSizes.forEach((size) => {
      candidates.push({
        product_key: productKey,
        product,
        size,
        quantity: 1,
        unit_amount: productUnitAmountForSize(env, product, size),
      });
    });
  });
  const offset = Math.max(0, Math.round(Number(body.offset) || 0));
  const limit = Math.min(50, Math.max(1, Math.round(Number(body.limit) || 20)));
  return {
    total_candidates: candidates.length,
    offset,
    limit,
    items: candidates.slice(offset, offset + limit),
  };
}

async function deletePrintfulV2Order(env, orderId) {
  if (!orderId) {
    return { ok: false, reason: "missing order id" };
  }
  const { response, payload } = await printfulJsonRequest(env, `/v2/orders/${encodeURIComponent(orderId)}`, {
    method: "DELETE",
  });
  return {
    ok: response.ok || response.status === 404,
    http_status: response.status,
    provider_response: payload,
  };
}

async function preflightPrintfulV2Items(env, checkoutItems, createDraft) {
  const itemResults = [];
  const catalogProductCache = new Map();
  for (const checkoutItem of checkoutItems) {
    const result = await printfulV2OrderItem(env, checkoutItem, { catalogProductCache });
    if (result.error) {
      return {
        status: "failed",
        reason: result.error,
        http_status: result.http_status,
        provider_response: result.provider_response,
        item_count: itemResults.length,
        items: itemResults.map((item) => item.summary),
      };
    }
    itemResults.push(result);
  }
  if (!createDraft) {
    return {
      status: "passed",
      item_count: itemResults.length,
      items: itemResults.map((item) => item.summary),
      draft_created: false,
    };
  }
  const externalId = printfulExternalId(`preflight-${crypto.randomUUID()}`);
  const created = await printfulJsonRequest(env, "/v2/orders", {
    method: "POST",
    body: {
      external_id: externalId,
      shipping: "STANDARD",
      recipient: printfulPreflightRecipient(),
      order_items: itemResults.map((result) => result.item),
      retail_costs: {
        currency: "USD",
        discount: "0.00",
        shipping: "0.00",
        tax: "0.00",
      },
    },
  });
  const createdOrder = created.payload.data || {};
  const deletion = createdOrder.id ? await deletePrintfulV2Order(env, createdOrder.id) : null;
  return {
    status: created.response.ok && (!deletion || deletion.ok) ? "passed" : "failed",
    item_count: itemResults.length,
    items: itemResults.map((item) => item.summary),
    draft_created: Boolean(createdOrder.id),
    draft_deleted: deletion ? deletion.ok : false,
    http_status: created.response.status,
    delete_http_status: deletion && deletion.http_status,
    provider_response: created.response.ok ? undefined : created.payload,
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
  return submitPrintfulV2Order(env, session, checkoutItems, printfulExternalId(session.id));
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

function fulfillmentProviderPayloads(fulfillment) {
  const response = fulfillment && fulfillment.provider_response ? fulfillment.provider_response : {};
  const payloads = [response, response.result, response.data, response.create, response.confirmation].filter(Boolean);
  if (Array.isArray(response.segments)) {
    response.segments.forEach((segment) => {
      if (segment) {
        payloads.push(segment, segment.result, segment.data);
      }
    });
  }
  if (Array.isArray(fulfillment && fulfillment.segments)) {
    fulfillment.segments.forEach((segment) => {
      const providerResponse = segment && segment.provider_response ? segment.provider_response : {};
      payloads.push(providerResponse, providerResponse.result, providerResponse.data, providerResponse.create, providerResponse.confirmation);
    });
  }
  return payloads.filter(Boolean);
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

function lifecycleCopy(stage, env, session, fulfillment, options = {}) {
  const trackingUrl = fulfillmentTrackingUrl(session, fulfillment);
  const statusUrl = fulfillmentStatusUrl(session, fulfillment);
  const delivery = estimatedDeliveryDetails(env, session, fulfillment);
  if (stage === "delivered") {
    const partial = Boolean(options.partialShipment);
    return {
      subject: partial
        ? "Part of your SmartSleeve merch order was delivered"
        : "Your SmartSleeve merch order was delivered",
      heading: partial ? "Part of your order was delivered" : "Your order was delivered",
      intro: partial
        ? "A package from your SmartSleeve merch order was delivered. Other items may arrive separately, and you'll get a separate email for each package."
        : "SmartSleeve has received a delivery update for your merch order.",
      detail: trackingUrl
        ? "Carrier tracking details are linked below."
        : "If the package is not where you expect it, check around the delivery address and contact SmartSleeve if it still cannot be found.",
      itemsLabel: partial ? "Items in this delivery" : "Items in your order",
      trackingLabel: trackingUrl ? "Delivery tracking" : "Tracking",
      trackingText: trackingUrl || "The carrier reported this order delivered.",
      trackingUrl,
      statusUrl,
    };
  }
  const partial = Boolean(options.partialShipment);
  return {
    subject: partial
      ? "Part of your SmartSleeve merch order has shipped"
      : "Your SmartSleeve merch order has shipped",
    heading: partial ? "Part of your order has shipped" : "Your order has shipped",
    intro: partial
      ? "Some of your SmartSleeve merch order is on its way. Orders can ship in multiple packages, and you'll get a separate email as each one ships."
      : "Your SmartSleeve merch order is on its way.",
    detail: trackingUrl
      ? "Use the tracking link below for the latest carrier updates."
      : `Estimated delivery: ${delivery.label} (${delivery.basis}).`,
    itemsLabel: partial ? "Items in this shipment" : "Items in your order",
    trackingLabel: trackingUrl ? "Track shipment" : "Estimated delivery",
    trackingText: trackingUrl || `${delivery.label} (${delivery.basis})`,
    trackingUrl,
    statusUrl,
  };
}

function buildLifecycleEmailHtml(env, session, items, fulfillment, stage, options = {}) {
  const customer = session.customer_details || {};
  const shipping = sessionShippingDetails(session);
  const customerName = shipping.name || customer.name || "SmartSleeve customer";
  const shippingLines = addressLines(shipping, customerName);
  const copy = lifecycleCopy(stage, env, session, fulfillment, options);
  const duplicateStatusLink = copy.trackingUrl && copy.statusUrl && copy.trackingUrl === copy.statusUrl;
  const tracking = copy.trackingUrl
    ? `<a href="${escapeHtml(copy.trackingUrl)}">${escapeHtml(copy.trackingUrl)}</a>`
    : escapeHtml(copy.trackingText);
  const status = copy.statusUrl
    ? `<a href="${escapeHtml(copy.statusUrl)}">${escapeHtml(copy.statusUrl)}</a>`
    : escapeHtml(orderStatusText(session, fulfillment));
  const statusRow = duplicateStatusLink ? "" : `<div><strong>Order status:</strong> ${status}</div>`;
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
    <div style="max-width:720px;margin:0 auto;padding:28px 16px;">
      <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
        <div style="padding:24px;background:#020617;color:#f8fafc;">
          <div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#39ff14;font-weight:700;">SmartSleeve Orders</div>
          <h1 style="margin:8px 0 4px;font-size:26px;line-height:1.2;">${escapeHtml(copy.heading)}</h1>
          <div style="font-size:14px;color:#cbd5e1;">Order ${escapeHtml(receiptOrderNumber(session))}</div>
        </div>
        <div style="padding:22px;">
          <p style="margin:0 0 12px;color:#374151;">${escapeHtml(copy.intro)}</p>
          <p style="margin:0 0 18px;color:#374151;">${escapeHtml(copy.detail)}</p>
          <div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px;line-height:1.55;margin-bottom:18px;">
            <div><strong>${escapeHtml(copy.trackingLabel)}:</strong> ${tracking}</div>
            ${statusRow}
          </div>
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;font-weight:700;margin:0 0 8px;">${escapeHtml(copy.itemsLabel || "Items")}</div>
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

function buildLifecycleEmailText(env, session, items, fulfillment, stage, options = {}) {
  const customer = session.customer_details || {};
  const shipping = sessionShippingDetails(session);
  const customerName = shipping.name || customer.name || "SmartSleeve customer";
  const copy = lifecycleCopy(stage, env, session, fulfillment, options);
  const duplicateStatusLink = copy.trackingUrl && copy.statusUrl && copy.trackingUrl === copy.statusUrl;
  return [
    copy.heading,
    `Order: ${receiptOrderNumber(session)}`,
    "",
    copy.intro,
    copy.detail,
    "",
    `${copy.trackingLabel}: ${copy.trackingText}`,
    duplicateStatusLink ? "" : `Order status: ${orderStatusText(session, fulfillment)}`,
    "",
    `${copy.itemsLabel || "Items"}:`,
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
          <div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#39ff14;font-weight:700;">SmartSleeve Orders</div>
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
  const allItems = await receiptItemsForSession(env, fullSession);
  if (allItems.length === 0) {
    return { status: "skipped", reason: "No order line items available" };
  }
  // Scope both shipped and delivered emails to this parcel. For a multi-item
  // order, fail closed when Printful has not supplied resolvable parcel items;
  // the webhook will retry and the scheduled API poll can enrich the payload.
  let items = allItems;
  let partialShipment = false;
  if (stage === "shipped" || stage === "delivered") {
    const previouslyNotifiedTracking = options.previouslyNotifiedTracking || notifiedShipmentSignatures(options.stored, stage);
    const scoped = scopeItemsToNewShipments(options.stored, fulfillment, allItems, previouslyNotifiedTracking);
    if (!scoped.determined) {
      return {
        status: "failed",
        reason: "Printful parcel items could not be matched to this multi-item order",
        retryable: true,
      };
    }
    items = scoped.items;
    partialShipment = Boolean(scoped.partial);
  }
  const emailOptions = { partialShipment };
  const copy = lifecycleCopy(stage, env, fullSession, fulfillment, emailOptions);
  const message = {
    from: String(env.MERCH_RECEIPT_FROM_EMAIL || DEFAULT_RECEIPT_FROM_EMAIL),
    to,
    reply_to: String(env.MERCH_RECEIPT_REPLY_TO_EMAIL || DEFAULT_RECEIPT_REPLY_TO_EMAIL),
    subject: options.subject || copy.subject,
    html: buildLifecycleEmailHtml(env, fullSession, items, fulfillment, stage, emailOptions),
    text: buildLifecycleEmailText(env, fullSession, items, fulfillment, stage, emailOptions),
  };
  const result = await sendResendEmail(env, message);
  return Object.assign(result, {
    to,
    subject: message.subject,
    stage,
    item_count: items.length,
    partial_shipment: partialShipment,
    order_number: receiptOrderNumber(fullSession),
  });
}

function printfulExternalIndexKey(externalId) {
  return `printful:external:${String(externalId || "").trim()}`;
}

function printfulOrderIndexKey(orderId) {
  return `printful:order:${String(orderId || "").trim()}`;
}

function compactIsoTimestamp(date) {
  const value = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  return value.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}

function printfulPendingDateForSession(session) {
  const created = Number(session && session.created);
  return Number.isFinite(created) && created > 0 ? new Date(created * 1000) : new Date();
}

function printfulLegacyPendingKey(sessionId) {
  return `printful:pending:${String(sessionId || "").trim()}`;
}

function printfulPendingKey(sessionId, date = new Date()) {
  return `printful:pending:${compactIsoTimestamp(date)}:${String(sessionId || "").trim()}`;
}

function storedPendingSessionIdFromKey(key) {
  const match = String(key || "").match(/^printful:pending:(?:\d{14}:)?(cs_(?:test|live)_[A-Za-z0-9]+)$/);
  return match ? match[1] : "";
}

function notificationKey(sessionId, stage) {
  return `stripe:session:${sessionId}:notification:${stage}`;
}

function printfulCoreOrderRecords(fulfillment) {
  const response = fulfillment && fulfillment.provider_response ? fulfillment.provider_response : {};
  const records = [];
  const add = (value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      records.push(value);
      if (Array.isArray(value.orders)) {
        value.orders.forEach(add);
      }
    }
  };
  add(response.result);
  add(response.data);
  add(response.create && (response.create.data || response.create.result));
  add(response.confirmation && (response.confirmation.data || response.confirmation.result));
  if (Array.isArray(response.segments)) {
    response.segments.forEach((segment) => {
      add(segment && (segment.data || segment.result || segment));
    });
  }
  if (Array.isArray(fulfillment && fulfillment.segments)) {
    fulfillment.segments.forEach((segment) => {
      const providerResponse = segment && segment.provider_response ? segment.provider_response : {};
      add(providerResponse.result);
      add(providerResponse.data);
      add(providerResponse.create && (providerResponse.create.data || providerResponse.create.result));
      add(providerResponse.confirmation && (providerResponse.confirmation.data || providerResponse.confirmation.result));
    });
  }
  return records;
}

function printfulOrderIdentifiersFromFulfillment(session, fulfillment) {
  const records = printfulCoreOrderRecords(fulfillment);
  const externalIds = new Set([
    printfulExternalId(session && session.id),
    ...records.map((record) => record.external_id),
  ].filter(Boolean));
  const orderIds = new Set(records
    .map((record) => record.id || record.order_id || record.printful_order_id)
    .filter(Boolean));
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

function fulfillmentNeedsPrintfulPolling(env, fulfillment, notifications = {}) {
  const status = String(fulfillment && fulfillment.status || "");
  return Boolean(
    fulfillment
    && fulfillment.provider === "printful"
    && (
      (status === "submitted" && !notifications.shipped)
      || (status === "shipped" && printfulDeliveryPollingEnabled(env) && !notifications.delivered)
    ),
  );
}

async function storePrintfulPendingPoll(env, session, fulfillment) {
  if (!env.MERCH_ORDERS || !session || !session.id || !fulfillmentNeedsPrintfulPolling(env, fulfillment)) {
    return "";
  }
  const storedAt = printfulPendingDateForSession(session);
  const key = printfulPendingKey(session.id, storedAt);
  const stageGoal = String(fulfillment.status || "") === "shipped" ? "delivered" : "shipped";
  await env.MERCH_ORDERS.put(
    key,
    "",
    {
      expirationTtl: printfulPendingPollTtlSeconds(env),
      metadata: {
        stripe_session_id: session.id,
        stored_at: storedAt.toISOString(),
        poll_until: pendingPollUntil(env, storedAt),
        stage_goal: stageGoal,
      },
    },
  );
  return key;
}

async function clearPrintfulPendingPoll(env, sessionId, options = {}) {
  if (!env.MERCH_ORDERS || !sessionId) {
    return;
  }
  const keys = new Set([
    printfulLegacyPendingKey(sessionId),
    options.pendingKey,
    options.stored && options.stored.printful_pending_key,
  ].filter(Boolean));
  await Promise.all(Array.from(keys).map((key) => env.MERCH_ORDERS.delete(key)));
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
    let sessionId = await env.MERCH_ORDERS.get(printfulExternalIndexKey(externalId));
    if (!sessionId) {
      // Split shipments append a suffix (e.g. "<ext>-rest", "<ext>-2"); the index
      // was written against the base external id, so retry without the suffix.
      const baseExternalId = String(externalId).replace(/-(rest|\d+)$/i, "");
      if (baseExternalId && baseExternalId !== externalId) {
        sessionId = await env.MERCH_ORDERS.get(printfulExternalIndexKey(baseExternalId));
      }
    }
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

function envFlag(env, key, fallback = false) {
  const value = String(env[key] === undefined ? "" : env[key]).trim().toLowerCase();
  if (!value) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value);
}

function printfulDeliveryPollingEnabled(env) {
  return envFlag(env, "MERCH_PRINTFUL_DELIVERY_POLL_ENABLED", false);
}

// Keep polling an order after its first shipment so Printful split shipments
// (apparel now, a towel/mug/poster later) each trigger their own customer email.
// The pending key is still pruned when the order is delivered or its poll window
// (MERCH_PRINTFUL_POLL_LOOKBACK_DAYS) expires. Disable to revert to one email/order.
function printfulSplitShipmentPollingEnabled(env) {
  return envFlag(env, "MERCH_PRINTFUL_SPLIT_SHIPMENT_POLL_ENABLED", true);
}

function printfulPendingPollTtlSeconds(env) {
  const lookbackDays = positiveEnvInt(env, "MERCH_PRINTFUL_POLL_LOOKBACK_DAYS", PRINTFUL_POLL_DEFAULT_LOOKBACK_DAYS);
  return Math.max(60, (lookbackDays + PRINTFUL_PENDING_TTL_BUFFER_DAYS) * 24 * 60 * 60);
}

function pendingPollUntil(env, storedAt) {
  const lookbackDays = positiveEnvInt(env, "MERCH_PRINTFUL_POLL_LOOKBACK_DAYS", PRINTFUL_POLL_DEFAULT_LOOKBACK_DAYS);
  return new Date(storedAt.getTime() + lookbackDays * 24 * 60 * 60 * 1000).toISOString();
}

function pendingMetadataIsExpired(metadata) {
  const pollUntil = parseReceiptDate(metadata && metadata.poll_until);
  return Boolean(pollUntil && Date.now() > pollUntil.getTime());
}

function pendingMetadataStageGoal(metadata) {
  const goal = String(metadata && metadata.stage_goal || "").trim().toLowerCase();
  return goal === "delivered" ? "delivered" : "shipped";
}

function storedOrderSessionIdFromKey(key) {
  const match = String(key || "").match(/^stripe:session:(cs_(?:test|live)_[A-Za-z0-9]+)$/);
  return match ? match[1] : "";
}

function storedOrderIsPollable(env, stored, lookbackDays) {
  if (!stored || typeof stored !== "object") {
    return false;
  }
  const fulfillment = stored.fulfillment || {};
  if (fulfillment.provider !== "printful") {
    return false;
  }
  const notifications = stored.notifications && typeof stored.notifications === "object"
    ? stored.notifications
    : {};
  // Keep polling shipped-but-undelivered orders when delivery or split-shipment
  // polling is enabled, so additional Printful parcels are still detected.
  const keepPollingShipped = printfulDeliveryPollingEnabled(env) || printfulSplitShipmentPollingEnabled(env);
  if (notifications.shipped && !keepPollingShipped) {
    return false;
  }
  if (!["submitted", "shipped"].includes(String(fulfillment.status || ""))) {
    return false;
  }
  if (fulfillment.status === "shipped" && !keepPollingShipped) {
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

function shipmentRecordsFromFulfillment(fulfillment) {
  const result = fulfillmentResult(fulfillment);
  const records = [];
  if (result && result.shipment && typeof result.shipment === "object") {
    records.push(result.shipment);
  }
  if (result && Array.isArray(result.shipments)) {
    records.push(...result.shipments.filter((shipment) => shipment && typeof shipment === "object"));
  }
  return records;
}

function shipmentSignatures(shipment) {
  if (!shipment || typeof shipment !== "object") {
    return [];
  }
  const tracking = shipmentTrackingNumber(shipment);
  if (tracking) {
    return [tracking];
  }
  const id = shipment.shipment_id ?? shipment.shipment_number ?? shipment.id;
  return id === undefined || id === null || String(id).trim() === "" ? [] : [`shipment:${String(id).trim()}`];
}

// Printful ships parts of an order separately and emits one event per parcel.
// Prefer a parcel's tracking number, then its shipment id, so order ids and
// pre-created sibling shipments can never collapse into the same notification.
function shipmentSignaturesFromFulfillment(fulfillment) {
  if (!fulfillment || typeof fulfillment !== "object") {
    return [];
  }
  const records = shipmentRecordsFromFulfillment(fulfillment);
  if (records.length) {
    return uniqueNonEmpty(records.flatMap(shipmentSignatures));
  }
  const payload = fulfillment.provider_response || fulfillment;
  const tracking = objectValuesByKey(payload, /tracking_number|tracking_code/i);
  const shipmentIds = objectValuesByKey(payload, /shipment_id|shipment_number/i);
  let signatures = uniqueNonEmpty([...tracking, ...shipmentIds]);
  if (!signatures.length) {
    signatures = uniqueNonEmpty(
      objectValuesByKey(payload, /external_id/i).filter((value) => /-(rest|\d+)$/i.test(String(value || ""))),
    );
  }
  return signatures;
}

function notifiedShipmentSignatures(stored, stage = "shipped") {
  const map = stored && stored.notifications && stored.notifications[`${stage}_shipments`];
  return new Set(map && typeof map === "object" ? Object.keys(map) : []);
}

// Whether a fulfillment references a parcel we have not emailed about at this stage.
// When no shipment signature can be extracted, falls back to the original
// once-per-stage dedup so an unidentifiable shipment can't cause repeat emails.
function shipmentNotificationIsNew(stored, stage, fulfillment) {
  const signatures = shipmentSignaturesFromFulfillment(fulfillment);
  if (!signatures.length) {
    return !storedNotificationExists(stored, stage);
  }
  const seen = notifiedShipmentSignatures(stored, stage);
  return signatures.some((signature) => !seen.has(signature));
}

function normalizeItemMatchName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Map Printful order-item id/external-id -> item name from the stored split
// sub-orders and the current webhook/poll payload.
function orderItemNameIndex(stored, fulfillment) {
  const index = new Map();
  const addOrder = (order) => {
    if (!order || typeof order !== "object") {
      return;
    }
    const items = [].concat(Array.isArray(order.items) ? order.items : [], Array.isArray(order.order_items) ? order.order_items : []);
    for (const item of items) {
      if (!item || !item.name) {
        continue;
      }
      [item.id, item.order_item_id, item.external_id, item.order_item_external_id]
        .filter((value) => value !== undefined && value !== null && String(value).trim())
        .forEach((value) => index.set(String(value), String(item.name)));
    }
  };
  const addResult = (result) => {
    if (!result || typeof result !== "object") {
      return;
    }
    addOrder(result.order);
    (Array.isArray(result.orders) ? result.orders : []).forEach(addOrder);
  };
  addResult(fulfillmentResult(stored && stored.fulfillment));
  addResult(fulfillmentResult(fulfillment));
  return index;
}

function shipmentTrackingNumber(shipment) {
  return String((shipment && (shipment.tracking_number || shipment.tracking_code)) || "").trim();
}

function shipmentItemOrderIdsAndNames(shipment) {
  const entries = [].concat(
    Array.isArray(shipment && shipment.items) ? shipment.items : [],
    Array.isArray(shipment && shipment.order_items) ? shipment.order_items : [],
    Array.isArray(shipment && shipment.shipment_items) ? shipment.shipment_items : [],
  );
  const ids = [];
  const names = [];
  for (const item of entries) {
    if (item == null) {
      continue;
    }
    [item.order_item_id, item.order_item_external_id, item.item_id, item.id, item.order_item && item.order_item.id]
      .filter((value) => value !== undefined && value !== null && String(value).trim())
      .forEach((value) => ids.push(String(value)));
    [item.order_item_name, item.name]
      .filter((value) => value !== undefined && value !== null && String(value).trim())
      .forEach((value) => names.push(String(value)));
    if (item.product && item.product.name) {
      names.push(String(item.product.name));
    }
  }
  return { ids, names };
}

// Normalized names of items in shipments not yet emailed, or null when the
// shipment payload carries no resolvable item references (caller keeps full list).
function newShipmentItemNames(stored, fulfillment, previouslyNotifiedTracking) {
  const shipments = shipmentRecordsFromFulfillment(fulfillment);
  if (!shipments.length) {
    return null;
  }
  const nameIndex = orderItemNameIndex(stored, fulfillment);
  const wanted = new Set();
  let sawReference = false;
  for (const shipment of shipments) {
    const tracking = shipmentTrackingNumber(shipment);
    if (tracking && previouslyNotifiedTracking && previouslyNotifiedTracking.has(tracking)) {
      continue;
    }
    const { ids, names } = shipmentItemOrderIdsAndNames(shipment);
    for (const id of ids) {
      const name = nameIndex.get(id);
      if (name) {
        wanted.add(normalizeItemMatchName(name));
        sawReference = true;
      }
    }
    for (const name of names) {
      wanted.add(normalizeItemMatchName(name));
      sawReference = true;
    }
  }
  return sawReference ? wanted : null;
}

function receiptItemMatchesShipment(item, wantedNames) {
  const base = normalizeItemMatchName(item.name);
  const withSize = normalizeItemMatchName(`${item.name} ${item.size || ""}`);
  for (const wanted of wantedNames) {
    if (!wanted) {
      continue;
    }
    if (wanted === base || wanted === withSize) {
      return true;
    }
    if (base && (wanted.startsWith(base) || base.startsWith(wanted))) {
      return true;
    }
  }
  return false;
}

// Scope the order's line items to the current parcel. The `determined` flag is
// deliberately separate from `partial`: a parcel may legitimately contain every
// item. Multi-item emails are not sent when Printful gives no resolvable item refs.
function scopeItemsToNewShipments(stored, fulfillment, receiptItems, previouslyNotifiedTracking) {
  if (!Array.isArray(receiptItems) || !receiptItems.length) {
    return { determined: false, items: [] };
  }
  if (receiptItems.length === 1) {
    return { determined: true, items: receiptItems, partial: false };
  }
  const wanted = newShipmentItemNames(stored, fulfillment, previouslyNotifiedTracking);
  if (!wanted || !wanted.size) {
    return { determined: false, items: [] };
  }
  const matched = receiptItems.filter((item) => receiptItemMatchesShipment(item, wanted));
  if (!matched.length) {
    return { determined: false, items: [] };
  }
  return { determined: true, items: matched, partial: matched.length < receiptItems.length };
}

function uniqueNonEmpty(values) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function printfulOrderCandidatesForStoredOrder(sessionId, stored) {
  const result = fulfillmentResult(stored && stored.fulfillment);
  const order = result && typeof result.order === "object" ? result.order : {};
  const records = printfulCoreOrderRecords(stored && stored.fulfillment);
  const orderIds = uniqueNonEmpty([
    result && result.id,
    result && result.order_id,
    result && result.printful_order_id,
    order.id,
    ...records.map((record) => record.id || record.order_id || record.printful_order_id),
  ]);
  const externalIds = uniqueNonEmpty([
    result && result.external_id,
    result && result.order_external_id,
    order.external_id,
    ...records.map((record) => record.external_id),
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
  let firstSuccessfulLookup = null;
  for (const candidate of candidates) {
    const v2 = await fetchPrintfulV2Shipments(env, candidate);
    if (v2.ok) {
      firstSuccessfulLookup = firstSuccessfulLookup || v2;
      if (stageFromPrintfulShipments(v2.shipments, v2.order || {})) {
        return v2;
      }
      continue;
    }
    failures.push({ source: "printful_v2_shipments", candidate, http_status: v2.http_status });
  }
  for (const candidate of candidates) {
    const v1 = await fetchPrintfulV1OrderShipments(env, candidate);
    if (v1.ok) {
      firstSuccessfulLookup = firstSuccessfulLookup || v1;
      if (stageFromPrintfulShipments(v1.shipments, v1.order || {})) {
        return v1;
      }
      continue;
    }
    failures.push({ source: "printful_v1_order", candidate, http_status: v1.http_status });
  }
  if (firstSuccessfulLookup) {
    return firstSuccessfulLookup;
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

export function stageFromPrintfulShipment(shipment) {
  if (!shipment || typeof shipment !== "object") {
    return "";
  }
  const trackingEvents = Array.isArray(shipment.tracking_events) ? shipment.tracking_events : [];
  const combined = textFromUnknown([
    shipment.status,
    shipment.shipment_status,
    shipment.delivery_status,
    shipment.delivered_at,
    ...trackingEvents.map((event) => event && [event.status, event.type, event.event_type]),
  ]).toLowerCase();
  if (/\bdelivered\b/.test(combined) || shipment.delivered_at) {
    return "delivered";
  }
  // Printful creates a shipment record and My Orders URL while an order is still
  // waiting for fulfillment. Those fields identify the future parcel; they do not
  // mean the parcel has left the fulfillment center. Require an explicit provider
  // status, event, or shipped timestamp before notifying the customer.
  if (shipment.shipped_at) {
    return "shipped";
  }
  if (/\b(shipped|shipment_sent|sent|in_transit|fulfilled)\b/.test(combined)) {
    return "shipped";
  }
  return "";
}

export function stageFromPrintfulShipments(shipments, order = {}) {
  const shipmentList = Array.isArray(shipments) ? shipments : [];
  const stages = shipmentList.map(stageFromPrintfulShipment);
  if (stages.includes("delivered")) {
    return "delivered";
  }
  if (stages.includes("shipped")) {
    return "shipped";
  }
  return /\b(shipped|shipment_sent|sent|in_transit|fulfilled)\b/.test(String(order && order.status || "").toLowerCase())
    ? "shipped"
    : "";
}

// A reserved-but-not-yet-committed claim older than this is treated as abandoned
// (Worker died between reserving and committing) and may be re-claimed.
const NOTIFICATION_CLAIM_STALE_MS = 120000;

function stableHash(value) {
  const str = String(value === undefined || value === null ? "" : value);
  let hash = 5381;
  for (let i = 0; i < str.length; i += 1) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

// Per-(session, stage, parcel) claim key. Shipment lifecycle notifications use the
// same parcel signatures as dedup, so split-order shipped and delivered events are
// each claimed independently.
function notificationClaimKey(sessionId, stage, fulfillment) {
  const base = notificationKey(sessionId, stage);
  if (stage !== "shipped" && stage !== "delivered") {
    return base;
  }
  const signatures = shipmentSignaturesFromFulfillment(fulfillment);
  if (!signatures.length) {
    return base;
  }
  return `${base}:${stableHash(signatures.slice().sort().join("|"))}`;
}

// Atomically reserve a notification slot before sending. Prefers the Durable Object
// lock (strongly consistent — race-proof even for simultaneous triggers); falls back
// to KV claim-before-send if NOTIFICATION_LOCK is not bound.
async function acquireNotificationClaim(env, key) {
  if (env.NOTIFICATION_LOCK) {
    const stub = env.NOTIFICATION_LOCK.get(env.NOTIFICATION_LOCK.idFromName(key));
    const response = await stub.fetch("https://notification-lock/claim", {
      method: "POST",
      body: JSON.stringify({ action: "claim", staleMs: NOTIFICATION_CLAIM_STALE_MS }),
    });
    const data = await response.json().catch(() => ({}));
    return { ok: Boolean(data.claimed), backend: "durable_object" };
  }
  if (env.MERCH_ORDERS) {
    const raw = await env.MERCH_ORDERS.get(`claim:${key}`);
    if (raw) {
      let existing = null;
      try {
        existing = JSON.parse(raw);
      } catch (_err) {
        existing = null;
      }
      const isStale = existing
        && existing.status === "claiming"
        && Date.now() - Date.parse(existing.stored_at || "") > NOTIFICATION_CLAIM_STALE_MS;
      if (!isStale) {
        return { ok: false, backend: "kv" };
      }
    }
    await env.MERCH_ORDERS.put(`claim:${key}`, JSON.stringify({ status: "claiming", stored_at: new Date().toISOString() }));
    return { ok: true, backend: "kv" };
  }
  return { ok: true, backend: "none" };
}

async function releaseNotificationClaim(env, key) {
  if (env.NOTIFICATION_LOCK) {
    const stub = env.NOTIFICATION_LOCK.get(env.NOTIFICATION_LOCK.idFromName(key));
    await stub.fetch("https://notification-lock/release", { method: "POST", body: JSON.stringify({ action: "release" }) }).catch(() => {});
    return;
  }
  if (env.MERCH_ORDERS) {
    await env.MERCH_ORDERS.delete(`claim:${key}`).catch(() => {});
  }
}

async function commitNotificationClaim(env, key) {
  if (env.NOTIFICATION_LOCK) {
    const stub = env.NOTIFICATION_LOCK.get(env.NOTIFICATION_LOCK.idFromName(key));
    await stub.fetch("https://notification-lock/commit", { method: "POST", body: JSON.stringify({ action: "commit" }) }).catch(() => {});
  }
}

async function sendOrderStageNotification(env, sessionId, stage, fulfillment) {
  if (!sessionId || !stage) {
    return { status: "skipped", reason: "missing session id or stage" };
  }
  let stored = null;
  if (env.MERCH_ORDERS) {
    const existingRaw = await env.MERCH_ORDERS.get(orderKey(sessionId));
    if (existingRaw) {
      try {
        stored = JSON.parse(existingRaw);
      } catch (_err) {
        stored = null;
      }
    }
    const alreadyNotified = stage === "shipped" || stage === "delivered"
      ? !shipmentNotificationIsNew(stored, stage, fulfillment)
      : storedNotificationExists(stored, stage);
    if (alreadyNotified) {
      return { status: "duplicate", stage, session_id: sessionId };
    }
  }
  // Claim-before-send: the KV check above dedupes already-recorded notifications;
  // this closes the in-flight window between that check and the record, where two
  // concurrent triggers (webhook racing the poll, or a webhook redelivery) would
  // otherwise both send. The Durable Object makes the reservation fully atomic.
  const claimKey = notificationClaimKey(sessionId, stage, fulfillment);
  const claim = await acquireNotificationClaim(env, claimKey);
  if (!claim.ok) {
    return { status: "duplicate", stage, session_id: sessionId, claim: claim.backend };
  }
  const session = await fetchStripeCheckoutSession(env, sessionId, ["payment_intent.latest_charge", "payment_intent.payment_method"]);
  if (!session || session.error) {
    await releaseNotificationClaim(env, claimKey);
    return {
      status: "failed",
      reason: "Stripe Checkout session lookup failed",
      stripe_error: session && session.error,
      stage,
      session_id: sessionId,
    };
  }
  const notification = await sendLifecycleEmail(env, session, stage, fulfillment, {
    stored,
    previouslyNotifiedTracking: notifiedShipmentSignatures(stored, stage),
  });
  if (notification.status === "failed") {
    await releaseNotificationClaim(env, claimKey);
    console.error("SmartSleeve lifecycle email failed", JSON.stringify({
      stripe_session_id: sessionId,
      stage,
      http_status: notification.http_status,
      reason: notification.reason,
    }));
    return { status: "failed", stage, session_id: sessionId, notification };
  }
  const shipmentSignatures = stage === "shipped" || stage === "delivered"
    ? shipmentSignaturesFromFulfillment(fulfillment)
    : [];
  await recordOrderNotification(env, sessionId, stage, notification, stored, shipmentSignatures);
  await commitNotificationClaim(env, claimKey);
  // Keep the pending poll key alive after a shipment when split-shipment polling is
  // on, so later parcels are still caught; only clear on delivery (or if the split
  // behavior is disabled, revert to clearing after the first shipment).
  const clearAfterShipped = stage === "shipped"
    && !printfulDeliveryPollingEnabled(env)
    && !printfulSplitShipmentPollingEnabled(env);
  if (clearAfterShipped) {
    await clearPrintfulPendingPoll(env, sessionId, { stored });
  }
  return { status: notification.status, stage, session_id: sessionId, notification };
}

async function markInferredNotification(env, sessionId, stage, reason, fulfillment = null) {
  if (!env.MERCH_ORDERS || !sessionId || !stage) {
    return;
  }
  await recordOrderNotification(env, sessionId, stage, {
    status: "inferred",
    reason,
    email_sent: false,
  }, null, fulfillment ? shipmentSignaturesFromFulfillment(fulfillment) : []);
}

async function reconcilePolledShipmentNotifications(env, sessionId, stored, shipments) {
  if (!env.MERCH_ORDERS || !stored || !Array.isArray(shipments)) {
    return stored;
  }
  const notifications = stored.notifications && typeof stored.notifications === "object"
    ? Object.assign({}, stored.notifications)
    : {};
  const currentlyShipped = new Set();
  const currentlyDelivered = new Set();
  for (const shipment of shipments) {
    const stage = stageFromPrintfulShipment(shipment);
    const signatures = shipmentSignatures(shipment);
    if (stage === "shipped" || stage === "delivered") {
      signatures.forEach((signature) => currentlyShipped.add(signature));
    }
    if (stage === "delivered") {
      signatures.forEach((signature) => currentlyDelivered.add(signature));
    }
  }
  let changed = false;
  const shippedMapExists = notifications.shipped_shipments && typeof notifications.shipped_shipments === "object";
  if (shippedMapExists) {
    const filtered = Object.fromEntries(Object.entries(notifications.shipped_shipments)
      .filter(([signature]) => currentlyShipped.has(signature)));
    if (Object.keys(filtered).length !== Object.keys(notifications.shipped_shipments).length) {
      notifications.shipped_shipments = filtered;
      changed = true;
    }
  } else if (notifications.shipped && currentlyShipped.size) {
    notifications.shipped_shipments = Object.fromEntries(Array.from(currentlyShipped)
      .map((signature) => [signature, { stored_at: new Date().toISOString(), legacy_inferred: true }]));
    changed = true;
  }
  const deliveredMapExists = notifications.delivered_shipments && typeof notifications.delivered_shipments === "object";
  if (!deliveredMapExists && notifications.delivered && currentlyDelivered.size) {
    notifications.delivered_shipments = Object.fromEntries(Array.from(currentlyDelivered)
      .map((signature) => [signature, { stored_at: new Date().toISOString(), legacy_inferred: true }]));
    changed = true;
  }
  if (!changed) {
    return stored;
  }
  const updated = Object.assign({}, stored, { notifications });
  await env.MERCH_ORDERS.put(orderKey(sessionId), JSON.stringify(updated));
  return updated;
}

export async function processPolledPrintfulOrder(env, sessionId, stored) {
  const shipmentResult = await fetchPrintfulShipmentsForStoredOrder(env, sessionId, stored);
  if (!shipmentResult.ok) {
    return { status: "failed", reason: "Printful shipment lookup failed", session_id: sessionId, failures: shipmentResult.failures };
  }
  const shipments = Array.isArray(shipmentResult.shipments) ? shipmentResult.shipments : [];
  const stagedShipments = shipments
    .map((shipment) => ({ shipment, stage: stageFromPrintfulShipment(shipment) }))
    .filter((entry) => entry.stage);
  if (!stagedShipments.length) {
    return { status: "skipped", reason: "no shipped or delivered status yet", session_id: sessionId };
  }
  stored = await reconcilePolledShipmentNotifications(env, sessionId, stored, shipments);
  const results = [];
  for (const entry of stagedShipments) {
    const fulfillment = printfulPollingFulfillment({
      shipments: [entry.shipment],
      order: shipmentResult.order,
      lookup_source: shipmentResult.source,
      lookup_candidate_type: shipmentResult.candidate && shipmentResult.candidate.type,
    }, entry.stage);
    if (entry.stage === "delivered") {
      const shippedAlready = !shipmentNotificationIsNew(stored, "shipped", fulfillment);
      const delivered = await sendOrderStageNotification(env, sessionId, "delivered", fulfillment);
      results.push(delivered);
      if (!shippedAlready && delivered.status !== "failed") {
        await markInferredNotification(
          env,
          sessionId,
          "shipped",
          "delivery status was observed before a shipped email was sent",
          fulfillment,
        );
      }
    } else {
      results.push(await sendOrderStageNotification(env, sessionId, "shipped", fulfillment));
    }
  }
  const allKnownShipmentsDelivered = shipments.length > 0
    && shipments.every((shipment) => stageFromPrintfulShipment(shipment) === "delivered");
  if (allKnownShipmentsDelivered) {
    await clearPrintfulPendingPoll(env, sessionId, { stored });
  }
  const sent = results.filter((result) => result.status === "sent").length;
  const failed = results.filter((result) => result.status === "failed");
  return {
    status: failed.length ? "failed" : sent ? "sent" : "skipped",
    reason: failed.length ? "one or more parcel notifications failed" : sent ? undefined : "no new parcel notifications",
    session_id: sessionId,
    notification_count: sent,
    parcel_results: results,
    all_known_shipments_delivered: allKnownShipmentsDelivered,
  };
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
  const scanLimit = Math.min(
    1000,
    positiveEnvInt(env, "MERCH_PRINTFUL_POLL_SCAN_LIMIT", Math.max(PRINTFUL_POLL_DEFAULT_SCAN_LIMIT, limit * 5)),
  );
  const lookbackDays = positiveEnvInt(env, "MERCH_PRINTFUL_POLL_LOOKBACK_DAYS", PRINTFUL_POLL_DEFAULT_LOOKBACK_DAYS);
  let cursor;
  let scanned = 0;
  let considered = 0;
  let notifications = 0;
  let pruned = 0;
  const failures = [];
  do {
    const remainingScan = scanLimit - scanned;
    if (remainingScan <= 0 || considered >= limit) {
      break;
    }
    const listed = await env.MERCH_ORDERS.list({
      prefix: "printful:pending:",
      limit: Math.min(1000, remainingScan),
      cursor,
    });
    cursor = listed.cursor;
    for (const key of listed.keys || []) {
      if (considered >= limit) {
        break;
      }
      scanned += 1;
      const metadata = key.metadata && typeof key.metadata === "object" ? key.metadata : {};
      const sessionId = storedPendingSessionIdFromKey(key.name)
        || metadata.stripe_session_id
        || "";
      if (pendingMetadataIsExpired(metadata)) {
        if (sessionId) {
          await clearPrintfulPendingPoll(env, sessionId, { pendingKey: key.name });
        } else {
          await env.MERCH_ORDERS.delete(key.name);
        }
        pruned += 1;
        continue;
      }
      if (!sessionId) {
        continue;
      }
      if (pendingMetadataStageGoal(metadata) === "delivered" && !printfulDeliveryPollingEnabled(env)) {
        await clearPrintfulPendingPoll(env, sessionId, { pendingKey: key.name });
        pruned += 1;
        continue;
      }
      const raw = await env.MERCH_ORDERS.get(orderKey(sessionId));
      if (!raw) {
        await clearPrintfulPendingPoll(env, sessionId, { pendingKey: key.name });
        pruned += 1;
        continue;
      }
      let stored;
      try {
        stored = JSON.parse(raw);
      } catch (_err) {
        failures.push({ session_id: sessionId, reason: "stored order JSON parse failed" });
        continue;
      }
      if (!storedOrderIsPollable(env, stored, lookbackDays)) {
        await clearPrintfulPendingPoll(env, sessionId, { pendingKey: key.name, stored });
        pruned += 1;
        continue;
      }
      considered += 1;
      const result = await processPolledPrintfulOrder(env, sessionId, stored);
      notifications += Math.max(0, Number(result.notification_count) || (result.status === "sent" ? 1 : 0));
      if (result.status === "failed") {
        failures.push(result);
      }
    }
  } while (cursor && scanned < scanLimit && considered < limit);
  return {
    status: failures.length ? "completed_with_failures" : "completed",
    cron: context.cron,
    scheduled_time: context.scheduledTime,
    scanned,
    considered,
    notifications,
    pruned,
    scan_limit: scanLimit,
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
  const printfulPendingKeyName = await storePrintfulPendingPoll(env, session, fulfillment);
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
      printful_pending_key: printfulPendingKeyName || undefined,
    }),
  );
}

async function recordOrderNotification(env, sessionId, stage, notification, existing = null, shipmentSignatures = []) {
  if (!env.MERCH_ORDERS || !sessionId || !stage) {
    return;
  }
  const storedAt = new Date().toISOString();
  let stored = existing;
  if (!stored) {
    const existingRaw = await env.MERCH_ORDERS.get(orderKey(sessionId));
    if (!existingRaw) {
      return;
    }
    try {
      stored = JSON.parse(existingRaw);
    } catch (_err) {
      return;
    }
  }
  try {
    const notifications = stored.notifications && typeof stored.notifications === "object"
      ? stored.notifications
      : {};
    notifications[stage] = { stored_at: storedAt, notification };
    if ((stage === "shipped" || stage === "delivered") && Array.isArray(shipmentSignatures) && shipmentSignatures.length) {
      const mapKey = `${stage}_shipments`;
      const notifiedShipments = notifications[mapKey] && typeof notifications[mapKey] === "object"
        ? notifications[mapKey]
        : {};
      for (const signature of shipmentSignatures) {
        notifiedShipments[signature] = { stored_at: storedAt };
      }
      notifications[mapKey] = notifiedShipments;
    }
    await env.MERCH_ORDERS.put(orderKey(sessionId), JSON.stringify(Object.assign(stored, { notifications })));
  } catch (_err) {
    // Keep lifecycle processing resilient even if a historical order payload is malformed.
  }
}

// Identifying fields from a Printful webhook delivery, for duplicate-delivery
// observability. Printful payloads carry type/created/retries (no stable event id),
// so we log those plus the parcel signature to correlate repeat deliveries.
function printfulWebhookDeliveryInfo(payload, fulfillment) {
  const p = payload && typeof payload === "object" ? payload : {};
  return {
    type: p.type || p.event || p.event_type || "",
    created: p.created || p.created_at || "",
    retries: p.retries,
    store: p.store,
    shipment: shipmentSignaturesFromFulfillment(fulfillment),
  };
}

function fulfillmentHasShipmentItemReferences(fulfillment) {
  return shipmentRecordsFromFulfillment(fulfillment).some((shipment) => {
    const refs = shipmentItemOrderIdsAndNames(shipment);
    return refs.ids.length > 0 || refs.names.length > 0;
  });
}

async function enrichPrintfulWebhookFulfillment(env, sessionId, fulfillment) {
  if (fulfillmentHasShipmentItemReferences(fulfillment) || !env.MERCH_ORDERS || !env.PRINTFUL_API_KEY) {
    return fulfillment;
  }
  const raw = await env.MERCH_ORDERS.get(orderKey(sessionId));
  if (!raw) {
    return fulfillment;
  }
  let stored;
  try {
    stored = JSON.parse(raw);
  } catch (_err) {
    return fulfillment;
  }
  const lookup = await fetchPrintfulShipmentsForStoredOrder(env, sessionId, stored);
  if (!lookup.ok) {
    return fulfillment;
  }
  const eventShipments = shipmentRecordsFromFulfillment(fulfillment);
  const eventSignatures = new Set(eventShipments.flatMap(shipmentSignatures));
  const eventIds = new Set(eventShipments
    .map((shipment) => shipment && (shipment.shipment_id ?? shipment.id))
    .filter((value) => value !== undefined && value !== null)
    .map(String));
  const matched = (lookup.shipments || []).find((shipment) => {
    const id = shipment && (shipment.shipment_id ?? shipment.id);
    if (id !== undefined && id !== null && eventIds.has(String(id))) {
      return true;
    }
    return shipmentSignatures(shipment).some((signature) => eventSignatures.has(signature));
  });
  if (!matched) {
    return fulfillment;
  }
  return printfulPollingFulfillment({
    shipments: [matched],
    order: lookup.order,
    lookup_source: lookup.source,
    webhook_payload: fulfillment.provider_response,
  }, fulfillment.status);
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
  const webhookFulfillment = printfulWebhookFulfillment(payload, stage);
  const fulfillment = await enrichPrintfulWebhookFulfillment(env, sessionId, webhookFulfillment);
  const delivery = printfulWebhookDeliveryInfo(payload, fulfillment);
  // Observability: log every delivery so duplicate/retried Printful webhooks are
  // visible in `wrangler tail` / Cloudflare logs (the DO lock makes them harmless).
  console.log("SmartSleeve Printful webhook received", JSON.stringify(Object.assign({ session_id: sessionId, stage }, delivery)));
  const result = await sendOrderStageNotification(env, sessionId, stage, fulfillment);
  if (result.status === "duplicate") {
    console.warn("SmartSleeve duplicate Printful webhook suppressed", JSON.stringify(Object.assign({
      session_id: sessionId,
      stage,
      suppressed_by: result.claim ? "in_flight_claim" : "already_recorded",
    }, delivery)));
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
  const eventSession = event.data && event.data.object ? event.data.object : {};
  const session = eventSession.id
    ? await fetchStripeCheckoutSession(env, eventSession.id, ["payment_intent.latest_charge", "payment_intent.payment_method"])
    : eventSession;
  if (!session || session.error) {
    console.error("SmartSleeve Stripe session refresh failed", JSON.stringify({
      stripe_session_id: eventSession.id,
      stripe_error: session && session.error,
    }));
    return jsonResponse(request, env, {
      error: "Stripe Checkout session lookup failed",
      stripe_error: session && session.error,
    }, 502);
  }
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

function isStripeSessionId(value) {
  return /^cs_(test|live)_[A-Za-z0-9]+$/.test(String(value || "").trim());
}

async function sessionIdForAdminPrintfulLookup(env, body) {
  const directSessionId = String(body.session_id || "").trim();
  if (isStripeSessionId(directSessionId)) {
    return directSessionId;
  }
  const paymentIntentId = String(body.payment_intent || body.payment_intent_id || "").trim();
  if (paymentIntentId) {
    const session = await fetchStripeCheckoutSessionForPaymentIntent(env, paymentIntentId);
    if (session && session.id) {
      return session.id;
    }
  }
  if (!env.MERCH_ORDERS) {
    return "";
  }
  const externalIds = uniqueNonEmpty([
    body.external_id,
    body.printful_external_id,
    body.order_external_id,
    body.order_number,
  ]);
  for (const externalId of externalIds) {
    if (isStripeSessionId(externalId)) {
      return externalId;
    }
    const sessionId = await env.MERCH_ORDERS.get(printfulExternalIndexKey(externalId));
    if (sessionId) {
      return sessionId;
    }
  }
  const orderIds = uniqueNonEmpty([
    body.printful_order_id,
    body.order_id,
    body.provider_order_id,
  ]).map((value) => value.replace(/^#/, ""));
  for (const orderId of orderIds) {
    const sessionId = await env.MERCH_ORDERS.get(printfulOrderIndexKey(orderId));
    if (sessionId) {
      return sessionId;
    }
  }
  return "";
}

function printfulAdminRecoveryIdentifiers(body, sessionId) {
  const externalId = uniqueNonEmpty([
    body.external_id,
    body.printful_external_id,
    body.order_external_id,
    body.order_number,
    printfulExternalId(sessionId),
  ])[0];
  const orderId = uniqueNonEmpty([
    body.printful_order_id,
    body.order_id,
    body.provider_order_id,
  ]).map((value) => value.replace(/^#/, ""))[0];
  return { externalId, orderId };
}

function recoveredPrintfulFulfillment(body, sessionId) {
  const identifiers = printfulAdminRecoveryIdentifiers(body, sessionId);
  const result = {
    external_id: identifiers.externalId,
    source: "admin_payment_intent_recovery",
  };
  if (identifiers.orderId) {
    result.id = identifiers.orderId;
    result.order_id = identifiers.orderId;
    result.printful_order_id = identifiers.orderId;
  }
  return {
    status: "submitted",
    provider: "printful",
    provider_response: { result },
  };
}

async function recoverStoredPrintfulOrderForPoll(env, body, sessionId) {
  const session = await fetchStripeCheckoutSession(env, sessionId, ["payment_intent.latest_charge", "payment_intent.payment_method"]);
  if (!session || session.error) {
    return { error: "Stripe Checkout session lookup failed", stripe_error: session && session.error, status: 502 };
  }
  const paymentStatus = String(session.payment_status || "").toLowerCase();
  if (paymentStatus !== "paid") {
    return { error: "Stripe session is not paid", payment_status: paymentStatus || "unknown", status: 409 };
  }
  const fulfillment = recoveredPrintfulFulfillment(body, sessionId);
  await storeOrder(env, session, fulfillment, {
    status: "recovered",
    reason: "admin_poll_printful_order",
    recovered_at: new Date().toISOString(),
  });
  const raw = await env.MERCH_ORDERS.get(orderKey(sessionId));
  if (!raw) {
    return { error: "Recovered SmartSleeve order was not readable from KV", status: 502 };
  }
  try {
    return { stored: JSON.parse(raw), recovered: true };
  } catch (_err) {
    return { error: "Recovered SmartSleeve order JSON parse failed", status: 500 };
  }
}

async function pollPrintfulForSingleOrder(request, env) {
  if (!isAdminAuthorized(request, env, { allowRecoveryToken: true })) {
    return jsonResponse(request, env, { error: "Unauthorized" }, 401);
  }
  if (!env.MERCH_ORDERS) {
    return jsonResponse(request, env, { error: "MERCH_ORDERS KV binding not configured" }, 503);
  }
  if (!env.PRINTFUL_API_KEY) {
    return jsonResponse(request, env, { error: "PRINTFUL_API_KEY not configured" }, 503);
  }
  const body = await readJson(request);
  const sessionId = await sessionIdForAdminPrintfulLookup(env, body);
  if (!sessionId) {
    return jsonResponse(request, env, {
      error: "No SmartSleeve order mapping found",
      accepted_identifiers: ["session_id", "external_id", "printful_external_id", "printful_order_id"],
    }, 404);
  }
  const raw = await env.MERCH_ORDERS.get(orderKey(sessionId));
  let stored;
  let recovered = false;
  if (raw) {
    try {
      stored = JSON.parse(raw);
    } catch (_err) {
      return jsonResponse(request, env, { error: "Stored SmartSleeve order JSON parse failed", session_id: sessionId }, 500);
    }
  } else {
    const recovery = await recoverStoredPrintfulOrderForPoll(env, body, sessionId);
    if (recovery.error) {
      return jsonResponse(request, env, Object.assign({ session_id: sessionId }, recovery), recovery.status || 500);
    }
    stored = recovery.stored;
    recovered = Boolean(recovery.recovered);
  }
  const result = await processPolledPrintfulOrder(env, sessionId, stored);
  const status = result.status === "failed" ? 502 : 200;
  return jsonResponse(request, env, { session_id: sessionId, recovered, result }, status);
}

async function preflightPrintful(request, env) {
  if (!isAdminAuthorized(request, env)) {
    return jsonResponse(request, env, { error: "Unauthorized" }, 401);
  }
  if (!env.PRINTFUL_API_KEY) {
    return jsonResponse(request, env, { error: "PRINTFUL_API_KEY not configured" }, 503);
  }
  const body = await readJson(request);
  const selection = preflightCheckoutItems(env, body);
  if (selection.items.length === 0) {
    return jsonResponse(request, env, {
      status: "skipped",
      reason: "No matching catalog items selected",
      total_candidates: selection.total_candidates,
      offset: selection.offset,
      limit: selection.limit,
    }, 400);
  }
  const result = await preflightPrintfulV2Items(env, selection.items, body.create_draft === true);
  const ok = result.status === "passed";
  return jsonResponse(request, env, Object.assign({
    api_version: "v2",
    total_candidates: selection.total_candidates,
    offset: selection.offset,
    limit: selection.limit,
  }, result), ok ? 200 : 502);
}

function notificationLockJson(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Strongly-consistent, single-threaded lock that makes notification claims fully
// atomic across the racing webhook and scheduled-poll paths. One instance per
// notification key (idFromName(key)) serializes claim/commit/release, so even two
// perfectly simultaneous triggers for the same parcel can never both send.
export class NotificationLock {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async fetch(request) {
    let body = {};
    try {
      body = await request.json();
    } catch (_err) {
      body = {};
    }
    const action = body.action;
    const staleMs = Number(body.staleMs) > 0 ? Number(body.staleMs) : 120000;
    return this.ctx.blockConcurrencyWhile(async () => {
      const current = await this.ctx.storage.get("entry");
      const now = Date.now();
      if (action === "claim") {
        if (current) {
          const isStaleClaim = current.status === "claiming"
            && typeof current.at === "number"
            && now - current.at > staleMs;
          if (!isStaleClaim) {
            return notificationLockJson({ claimed: false, existing: current });
          }
        }
        await this.ctx.storage.put("entry", { status: "claiming", at: now });
        return notificationLockJson({ claimed: true });
      }
      if (action === "commit") {
        await this.ctx.storage.put("entry", { status: "committed", at: now });
        return notificationLockJson({ ok: true });
      }
      if (action === "release") {
        await this.ctx.storage.delete("entry");
        return notificationLockJson({ ok: true });
      }
      return notificationLockJson({ error: "unknown action" }, 400);
    });
  }
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
        printful_poll_scan_limit: positiveEnvInt(env, "MERCH_PRINTFUL_POLL_SCAN_LIMIT", PRINTFUL_POLL_DEFAULT_SCAN_LIMIT),
        printful_poll_lookback_days: positiveEnvInt(env, "MERCH_PRINTFUL_POLL_LOOKBACK_DAYS", PRINTFUL_POLL_DEFAULT_LOOKBACK_DAYS),
        printful_delivery_poll_enabled: printfulDeliveryPollingEnabled(env),
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
    if (request.method === "POST" && url.pathname === "/admin/poll-printful-order") {
      return pollPrintfulForSingleOrder(request, env);
    }
    if (request.method === "POST" && url.pathname === "/admin/preflight-printful") {
      return preflightPrintful(request, env);
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
