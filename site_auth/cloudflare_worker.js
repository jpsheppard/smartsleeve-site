// SmartSleeve account-registration and email-verification Worker.
//
// Cloudflare Worker requirements:
//   - KV binding: SMARTSLEEVE_AUTH
//   - Secret: RESEND_API_KEY
//
// Optional Worker variables/secrets:
//   - SMARTSLEEVE_AUTH_FROM_EMAIL
//   - SMARTSLEEVE_AUTH_REPLY_TO_EMAIL
//   - SMARTSLEEVE_AUTH_APP_URL
//   - SMARTSLEEVE_AUTH_ALLOWED_ORIGINS
//   - SMARTSLEEVE_PLATFORM_ACCESS_EMAILS
//   - SMARTSLEEVE_AUTH_VERIFY_URL
//   - SMARTSLEEVE_AUTH_RESET_URL
//
// Routes:
//   POST /register
//   POST /login
//   GET  /me
//   POST /profile
//   POST /logout
//   GET  /verify?token=...
//   POST /verify
//   POST /password-reset/request
//   POST /password-reset/confirm
//   GET  /health

const DEFAULT_SITE = "https://smartsleeve.ai";
const DEFAULT_FROM_EMAIL = "SmartSleeve Accounts <accounts@smartsleeve.ai>";
const DEFAULT_REPLY_TO = "SmartSleeve Accounts <accounts@smartsleeve.ai>";
const EMAIL_BANNER_URL = "https://sqts-assets.sfo2.cdn.digitaloceanspaces.com/sqts-logo-llc-v5.png";
const PENDING_TTL_SECONDS = 60 * 60 * 24;
const PASSWORD_RESET_TTL_SECONDS = 60 * 60;
const RATE_LIMIT_TTL_SECONDS = 60 * 10;
const MAX_REGISTRATIONS_PER_WINDOW = 6;
const MAX_LOGINS_PER_WINDOW = 12;
const MAX_PASSWORD_RESETS_PER_WINDOW = 5;
const MIN_PASSWORD_LENGTH = 12;
const PBKDF2_ITERATIONS = 100000;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const SESSION_COOKIE = "smartsleeve_session";

function allowedOrigins(env) {
  const configured = String(env.SMARTSLEEVE_AUTH_ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return new Set([
    DEFAULT_SITE,
    "https://www.smartsleeve.ai",
    "https://sqts-assets.sfo2.cdn.digitaloceanspaces.com",
    ...configured,
  ]);
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = allowedOrigins(env);
  const allowOrigin = allowed.has(origin) ? origin : DEFAULT_SITE;
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Credentials": "true",
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

function htmlResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeName(value, maxLength = 80) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[<>]/g, "")
    .slice(0, maxLength);
}

function normalizeAddressLine(value, maxLength = 96) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[<>]/g, "")
    .slice(0, maxLength);
}

function normalizeCountry(value) {
  const country = String(value || "US").trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
  return country || "US";
}

function normalizePhone(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (raw.startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return raw.replace(/[<>]/g, "").slice(0, 32);
}

function isValidPhone(phone) {
  return !phone || /^\+[1-9]\d{7,14}$/.test(phone);
}

function collectShippingAddress(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    name: normalizeName(source.name, 120),
    line1: normalizeAddressLine(source.line1 || source.address1),
    line2: normalizeAddressLine(source.line2 || source.address2),
    city: normalizeAddressLine(source.city, 80),
    state: normalizeAddressLine(source.state || source.state_code, 40),
    postal_code: normalizeAddressLine(source.postal_code || source.zip, 20),
    country: normalizeCountry(source.country || source.country_code || "US"),
    phone: normalizePhone(source.phone),
  };
}

function hasShippingAddress(address) {
  return Boolean(address && address.line1 && address.city && address.state && address.postal_code && address.country);
}

function hasAnyShippingAddress(address) {
  return Boolean(address && (address.line1 || address.line2 || address.city || address.state || address.postal_code));
}

function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .slice(0, 254);
}

function isValidNewUsername(username) {
  return username.length >= 3
    && username.length <= 32
    && /^[a-z0-9](?:[a-z0-9_.-]*[a-z0-9])?$/.test(username);
}

