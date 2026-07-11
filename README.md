# SmartSleeve Static Site

This folder contains the public placeholder site for `smartsleeve.ai` plus a
private static product-console prototype under `/app/`.

The public pages are intentionally minimal: a dark SQTS-themed background,
a SmartSleeve hero mark, sparse About and Contact pages, and a prominent
"Coming soon..." message. They do not expose trading internals, performance
claims, account details, broker integration status, or the operating plan.

The `/app/` prototype is a static-first UI for account onboarding, plans,
funding, sleeve limits, trading behaviors, Custom Sage universe selection,
portfolio transfer flows, daemon controls, and support pages. It can call the
optional SmartSleeve Auth Worker for email-verified account registration, but it
must not be treated as a secure broker, bank, payment, or trading-control
collector until those dedicated backends exist.

Suggested deployment targets:

- DigitalOcean Spaces/CDN as a static object if DNS is pointed there.
- The DigitalOcean droplet via nginx if `smartsleeve.ai` points at the server.

## Privacy-Friendly Website Analytics

The page includes a dormant first-party analytics beacon. It sends one minimal
pageview event only when the deployed HTML has a collector endpoint injected.
The beacon records:

- site name
- path
- referrer
- browser-generated anonymous visitor id
- timestamp

It does **not** send names, emails, IP addresses, portfolio data, or account
details.

Recommended free/cheap setup:

1. Create a free Cloudflare Worker.
2. Create a Cloudflare KV namespace, for example `SQTS_SITE_ANALYTICS`.
3. Bind that namespace to the Worker as `SQTS_SITE_ANALYTICS`.
4. Add a Worker secret named `SQTS_SITE_ANALYTICS_READ_TOKEN`.
5. Paste `site_analytics/cloudflare_worker.js` into the Worker.
6. Deploy the Worker and copy its `/collect` URL, for example
   `https://smartsleeve-analytics.<account>.workers.dev/collect`.
7. In GitHub repo variables, set:
   - `SITE_ANALYTICS_ENDPOINT` to the `/collect` URL.
8. In GitHub repo secrets, set:
   - `SITE_ANALYTICS_READ_TOKEN` to the same Worker read token.
9. Re-run the `SQTS static site` workflow to inject the endpoint and deploy the
   page.
10. Run `SmartSleeve site traffic report` manually with `send_email=true` to
    send a test email.

The daily website traffic report workflow is scheduled in
`.github/workflows/site-traffic-report.yml`. It uses the same Resend email
configuration as the SQTS daily portfolio report.

Report and stock-pick email renderers should keep audience boundaries explicit:
user-facing emails and app report cards should not describe degraded LLM
fallbacks, quota errors, stack traces, or internal failure details. Developer
reports may include concise generation diagnostics, but should prioritize the
model used, or state that no LLM was used.

## Website Accounts

The console can send account registration requests to a Cloudflare Worker when
deployed with:

- GitHub repo variable `SMARTSLEEVE_AUTH_ENDPOINT`, for example
  `https://auth.smartsleeve.ai`

The Worker implementation lives in `site_auth/cloudflare_worker.js`. It requires
a Cloudflare KV binding named `SMARTSLEEVE_AUTH` and a `RESEND_API_KEY` Worker
secret. Transactional mail is sent by
`SmartSleeve Accounts <accounts@smartsleeve.ai>`.

New general website accounts use a distinct username and password. The verified
email address is used for activation and recovery, not as the normal login
identity. Registration stores first, optional middle, and last names plus an
optional phone number and complete-or-empty shipping address. Passwords are
salted and hashed; raw passwords and action tokens are never stored. Public
account routes are:

- `POST /register`
- `POST /verify`
- `POST /login`
- `GET /me`
- `POST /profile`
- `POST /logout`
- `POST /password-reset/request`
- `POST /password-reset/confirm`

Verification links expire after 24 hours. Password-reset links expire after one
hour, are single-use, supersede older reset links, and invalidate all sessions
created before the password change. Recovery requests always return the same
public response so they do not disclose whether a username exists.

The public pages and `/app/` load `site-auth.js` plus `site-auth.css`, which
expose a shared `window.SmartSleeveAuth` identity state. The merch cart can use
that profile to prefill email/name/shipping into Stripe Checkout while Stripe
continues to own card collection and payment-method storage.

Verified SmartSleeve accounts are website-wide by default: they can manage a
profile and use merch checkout, but they do not automatically unlock the
investment Portal. Portal access is returned as `profile.platform_access` by
the auth Worker and is enabled separately through
`SMARTSLEEVE_PLATFORM_ACCESS_EMAILS`, `SMARTSLEEVE_DEVELOPER_EMAILS`, or a
trusted KV profile update. The `/app/` Portal consumes the same global session
and shows an access-pending state instead of asking for a second login.

Existing verified accounts are intentionally migrated to email-address
usernames while preserving password hashes and Portal/developer access. Preview
the remote migration first, then apply it after deploying the matching Worker:

```sh
node site_auth/migrate_existing_usernames.mjs
node site_auth/migrate_existing_usernames.mjs --apply
```

The migration does not write account records to local files and restores the
current account record if one of its remote updates fails. Because Cloudflare KV
is eventually consistent, allow propagation time before diagnosing a newly
changed username or profile from another region.

Run the Worker lifecycle tests with:

```sh
cd site_auth
npm test
```
