import assert from "node:assert/strict";
import test from "node:test";

import worker from "./cloudflare_worker.js";


class MemoryKV {
  constructor() {
    this.values = new Map();
  }

  async get(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  async put(key, value) {
    this.values.set(key, String(value));
  }

  async delete(key) {
    this.values.delete(key);
  }

  async list(options = {}) {
    const prefix = String(options.prefix || "");
    return {
      keys: [...this.values.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({name})),
      list_complete: true,
    };
  }
}

class MemoryR2 {
  constructor() {
    this.values = new Map();
  }

  async put(key, value) {
    this.values.set(key, String(value));
  }

  async get(key) {
    if (!this.values.has(key)) return null;
    const value = this.values.get(key);
    return {text: async () => value};
  }
}

function apiRequest(path, body, method = "POST", token = "") {
  const headers = {"Content-Type": "application/json", "Origin": "https://smartsleeve.ai"};
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request(`https://auth.example.test${path}`, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  });
}

async function json(response) {
  return response.json();
}

function callWorker(worker, env, path, body, method = "POST", token = "") {
  return worker.fetch(apiRequest(path, body, method, token), env);
}

test("register, verify, username login, profile, and password reset", async () => {
  const emails = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    emails.push(JSON.parse(options.body));
    return Response.json({id: `email-${emails.length}`});
  };

  const env = {
    SMARTSLEEVE_AUTH: new MemoryKV(),
    RESEND_API_KEY: "test-key",
    SMARTSLEEVE_AUTH_VERIFY_URL: "https://smartsleeve.ai/verify.html",
    SMARTSLEEVE_AUTH_RESET_URL: "https://smartsleeve.ai/reset-password.html",
    SMARTSLEEVE_DEVELOPER_EMAILS: "",
    SMARTSLEEVE_PLATFORM_ACCESS_EMAILS: "",
  };

  try {
    const registration = await callWorker(worker, env, "/register", {
      username: "new.user",
      email: "new.user@example.com",
      first_name: "New",
      middle_name: "Example",
      last_name: "User",
      phone: "+1 (773) 530-8525",
      shipping_address: {
        line1: "123 Market Street",
        city: "Chicago",
        state: "IL",
        postal_code: "60601",
        country: "US",
      },
      password: "correct horse battery staple",
      password_confirm: "correct horse battery staple",
      accepted_terms: true,
    });
    assert.equal(registration.status, 200);
    assert.equal((await json(registration)).status, "verification_email_sent");
    assert.equal(emails.length, 1);
    assert.match(emails[0].from, /SmartSleeve Accounts <accounts@smartsleeve\.ai>/);
    assert.match(emails[0].html, /sqts-logo-llc-v5\.png/);
    assert.match(emails[0].html, /©|&copy;/);
    assert.doesNotMatch(emails[0].html, /financial advice/i);

    const verificationToken = new URL(emails[0].html.match(/href="([^"]+verify\.html[^"]+)"/)[1].replace(/&amp;/g, "&")).searchParams.get("token");
    const verification = await callWorker(worker, env, "/verify", {token: verificationToken});
    assert.equal(verification.status, 200);

    const login = await callWorker(worker, env, "/login", {identity: "new.user", password: "correct horse battery staple"});
    assert.equal(login.status, 200);
    const loginBody = await json(login);
    assert.equal(loginBody.profile.username, "new.user");
    assert.equal(loginBody.profile.middle_name, "Example");
    assert.equal(loginBody.profile.phone, "+17735308525");
    assert.equal(loginBody.profile.shipping_address.city, "Chicago");
    assert.equal(loginBody.profile.platform_access, false);

    const resetRequest = await callWorker(worker, env, "/password-reset/request", {username: "new.user"});
    assert.equal(resetRequest.status, 200);
    assert.equal(emails.length, 2);
    assert.match(emails[1].from, /SmartSleeve Accounts <accounts@smartsleeve\.ai>/);
    const resetToken = new URL(emails[1].html.match(/href="([^"]+reset-password\.html[^"]+)"/)[1].replace(/&amp;/g, "&")).searchParams.get("token");

    const reset = await callWorker(worker, env, "/password-reset/confirm", {
      token: resetToken,
      password: "a newer correct horse battery staple",
      password_confirm: "a newer correct horse battery staple",
    });
    assert.equal(reset.status, 200);

    const expiredSession = await callWorker(worker, env, "/me", null, "GET", loginBody.session_token);
    assert.equal(expiredSession.status, 401);
    const oldPassword = await callWorker(worker, env, "/login", {identity: "new.user", password: "correct horse battery staple"});
    assert.equal(oldPassword.status, 401);
    const newPassword = await callWorker(worker, env, "/login", {identity: "new.user", password: "a newer correct horse battery staple"});
    assert.equal(newPassword.status, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("registration rejects duplicate usernames and incomplete optional addresses", async () => {
  const env = {SMARTSLEEVE_AUTH: new MemoryKV(), RESEND_API_KEY: "test-key"};
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({id: "email"});
  try {
    const base = {
      username: "reserved.user",
      email: "first@example.com",
      first_name: "First",
      last_name: "User",
      password: "correct horse battery staple",
      password_confirm: "correct horse battery staple",
      accepted_terms: true,
    };
    assert.equal((await callWorker(worker, env, "/register", base)).status, 200);
    assert.equal((await callWorker(worker, env, "/register", {...base, email: "second@example.com"})).status, 409);
    const incomplete = await callWorker(worker, env, "/register", {
      ...base,
      username: "another.user",
      email: "another@example.com",
      shipping_address: {line1: "123 Market Street"},
    });
    assert.equal(incomplete.status, 400);
    assert.match(JSON.stringify(await json(incomplete)), /shipping_address_must_be_complete_or_empty/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("special offer unlock, Retirement Sage enrollment, and app feed coexist", async () => {
  const emails = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    emails.push(JSON.parse(options.body));
    return Response.json({id: `email-${emails.length}`});
  };
  const env = {
    SMARTSLEEVE_AUTH: new MemoryKV(),
    APP_FEED_BUCKET: new MemoryR2(),
    RESEND_API_KEY: "test-key",
    SMARTSLEEVE_ADMIN_TOKEN: "test-admin-token",
    SMARTSLEEVE_SPECIAL_OFFER_CODES: JSON.stringify({TESTCODE: "cedars_sinai_voya"}),
    SMARTSLEEVE_AUTH_VERIFY_URL: "https://smartsleeve.ai/verify.html",
    SMARTSLEEVE_DEVELOPER_EMAILS: "",
    SMARTSLEEVE_PLATFORM_ACCESS_EMAILS: "",
  };
  try {
    const registration = await callWorker(worker, env, "/register", {
      username: "offer.user",
      email: "offer.user@example.com",
      first_name: "Offer",
      last_name: "User",
      password: "correct horse battery staple",
      password_confirm: "correct horse battery staple",
      accepted_terms: true,
    });
    assert.equal(registration.status, 200);
    const verificationToken = new URL(emails[0].html.match(/href="([^"]+verify\.html[^"]+)"/)[1].replace(/&amp;/g, "&")).searchParams.get("token");
    assert.equal((await callWorker(worker, env, "/verify", {token: verificationToken})).status, 200);
    const login = await callWorker(worker, env, "/login", {identity: "offer.user", password: "correct horse battery staple"});
    const loginBody = await json(login);

    const invalid = await callWorker(worker, env, "/special-offers/redeem", {code: "WRONG"}, "POST", loginBody.session_token);
    assert.equal(invalid.status, 400);
    assert.equal((await callWorker(worker, env, "/special-offers/cedars-voya/content", null, "GET", loginBody.session_token)).status, 403);
    const redeemed = await callWorker(worker, env, "/special-offers/redeem", {code: "testcode"}, "POST", loginBody.session_token);
    assert.deepEqual((await json(redeemed)).profile.special_offers, ["cedars_sinai_voya"]);
    await env.APP_FEED_BUCKET.put("special_offers/cedars_voya_retirement_sage_prospectus.html", "<main>Prospectus</main>");
    const prospectus = await callWorker(worker, env, "/special-offers/cedars-voya/content", null, "GET", loginBody.session_token);
    assert.equal(prospectus.status, 200);
    assert.equal(await prospectus.text(), "<main>Prospectus</main>");

    const noConsent = await callWorker(worker, env, "/retirement-sage/enrollment", {action: "enroll"}, "POST", loginBody.session_token);
    assert.equal(noConsent.status, 400);
    const enrolled = await callWorker(worker, env, "/retirement-sage/enrollment", {action: "enroll", consent: true}, "POST", loginBody.session_token);
    const enrolledBody = await json(enrolled);
    assert.equal(enrolledBody.profile.retirement_sage_enrollment.status, "active");
    assert.equal(emails.length, 2);

    await env.APP_FEED_BUCKET.put("app_feed/latest.json", JSON.stringify({accounts: [], reports: []}));
    const feed = await callWorker(worker, env, "/api/app-feed", null, "GET", loginBody.session_token);
    assert.equal(feed.status, 200);
    assert.deepEqual((await json(feed)).feed.accounts, []);

    assert.equal((await callWorker(worker, env, "/admin/retirement-sage-enrollees", null, "GET")).status, 403);
    const activeExport = await callWorker(worker, env, "/admin/retirement-sage-enrollees", null, "GET", "test-admin-token");
    assert.equal((await json(activeExport)).enrollees[0].status, "active");

    const canceled = await callWorker(worker, env, "/retirement-sage/enrollment", {action: "cancel"}, "POST", loginBody.session_token);
    assert.equal((await json(canceled)).profile.retirement_sage_enrollment.status, "canceled");
    assert.equal(emails.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
