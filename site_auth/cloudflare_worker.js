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
//
// Routes:
//   POST /register
//   POST /login
//   GET  /me
//   POST /profile
//   POST /logout
//   GET  /verify?token=...
//   POST /verify
//   GET  /health

const DEFAULT_SITE = "https://smartsleeve.ai";
const DEFAULT_FROM_EMAIL = "SmartSleeve <analytics@smartsleeve.ai>";
const DEFAULT_REPLY_TO = "John Sheppard <john@smartsleeve.ai>";
const PENDING_TTL_SECONDS = 60 * 60 * 24;
const RATE_LIMIT_TTL_SECONDS = 60 * 10;
const MAX_REGISTRATIONS_PER_WINDOW = 6;
const MAX_LOGINS_PER_WINDOW = 12;
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
    phone: normalizeAddressLine(source.phone, 32),
  };
}

function hasShippingAddress(address) {
  return Boolean(address && address.line1 && address.city && address.state && address.postal_code && address.country);
}

function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 48);
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

function appUrl(env) {
  return String(env.SMARTSLEEVE_AUTH_APP_URL || `${DEFAULT_SITE}/app/`).replace(/\/?$/, "/");
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
    last_name: profile.last_name || "",
    nickname: profile.nickname || "",
    display_name: [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim() || profile.nickname || profile.username || profile.email || "",
    shipping_address: hasShippingAddress(shipping) ? shipping : null,
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

function verificationEmailHtml(profile, verifyUrl) {
  const name = profile.nickname || profile.first_name || "there";
  return `<!doctype html>
<html>
  <body style="margin:0; padding:0; background:#020617; color:#f8fafc; font-family:Inter,Arial,sans-serif;">
    <div style="max-width:640px; margin:0 auto; padding:28px;">
      <div style="border:1px solid rgba(57,255,20,.32); border-radius:22px; padding:24px; background:#07111f;">
        <p style="margin:0 0 8px; color:#39ff14; font-size:12px; font-weight:800; letter-spacing:.12em; text-transform:uppercase;">SmartSleeve Account Verification</p>
        <h1 style="margin:0 0 14px; color:#fff;">Confirm your email</h1>
        <p style="line-height:1.55; color:#cbd5e1;">Good news, ${escapeHtml(name)}. Your SmartSleeve account request is ready for email verification.</p>
        <p style="line-height:1.55; color:#cbd5e1;">Click the button below to verify this email address. The link expires in 24 hours.</p>
        <p style="margin:26px 0;">
          <a href="${verifyUrl}" style="display:inline-block; padding:13px 18px; border-radius:14px; color:#04110a; background:#39ff14; font-weight:900; text-decoration:none;">Verify email</a>
        </p>
        <p style="line-height:1.55; color:#94a3b8; font-size:13px;">If you did not request a SmartSleeve account, you can ignore this email.</p>
      </div>
    </div>
  </body>
</html>`;
}

function verificationEmailText(profile, verifyUrl) {
  const name = profile.nickname || profile.first_name || "there";
  return [
    `Hi ${name},`,
    "",
    "Your SmartSleeve account request is ready for email verification.",
    `Verify your email here: ${verifyUrl}`,
    "",
    "This link expires in 24 hours. If you did not request this, ignore this email.",
  ].join("\n");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sendVerificationEmail(env, profile, verifyUrl) {
  if (!env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not configured");
  }
  const payload = {
    from: env.SMARTSLEEVE_AUTH_FROM_EMAIL || DEFAULT_FROM_EMAIL,
    to: [profile.email],
    reply_to: env.SMARTSLEEVE_AUTH_REPLY_TO_EMAIL || DEFAULT_REPLY_TO,
    subject: "Verify your SmartSleeve account",
    html: verificationEmailHtml(profile, verifyUrl),
    text: verificationEmailText(profile, verifyUrl),
  };
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend email failed: HTTP ${response.status} ${body.slice(0, 240)}`);
  }
  return response.json();
}

function collectProfile(payload) {
  const email = normalizeEmail(payload.email);
  const username = normalizeUsername(payload.username);
  return {
    username,
    email,
    first_name: normalizeName(payload.first_name),
    middle_name: normalizeName(payload.middle_name),
    last_name: normalizeName(payload.last_name),
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
  if (!profile.username || profile.username.length < 3) {
    errors.push("username_must_be_at_least_3_characters");
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
    return jsonResponse(request, env, { ok: false, error: "account_already_verified" }, 409);
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
  const record = {
    schema_version: 1,
    status: "pending_email_verification",
    created_at: now,
    updated_at: now,
    expires_at: new Date(Date.now() + PENDING_TTL_SECONDS * 1000).toISOString(),
    email_hash: emailHash,
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

  const verifyUrl = `${new URL(request.url).origin}/verify?token=${encodeURIComponent(token)}`;
  try {
    const emailStatus = await sendVerificationEmail(env, profile, verifyUrl);
    return jsonResponse(request, env, {
      ok: true,
      status: "verification_email_sent",
      email_id: emailStatus.id || null,
      message: "Check your inbox for a SmartSleeve verification email.",
    });
  } catch (err) {
    await env.SMARTSLEEVE_AUTH.delete(verifyKey);
    await env.SMARTSLEEVE_AUTH.delete(pendingKey);
    return jsonResponse(request, env, { ok: false, error: "verification_email_failed" }, 502);
  }
}

async function lookupVerifiedAccount(env, identity) {
  const normalized = normalizeEmail(identity);
  let emailHash = "";
  if (isValidEmail(normalized)) {
    emailHash = await sha256Hex(normalized);
  } else {
    const username = normalizeUsername(identity);
    emailHash = String((await env.SMARTSLEEVE_AUTH.get(`profile:username:${username}`)) || "");
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
    return jsonResponse(request, env, { ok: false, error: "identity_and_password_required" }, 400);
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
    last_name: normalizeName(payload.last_name != null ? payload.last_name : current.last_name),
    nickname: normalizeName(payload.nickname != null ? payload.nickname : current.nickname, 40),
  };
  if (payload.shipping_address !== undefined) {
    const shipping = collectShippingAddress(payload.shipping_address);
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

  const verified = {
    ...pending,
    status: "email_verified",
    verified_at: new Date().toISOString(),
  };
  delete verified.verify_key;
  await env.SMARTSLEEVE_AUTH.put(`account:${pointer.email_hash}`, JSON.stringify(verified));
  await env.SMARTSLEEVE_AUTH.put(`profile:username:${pending.profile.username}`, pointer.email_hash);
  await env.SMARTSLEEVE_AUTH.delete(verifyKey);
  await env.SMARTSLEEVE_AUTH.delete(pointer.pending_key);
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