function usernameIndexKey(username) {
  return `profile:username:${normalizeUsername(username)}`;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function bytesToBase64Url(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomToken(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function sha256Hex(value) {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashPassword(password, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: new TextEncoder().encode(salt),
      iterations: PBKDF2_ITERATIONS,
    },
    keyMaterial,
    256
  );
  return bytesToBase64Url(new Uint8Array(bits));
}

function constantTimeEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return diff === 0;
}

async function getNumber(kv, key) {
  const parsed = Number((await kv.get(key)) || "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

async function incrementWithTtl(kv, key, ttl) {
  const next = (await getNumber(kv, key)) + 1;
  await kv.put(key, String(next), { expirationTtl: ttl });
  return next;
}

function requestIp(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For") ||
    "unknown"
  )
    .split(",")[0]
    .trim()
    .slice(0, 80);
}

async function enforceRegistrationRateLimit(request, env, emailHash) {
  const ipHash = await sha256Hex(requestIp(request));
  const ipCount = await incrementWithTtl(env.SMARTSLEEVE_AUTH, `rate:register:ip:${ipHash}`, RATE_LIMIT_TTL_SECONDS);
  const emailCount = await incrementWithTtl(
    env.SMARTSLEEVE_AUTH,
    `rate:register:email:${emailHash}`,
    RATE_LIMIT_TTL_SECONDS
  );
  return ipCount <= MAX_REGISTRATIONS_PER_WINDOW && emailCount <= MAX_REGISTRATIONS_PER_WINDOW;
}

async function enforceLoginRateLimit(request, env, identityHash) {
  const ipHash = await sha256Hex(requestIp(request));
  const ipCount = await incrementWithTtl(env.SMARTSLEEVE_AUTH, `rate:login:ip:${ipHash}`, RATE_LIMIT_TTL_SECONDS);
  const identityCount = await incrementWithTtl(
    env.SMARTSLEEVE_AUTH,
    `rate:login:identity:${identityHash}`,
    RATE_LIMIT_TTL_SECONDS
  );
  return ipCount <= MAX_LOGINS_PER_WINDOW && identityCount <= MAX_LOGINS_PER_WINDOW;
}

async function enforcePasswordResetRateLimit(request, env, usernameHash) {
  const ipHash = await sha256Hex(requestIp(request));
  const ipCount = await incrementWithTtl(env.SMARTSLEEVE_AUTH, `rate:reset:ip:${ipHash}`, RATE_LIMIT_TTL_SECONDS);
  const usernameCount = await incrementWithTtl(
    env.SMARTSLEEVE_AUTH,
    `rate:reset:username:${usernameHash}`,
    RATE_LIMIT_TTL_SECONDS
  );
  return ipCount <= MAX_PASSWORD_RESETS_PER_WINDOW && usernameCount <= MAX_PASSWORD_RESETS_PER_WINDOW;
}

function appUrl(env) {
  return String(env.SMARTSLEEVE_AUTH_APP_URL || `${DEFAULT_SITE}/app/`).replace(/\/?$/, "/");
}

function actionUrl(base, token) {
  const url = new URL(base);
  url.searchParams.set("token", token);
  return url.toString();
}

function verificationUrl(env, token) {
  return actionUrl(env.SMARTSLEEVE_AUTH_VERIFY_URL || `${DEFAULT_SITE}/verify.html`, token);
}

function passwordResetUrl(env, token) {
  return actionUrl(env.SMARTSLEEVE_AUTH_RESET_URL || `${DEFAULT_SITE}/reset-password.html`, token);
}

function developerEmails(env) {
  return new Set(
    String(env.SMARTSLEEVE_DEVELOPER_EMAILS || "")
      .split(",")
      .map(normalizeEmail)
      .filter(Boolean)
  );
}

function platformAccessEmails(env) {
  return new Set([
    ...developerEmails(env),
    ...String(env.SMARTSLEEVE_PLATFORM_ACCESS_EMAILS || "")
      .split(",")
      .map(normalizeEmail)
      .filter(Boolean),
  ]);
}

function accountHasPlatformAccess(profile, env) {
  const email = normalizeEmail(profile.email);
  return Boolean(
    platformAccessEmails(env).has(email) ||
    profile.platform_access === true ||
    profile.platform_access === "true"
  );
}

function publicProfile(record, env) {
  const profile = record.profile || {};
  const shipping = collectShippingAddress(profile.shipping_address || {});
  const email = normalizeEmail(profile.email);
  const role = developerEmails(env).has(email) ? "developer" : "user";
  const platformAccess = accountHasPlatformAccess(profile, env);
  return {
    username: profile.username || "",
    email: profile.email || "",
    first_name: profile.first_name || "",
    middle_name: profile.middle_name || "",
    last_name: profile.last_name || "",
    phone: profile.phone || shipping.phone || "",
    nickname: profile.nickname || "",
    display_name: [profile.first_name, profile.middle_name, profile.last_name].filter(Boolean).join(" ").trim() || profile.nickname || profile.username || profile.email || "",
    shipping_address: hasShippingAddress(shipping) ? shipping : null,
    account_type: profile.account_type || "general_website",
    role,
    platform_access: platformAccess,
    platform_status: platformAccess ? "enabled" : "not_enabled",
    verified_at: record.verified_at || null,
  };
}

function parseCookies(request) {
  return Object.fromEntries(
    String(request.headers.get("Cookie") || "")
      .split(";")
      .map((cookie) => cookie.trim())
      .filter(Boolean)
      .map((cookie) => {
        const splitAt = cookie.indexOf("=");
        if (splitAt === -1) {
          return [cookie, ""];
        }
        return [cookie.slice(0, splitAt), decodeURIComponent(cookie.slice(splitAt + 1))];
      })
  );
}

function bearerToken(request) {
  const header = String(request.headers.get("Authorization") || "");
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : "";
}

function sessionCookie(token, maxAge = SESSION_TTL_SECONDS) {
  const expires = maxAge > 0 ? `Max-Age=${maxAge}` : "Max-Age=0";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${expires}; Path=/; HttpOnly; Secure; SameSite=None`;
}

function jsonWithCookie(request, env, payload, cookie, status = 200) {
  const response = jsonResponse(request, env, payload, status);
  response.headers.append("Set-Cookie", cookie);
  return response;
}

function accountEmailHtml({ profile, eyebrow, title, intro, detail, buttonLabel, actionLink, securityNote }) {
  const name = profile.first_name || "there";
  return `<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;background:#0b1120;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0b1120;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:640px;background:#1e2a44;border:1px solid #33415a;border-radius:12px;overflow:hidden;">
        <tr><td style="padding:20px 20px 4px;background:#1e2a44;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#111220;border-radius:16px;overflow:hidden;">
            <tr><td align="center" style="padding:20px 24px;">
              <img src="${EMAIL_BANNER_URL}" alt="SmartSleeve Quantitative Trading Systems, LLC" width="500" style="display:block;width:100%;max-width:500px;height:auto;margin:0 auto;">
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:28px 28px 8px;color:#f8fafc;">
          <p style="margin:0 0 10px;color:#54c98a;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;">${escapeHtml(eyebrow)}</p>
          <h1 style="margin:0 0 20px;color:#f8fafc;font-family:Georgia,'Iowan Old Style',serif;font-size:30px;line-height:1.15;">${escapeHtml(title)}</h1>
          <p style="margin:0 0 16px;color:#f8fafc;font-size:15px;line-height:1.55;">Hi ${escapeHtml(name)},</p>
          <p style="margin:0 0 16px;color:#cbd5e1;font-size:15px;line-height:1.6;">${escapeHtml(intro)}</p>
          <p style="margin:0;color:#cbd5e1;font-size:15px;line-height:1.6;">${escapeHtml(detail)}</p>
        </td></tr>
        <tr><td align="center" style="padding:20px 28px 26px;">
          <a href="${escapeHtml(actionLink)}" style="display:inline-block;padding:14px 24px;border-radius:10px;color:#06110a;background:#39ff14;font-size:15px;font-weight:900;text-decoration:none;box-shadow:0 8px 24px rgba(57,255,20,.20);">${escapeHtml(buttonLabel)}</a>
        </td></tr>
        <tr><td style="padding:0 28px 26px;color:#94a3b8;font-size:12.5px;line-height:1.6;">
          ${escapeHtml(securityNote)}
        </td></tr>
        <tr><td style="padding:18px 24px 22px;border-top:1px solid #33415a;color:#94a3b8;font-size:11px;line-height:1.6;">
          &copy; 2026 SmartSleeve Quantitative Trading Systems, LLC
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function verificationEmailHtml(profile, verifyUrl) {
  return accountEmailHtml({
    profile,
    eyebrow: "SmartSleeve Accounts",
    title: "Verify your email",
    intro: `Thanks for creating the username ${profile.username}. Confirm this email address to activate your general SmartSleeve website account.`,
    detail: "Once verified, you can sign in across the website and reuse your profile for faster merch checkout. Portal access is granted separately by SmartSleeve.",
    buttonLabel: "Verify email",
    actionLink: verifyUrl,
    securityNote: "This verification link expires in 24 hours. If you did not request this account, you can safely ignore this email.",
  });
}

function verificationEmailText(profile, verifyUrl) {
  return [
    `Hi ${profile.first_name || "there"},`,
    "",
    `Thanks for creating the SmartSleeve username ${profile.username}.`,
    "Confirm your email to activate your general SmartSleeve website account:",
    verifyUrl,
    "",
    "This link expires in 24 hours. Portal access is granted separately by SmartSleeve.",
    "If you did not request this account, ignore this email.",
    "",
    "© 2026 SmartSleeve Quantitative Trading Systems, LLC",
  ].join("\n");
}

function passwordResetEmailHtml(profile, resetUrl) {
  return accountEmailHtml({
    profile,
    eyebrow: "SmartSleeve Accounts",
    title: "Reset your password",
    intro: `We received a password reset request for the username ${profile.username}.`,
    detail: "Use the secure link below to choose a new password. Completing the reset will sign this account out of its older sessions.",
    buttonLabel: "Reset password",
    actionLink: resetUrl,
    securityNote: "This reset link expires in one hour and can be used only once. If you did not request it, you can safely ignore this email.",
  });
}

function passwordResetEmailText(profile, resetUrl) {
  return [
    `Hi ${profile.first_name || "there"},`,
    "",
    `We received a password reset request for the username ${profile.username}.`,
    `Reset your password here: ${resetUrl}`,
    "",
    "This link expires in one hour and can be used only once.",
    "If you did not request this reset, ignore this email.",
    "",
    "© 2026 SmartSleeve Quantitative Trading Systems, LLC",
  ].join("\n");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sendTransactionalEmail(env, { to, subject, html, text, idempotencyKey }) {
  if (!env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not configured");
  }
  const payload = {
    from: env.SMARTSLEEVE_AUTH_FROM_EMAIL || DEFAULT_FROM_EMAIL,
    to: [to],
    reply_to: env.SMARTSLEEVE_AUTH_REPLY_TO_EMAIL || DEFAULT_REPLY_TO,
    subject,
    html,
    text,
  };
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend email failed: HTTP ${response.status} ${body.slice(0, 240)}`);
  }
  return response.json();
}

function sendVerificationEmail(env, profile, verifyUrl, tokenHash) {
  return sendTransactionalEmail(env, {
    to: profile.email,
    subject: "Verify your SmartSleeve account",
    html: verificationEmailHtml(profile, verifyUrl),
    text: verificationEmailText(profile, verifyUrl),
    idempotencyKey: `smartsleeve-verify-${tokenHash}`,
  });
}

function sendPasswordResetEmail(env, profile, resetUrl, tokenHash) {
  return sendTransactionalEmail(env, {
    to: profile.email,
    subject: "Reset your SmartSleeve password",
    html: passwordResetEmailHtml(profile, resetUrl),
    text: passwordResetEmailText(profile, resetUrl),
    idempotencyKey: `smartsleeve-reset-${tokenHash}`,
  });
}

function collectProfile(payload) {
  const email = normalizeEmail(payload.email);
  const username = normalizeUsername(payload.username);
  const firstName = normalizeName(payload.first_name);
  const middleName = normalizeName(payload.middle_name);
  const lastName = normalizeName(payload.last_name);
  const phone = normalizePhone(payload.phone);
  const shipping = collectShippingAddress(payload.shipping_address || {});
  if (!shipping.name) {
    shipping.name = [firstName, middleName, lastName].filter(Boolean).join(" ");
  }
  if (!shipping.phone && phone) {
    shipping.phone = phone;
  }
  return {
    username,
    email,
    first_name: firstName,
    middle_name: middleName,
    last_name: lastName,
    phone,
    shipping_address: hasAnyShippingAddress(shipping) ? shipping : null,
    account_type: "general_website",
    nickname: normalizeName(payload.nickname, 40),
    report_recipients: String(payload.report_recipients || "")
      .split(",")
      .map(normalizeEmail)
      .filter(Boolean)
      .slice(0, 8),
    investor_notes_present: Boolean(String(payload.notes || "").trim()),
  };
}

function validateRegistration(payload, profile) {
  const errors = [];
  const password = String(payload.password || "");
  if (!isValidNewUsername(profile.username)) {
    errors.push("username_must_be_3_to_32_characters_using_letters_numbers_dots_hyphens_or_underscores");
  }
  if (!isValidEmail(profile.email)) {
    errors.push("valid_email_required");
  }
  if (!profile.first_name) {
    errors.push("first_name_required");
  }
  if (!profile.last_name) {
    errors.push("last_name_required");
  }
  if (!isValidPhone(profile.phone)) {
    errors.push("valid_phone_number_required");
  }
  if (profile.shipping_address && !hasShippingAddress(profile.shipping_address)) {
    errors.push("shipping_address_must_be_complete_or_empty");
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    errors.push("password_must_be_at_least_12_characters");
  }
  if (password !== String(payload.password_confirm || "")) {
    errors.push("password_confirmation_mismatch");
  }
  if (!payload.accepted_terms) {
    errors.push("terms_and_disclosures_required");
  }
  return errors;
}

async function register(request, env) {
  if (!env.SMARTSLEEVE_AUTH) {
    return jsonResponse(request, env, { ok: false, error: "auth_storage_not_configured" }, 503);
  }

  let payload = {};
  try {
    payload = await request.json();
  } catch (_err) {
    return jsonResponse(request, env, { ok: false, error: "invalid_json" }, 400);
  }

  const profile = collectProfile(payload);
  const errors = validateRegistration(payload, profile);
  if (errors.length) {
    return jsonResponse(request, env, { ok: false, error: "validation_failed", errors }, 400);
  }

  const emailHash = await sha256Hex(profile.email);
  const accountKey = `account:${emailHash}`;
  if (await env.SMARTSLEEVE_AUTH.get(accountKey)) {
    return jsonResponse(request, env, {
      ok: true,
      status: "verification_email_requested",
      message: "If this registration is eligible, a verification email will arrive shortly.",
    });
  }

  const usernameKey = usernameIndexKey(profile.username);
  const usernameOwner = String((await env.SMARTSLEEVE_AUTH.get(usernameKey)) || "");
  const usernameReservationKey = `pending:username:${profile.username}`;
  const reservedBy = String((await env.SMARTSLEEVE_AUTH.get(usernameReservationKey)) || "");
  if ((usernameOwner && usernameOwner !== emailHash) || (reservedBy && reservedBy !== emailHash)) {
    return jsonResponse(request, env, { ok: false, error: "username_unavailable" }, 409);
  }

  const allowed = await enforceRegistrationRateLimit(request, env, emailHash);
  if (!allowed) {
    return jsonResponse(request, env, { ok: false, error: "rate_limited" }, 429);
  }

  const now = new Date().toISOString();
  const salt = randomToken(18);
  const password_hash = await hashPassword(String(payload.password || ""), salt);
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const pendingKey = `pending:${emailHash}`;
  const verifyKey = `verify:${tokenHash}`;
  const previousPending = JSON.parse((await env.SMARTSLEEVE_AUTH.get(pendingKey)) || "null");
  if (previousPending && previousPending.verify_key) {
    await env.SMARTSLEEVE_AUTH.delete(previousPending.verify_key);
  }
  if (previousPending && previousPending.profile && previousPending.profile.username) {
    await env.SMARTSLEEVE_AUTH.delete(`pending:username:${previousPending.profile.username}`);
  }
  const record = {
    schema_version: 2,
    status: "pending_email_verification",
    created_at: now,
    updated_at: now,
    expires_at: new Date(Date.now() + PENDING_TTL_SECONDS * 1000).toISOString(),
    email_hash: emailHash,
    session_epoch: 0,
    profile,
    password: {
      algorithm: "PBKDF2-SHA256",
      iterations: PBKDF2_ITERATIONS,
      salt,
      hash: password_hash,
    },
  };
  await env.SMARTSLEEVE_AUTH.put(pendingKey, JSON.stringify({ ...record, verify_key: verifyKey }), {
    expirationTtl: PENDING_TTL_SECONDS,
  });
  await env.SMARTSLEEVE_AUTH.put(verifyKey, JSON.stringify({ pending_key: pendingKey, email_hash: emailHash }), {
    expirationTtl: PENDING_TTL_SECONDS,
  });
  await env.SMARTSLEEVE_AUTH.put(usernameReservationKey, emailHash, {
    expirationTtl: PENDING_TTL_SECONDS,
  });

  const verifyUrl = verificationUrl(env, token);
  try {
    await sendVerificationEmail(env, profile, verifyUrl, tokenHash);
    return jsonResponse(request, env, {
      ok: true,
      status: "verification_email_sent",
      message: "Check your inbox for a SmartSleeve verification email.",
    });
  } catch (err) {
    await env.SMARTSLEEVE_AUTH.delete(verifyKey);
    await env.SMARTSLEEVE_AUTH.delete(pendingKey);
    await env.SMARTSLEEVE_AUTH.delete(usernameReservationKey);
    console.error(JSON.stringify({ event: "verification_email_failed", error: String(err && err.message || err).slice(0, 240) }));
    return jsonResponse(request, env, { ok: false, error: "verification_email_failed" }, 502);
  }
}

async function lookupVerifiedAccount(env, identity) {
  const username = normalizeUsername(identity);
  let emailHash = String((await env.SMARTSLEEVE_AUTH.get(usernameIndexKey(username))) || "");
  // Temporary compatibility for email-usernames created before the username index migration.
  if (!emailHash && isValidEmail(username)) {
    const candidateHash = await sha256Hex(username);
    const candidate = JSON.parse((await env.SMARTSLEEVE_AUTH.get(`account:${candidateHash}`)) || "null");
    if (candidate && normalizeUsername(candidate.profile && candidate.profile.username) === username) {
      emailHash = candidateHash;
    }
  }
  if (!emailHash) {
    return null;
  }
  const record = JSON.parse((await env.SMARTSLEEVE_AUTH.get(`account:${emailHash}`)) || "null");
  if (!record || record.status !== "email_verified") {
    return null;
  }
  return { emailHash, record };
}

async function login(request, env) {
  if (!env.SMARTSLEEVE_AUTH) {
    return jsonResponse(request, env, { ok: false, error: "auth_storage_not_configured" }, 503);
  }

  let payload = {};
  try {
    payload = await request.json();
  } catch (_err) {
    return jsonResponse(request, env, { ok: false, error: "invalid_json" }, 400);
  }

  const identity = String(payload.email || payload.username || payload.identity || "").trim();
  const password = String(payload.password || "");
  if (!identity || !password) {
    return jsonResponse(request, env, { ok: false, error: "username_and_password_required" }, 400);
  }

  const identityHash = await sha256Hex(identity.toLowerCase());
  const allowed = await enforceLoginRateLimit(request, env, identityHash);
  if (!allowed) {
    return jsonResponse(request, env, { ok: false, error: "rate_limited" }, 429);
  }

  const account = await lookupVerifiedAccount(env, identity);
  if (!account) {
    return jsonResponse(request, env, { ok: false, error: "invalid_credentials" }, 401);
  }

  const expected = account.record.password || {};
  const actualHash = await hashPassword(password, expected.salt || "");
  if (!constantTimeEqual(actualHash, expected.hash || "")) {
    return jsonResponse(request, env, { ok: false, error: "invalid_credentials" }, 401);
  }

  const token = randomToken(36);
  const sessionHash = await sha256Hex(token);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  await env.SMARTSLEEVE_AUTH.put(
    `session:${sessionHash}`,
    JSON.stringify({
      schema_version: 1,
      email_hash: account.emailHash,
      session_epoch: Number(account.record.session_epoch || 0),
      created_at: now,
      last_seen_at: now,
      expires_at: expiresAt,
    }),
    { expirationTtl: SESSION_TTL_SECONDS }
  );

  return jsonWithCookie(
    request,
    env,
    { ok: true, status: "logged_in", session_token: token, session_expires_at: expiresAt, profile: publicProfile(account.record, env) },
    sessionCookie(token)
  );
}

async function currentSession(request, env) {
  const result = await currentAccountSession(request, env);
  if (!result.ok) {
    return result;
  }
  return { ok: true, status: 200, profile: publicProfile(result.record, env), session_expires_at: result.session.expires_at || null };
}

async function currentAccountSession(request, env) {
  if (!env.SMARTSLEEVE_AUTH) {
    return { ok: false, error: "auth_storage_not_configured", status: 503 };
  }
  const token = parseCookies(request)[SESSION_COOKIE] || bearerToken(request);
  if (!token) {
    return { ok: false, error: "not_authenticated", status: 401 };
  }
  const sessionHash = await sha256Hex(token);
  const sessionKey = `session:${sessionHash}`;
  const session = JSON.parse((await env.SMARTSLEEVE_AUTH.get(sessionKey)) || "null");
  if (!session || !session.email_hash) {
    return { ok: false, error: "not_authenticated", status: 401 };
  }
  const record = JSON.parse((await env.SMARTSLEEVE_AUTH.get(`account:${session.email_hash}`)) || "null");
  if (!record || record.status !== "email_verified") {
    await env.SMARTSLEEVE_AUTH.delete(sessionKey);
    return { ok: false, error: "not_authenticated", status: 401 };
  }
  if (Number(session.session_epoch || 0) !== Number(record.session_epoch || 0)) {
    await env.SMARTSLEEVE_AUTH.delete(sessionKey);
    return { ok: false, error: "not_authenticated", status: 401 };
  }
  await env.SMARTSLEEVE_AUTH.put(
    sessionKey,
    JSON.stringify({ ...session, last_seen_at: new Date().toISOString() }),
    { expirationTtl: SESSION_TTL_SECONDS }
  );
  return { ok: true, status: 200, emailHash: session.email_hash, session, sessionKey, record };
}

async function me(request, env) {
  const result = await currentSession(request, env);
  return jsonResponse(request, env, result, result.status || (result.ok ? 200 : 401));
}

async function updateProfile(request, env) {
  const session = await currentAccountSession(request, env);
  if (!session.ok) {
    return jsonResponse(request, env, session, session.status || 401);
  }

  let payload = {};
  try {
    payload = await request.json();
  } catch (_err) {
    return jsonResponse(request, env, { ok: false, error: "invalid_json" }, 400);
  }

  const record = session.record || {};
  const current = record.profile || {};
  const nextProfile = {
    ...current,
    first_name: normalizeName(payload.first_name != null ? payload.first_name : current.first_name),
    middle_name: normalizeName(payload.middle_name != null ? payload.middle_name : current.middle_name),
    last_name: normalizeName(payload.last_name != null ? payload.last_name : current.last_name),
    phone: normalizePhone(payload.phone != null ? payload.phone : current.phone),
    nickname: normalizeName(payload.nickname != null ? payload.nickname : current.nickname, 40),
  };
  if (!isValidPhone(nextProfile.phone)) {
    return jsonResponse(request, env, { ok: false, error: "valid_phone_number_required" }, 400);
  }
  if (payload.shipping_address !== undefined) {
    const shipping = collectShippingAddress(payload.shipping_address);
    if (hasAnyShippingAddress(shipping) && !hasShippingAddress(shipping)) {
      return jsonResponse(request, env, { ok: false, error: "shipping_address_must_be_complete_or_empty" }, 400);
    }
    if (!shipping.name) {
      shipping.name = [nextProfile.first_name, nextProfile.middle_name, nextProfile.last_name].filter(Boolean).join(" ");
    }
    if (!shipping.phone && nextProfile.phone) {
      shipping.phone = nextProfile.phone;
    }
    nextProfile.shipping_address = hasShippingAddress(shipping) ? shipping : null;
  }

  const nextRecord = {
    ...record,
    profile: nextProfile,
    updated_at: new Date().toISOString(),
  };
  await env.SMARTSLEEVE_AUTH.put(`account:${session.emailHash}`, JSON.stringify(nextRecord));
  return jsonResponse(request, env, { ok: true, status: "profile_updated", profile: publicProfile(nextRecord, env) });
}

async function logout(request, env) {
  if (env.SMARTSLEEVE_AUTH) {
    const token = parseCookies(request)[SESSION_COOKIE] || bearerToken(request);
    if (token) {
      await env.SMARTSLEEVE_AUTH.delete(`session:${await sha256Hex(token)}`);
    }
  }
  return jsonWithCookie(request, env, { ok: true, status: "logged_out" }, sessionCookie("", 0));
}

function passwordResetRequestedResponse(request, env) {
  return jsonResponse(request, env, {
    ok: true,
    status: "password_reset_requested",
    message: "If that username belongs to a verified account, a reset email will arrive shortly.",
  });
}

async function requestPasswordReset(request, env) {
  if (!env.SMARTSLEEVE_AUTH) {
    return jsonResponse(request, env, { ok: false, error: "auth_storage_not_configured" }, 503);
  }
  let payload = {};
  try {
    payload = await request.json();
  } catch (_err) {
    return jsonResponse(request, env, { ok: false, error: "invalid_json" }, 400);
  }

  const username = normalizeUsername(payload.username || payload.identity);
  if (!username) {
    return jsonResponse(request, env, { ok: false, error: "username_required" }, 400);
  }
  const usernameHash = await sha256Hex(username);
  if (!(await enforcePasswordResetRateLimit(request, env, usernameHash))) {
    return passwordResetRequestedResponse(request, env);
  }

  const account = await lookupVerifiedAccount(env, username);
  if (!account) {
    return passwordResetRequestedResponse(request, env);
  }

  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const resetKey = `password-reset:${tokenHash}`;
  const currentKey = `password-reset-current:${account.emailHash}`;
  const previousResetKey = String((await env.SMARTSLEEVE_AUTH.get(currentKey)) || "");
  if (previousResetKey) {
    await env.SMARTSLEEVE_AUTH.delete(previousResetKey);
  }
  await env.SMARTSLEEVE_AUTH.put(
    resetKey,
    JSON.stringify({ email_hash: account.emailHash, username, created_at: new Date().toISOString() }),
    { expirationTtl: PASSWORD_RESET_TTL_SECONDS }
  );
  await env.SMARTSLEEVE_AUTH.put(currentKey, resetKey, { expirationTtl: PASSWORD_RESET_TTL_SECONDS });

  try {
    await sendPasswordResetEmail(env, account.record.profile || {}, passwordResetUrl(env, token), tokenHash);
  } catch (err) {
    await env.SMARTSLEEVE_AUTH.delete(resetKey);
    await env.SMARTSLEEVE_AUTH.delete(currentKey);
    console.error(JSON.stringify({ event: "password_reset_email_failed", error: String(err && err.message || err).slice(0, 240) }));
  }
  return passwordResetRequestedResponse(request, env);
}

async function confirmPasswordReset(request, env) {
  if (!env.SMARTSLEEVE_AUTH) {
    return jsonResponse(request, env, { ok: false, error: "auth_storage_not_configured" }, 503);
  }
  let payload = {};
  try {
    payload = await request.json();
  } catch (_err) {
    return jsonResponse(request, env, { ok: false, error: "invalid_json" }, 400);
  }

  const token = String(payload.token || "");
  const password = String(payload.password || "");
  if (!token) {
    return jsonResponse(request, env, { ok: false, error: "password_reset_token_required" }, 400);
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return jsonResponse(request, env, { ok: false, error: "password_must_be_at_least_12_characters" }, 400);
  }
  if (password !== String(payload.password_confirm || "")) {
    return jsonResponse(request, env, { ok: false, error: "password_confirmation_mismatch" }, 400);
  }

  const tokenHash = await sha256Hex(token);
  const resetKey = `password-reset:${tokenHash}`;
  const pointer = JSON.parse((await env.SMARTSLEEVE_AUTH.get(resetKey)) || "null");
  if (!pointer || !pointer.email_hash) {
    return jsonResponse(request, env, { ok: false, error: "password_reset_link_expired_or_invalid" }, 400);
  }
  const currentKey = `password-reset-current:${pointer.email_hash}`;
  if (String((await env.SMARTSLEEVE_AUTH.get(currentKey)) || "") !== resetKey) {
    await env.SMARTSLEEVE_AUTH.delete(resetKey);
    return jsonResponse(request, env, { ok: false, error: "password_reset_link_expired_or_invalid" }, 400);
  }
  const accountKey = `account:${pointer.email_hash}`;
  const record = JSON.parse((await env.SMARTSLEEVE_AUTH.get(accountKey)) || "null");
  if (!record || record.status !== "email_verified") {
    await env.SMARTSLEEVE_AUTH.delete(resetKey);
    await env.SMARTSLEEVE_AUTH.delete(currentKey);
    return jsonResponse(request, env, { ok: false, error: "password_reset_link_expired_or_invalid" }, 400);
  }

  const salt = randomToken(18);
  const nextRecord = {
    ...record,
    schema_version: 2,
    session_epoch: Number(record.session_epoch || 0) + 1,
    updated_at: new Date().toISOString(),
    password: {
      algorithm: "PBKDF2-SHA256",
      iterations: PBKDF2_ITERATIONS,
      salt,
      hash: await hashPassword(password, salt),
    },
  };
  await env.SMARTSLEEVE_AUTH.put(accountKey, JSON.stringify(nextRecord));
  await env.SMARTSLEEVE_AUTH.delete(resetKey);
  await env.SMARTSLEEVE_AUTH.delete(currentKey);
  return jsonResponse(request, env, { ok: true, status: "password_reset_complete" });
}

async function verifyToken(request, env, token) {
  if (!env.SMARTSLEEVE_AUTH) {
    return { ok: false, error: "auth_storage_not_configured", status: 503 };
  }
  if (!token) {
    return { ok: false, error: "verification_token_required", status: 400 };
  }
  const tokenHash = await sha256Hex(token);
  const verifyKey = `verify:${tokenHash}`;
  const pointer = JSON.parse((await env.SMARTSLEEVE_AUTH.get(verifyKey)) || "null");
  if (!pointer || !pointer.pending_key) {
    return { ok: false, error: "verification_link_expired_or_invalid", status: 400 };
  }
  const pending = JSON.parse((await env.SMARTSLEEVE_AUTH.get(pointer.pending_key)) || "null");
  if (!pending || pending.email_hash !== pointer.email_hash) {
    await env.SMARTSLEEVE_AUTH.delete(verifyKey);
    return { ok: false, error: "pending_account_expired_or_invalid", status: 400 };
  }

  const username = normalizeUsername(pending.profile && pending.profile.username);
  const usernameKey = usernameIndexKey(username);
  const usernameOwner = String((await env.SMARTSLEEVE_AUTH.get(usernameKey)) || "");
  if (!username || (usernameOwner && usernameOwner !== pointer.email_hash)) {
    await env.SMARTSLEEVE_AUTH.delete(verifyKey);
    await env.SMARTSLEEVE_AUTH.delete(pointer.pending_key);
    if (username) await env.SMARTSLEEVE_AUTH.delete(`pending:username:${username}`);
    return { ok: false, error: "username_unavailable", status: 409 };
  }

  const verified = {
    ...pending,
    schema_version: 2,
    status: "email_verified",
    verified_at: new Date().toISOString(),
  };
  delete verified.verify_key;
  await env.SMARTSLEEVE_AUTH.put(`account:${pointer.email_hash}`, JSON.stringify(verified));
  await env.SMARTSLEEVE_AUTH.put(usernameKey, pointer.email_hash);
  await env.SMARTSLEEVE_AUTH.delete(verifyKey);
  await env.SMARTSLEEVE_AUTH.delete(pointer.pending_key);
  await env.SMARTSLEEVE_AUTH.delete(`pending:username:${username}`);
  return { ok: true, status: 200, profile: pending.profile };
}

function verifiedHtml(result, env) {
  const success = result.ok;
  const title = success ? "Email verified" : "Verification failed";
  const detail = success
    ? "Your SmartSleeve account email is verified. You can return to the console."
    : "This verification link is invalid or expired. Please register again from the SmartSleeve console.";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SmartSleeve - ${escapeHtml(title)}</title>
  <style>
    body { margin:0; min-height:100vh; display:grid; place-items:center; background:#020617; color:#f8fafc; font-family:Inter,Arial,sans-serif; }
    main { width:min(680px, calc(100vw - 32px)); border:1px solid rgba(57,255,20,.32); border-radius:24px; padding:28px; background:#07111f; box-shadow:0 24px 80px rgba(0,0,0,.45); }
    p.kicker { color:#39ff14; font-size:12px; font-weight:900; letter-spacing:.14em; text-transform:uppercase; }
    a { display:inline-block; margin-top:16px; padding:12px 16px; border-radius:14px; color:#04110a; background:#39ff14; font-weight:900; text-decoration:none; }
  </style>
</head>
<body>
  <main>
    <p class="kicker">SmartSleeve Account</p>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(detail)}</p>
    <a href="${escapeHtml(appUrl(env))}">Return to console</a>
  </main>
</body>
</html>`;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(request, env) });
    }

    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return jsonResponse(request, env, {
        ok: true,
        service: "smartsleeve-auth",
        storage_configured: Boolean(env.SMARTSLEEVE_AUTH),
        resend_configured: Boolean(env.RESEND_API_KEY),
        sessions_supported: true,
        profile_supported: true,
        platform_access_supported: true,
        username_login_supported: true,
        password_reset_supported: true,
      });
    }
    if (url.pathname === "/register" && request.method === "POST") {
      return register(request, env);
    }
    if (url.pathname === "/login" && request.method === "POST") {
      return login(request, env);
    }
    if (url.pathname === "/me" && request.method === "GET") {
      return me(request, env);
    }
    if (url.pathname === "/profile" && request.method === "POST") {
      return updateProfile(request, env);
    }
    if (url.pathname === "/logout" && request.method === "POST") {
      return logout(request, env);
    }
    if (url.pathname === "/password-reset/request" && request.method === "POST") {
      return requestPasswordReset(request, env);
    }
    if (url.pathname === "/password-reset/confirm" && request.method === "POST") {
      return confirmPasswordReset(request, env);
    }
    if (url.pathname === "/verify" && request.method === "POST") {
      let payload = {};
      try {
        payload = await request.json();
      } catch (_err) {
        return jsonResponse(request, env, { ok: false, error: "invalid_json" }, 400);
      }
      const result = await verifyToken(request, env, String(payload.token || ""));
      return jsonResponse(request, env, result, result.status || (result.ok ? 200 : 400));
    }
    if (url.pathname === "/verify" && request.method === "GET") {
      const result = await verifyToken(request, env, url.searchParams.get("token") || "");
      return htmlResponse(verifiedHtml(result, env), result.status || (result.ok ? 200 : 400));
    }

    return jsonResponse(request, env, { ok: false, error: "not_found" }, 404);
  },
};

export { passwordResetEmailHtml, verificationEmailHtml };
