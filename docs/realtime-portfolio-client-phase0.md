# Realtime portfolio clients: Phase 0 inventory and integration plan

Status: web routing fix and shared feed-layer refactor complete locally; realtime wiring blocked on the published client protocol and platform-repo coordination.

## Repository boundary

- `smartsleeve-site` is the deployed `smartsleeve.ai` GitHub Pages repository and owns the web client under `app/`.
- The adjacent `platform` repository owns collectors, Workers, scripts, `mobile/`, and `desktop/`.
- `platform/site/` is a stale mirror, not the deployed website.
- During this inventory the platform worktree was already on the backend realtime branch with uncommitted backend-design work. No platform file was changed by this client Phase 0 work.

## Client inventory

### Web portal (`smartsleeve-site/app/`)

Framework and rendering:

- Static `index.html` plus vanilla JavaScript and CSS.
- `app/app.js` owns portfolio state, account normalization, cross-account aggregation, and DOM rendering.
- `applyFeed()` scopes and normalizes accounts, rebuilds aggregate holdings/history/trades/reports, then calls `renderAll()`.

Authentication:

- `app/index.html` configures the Auth Worker with the `smartsleeve-auth-endpoint` meta tag.
- `site-auth.js` owns the website session, calls `/me`, and exposes `window.SmartSleeveAuth`.
- Requests use the Auth Worker's secure cookie and, when present, the stored session token as `Authorization: Bearer ...`.
- The portfolio client requires `profile.platform_access` (or developer role) before requesting data.

Portfolio data:

- `GET <auth-worker>/api/app-feed?ts=...` is the authoritative current source.
- The Auth Worker reads `app_feed/latest.json` from R2 and returns an account-scoped feed.
- The app polls every 300 seconds, supports manual/pull refresh, preserves the last good payload on refresh failure, and displays an auth/feed gate if no good payload exists.
- Before this Phase 0 change, fetching and rendering were joined directly in `loadFeed()`.
- `app/portfolio-data.js` now provides a source-neutral boundary: `poll()` adapts the existing REST feed, while `ingest()` can accept an already-normalized snapshot from a later protocol adapter. It deliberately contains no WebSocket schema, ticket flow, sequence rule, or freshness policy.

### iOS (`platform/mobile/ios`)

Framework and rendering:

- Native SwiftUI shell with `WKWebView` in `ContentView.swift`.
- It renders `https://smartsleeve.ai/app/` with edition, account scope, principal email, and start-section URL parameters.
- There is no native portfolio model, REST request, WebSocket, or holdings renderer. Portfolio data and UI are entirely the hosted web client.

Authentication:

- The native screen allows configured emails and provides local device unlock. For the user edition, its password check only verifies minimum length; it is not server authentication.
- The real portfolio authorization is the hosted web app's Auth Worker session inside the persistent `WKWebsiteDataStore`.
- No broker credential is stored in the app.

### Android (`platform/mobile/android`)

Framework and rendering:

- Native Java `Activity` with Android `WebView` in `MainActivity.java`.
- There is no native portfolio model, REST request, WebSocket, or holdings renderer. Portfolio data and UI are entirely the loaded web client.

Authentication:

- There is no native login. DOM storage is enabled and the loaded web app owns the Auth Worker session.
- No broker credential is stored in the app.

Deployment divergence:

- The base resource points to `https://smartsleeve.ai/app/`, but both current product-flavor resource overrides point to `https://sqts-assets.sfo2.cdn.digitaloceanspaces.com/app/` with hard-coded edition/scope/principal parameters.
- Consequently, built user and developer APKs use the legacy CDN app, not the deployed site repository. Android must be moved to the canonical site URL or given an explicit, committed artifact-sync process before realtime rollout.

### Desktop (`platform/desktop/smartsleeve-command`)

Framework and rendering:

- Electron shell (`main.js` and `preload.js`) loading `https://smartsleeve.ai/app/`.
- Node integration is disabled; context isolation and the renderer sandbox are enabled.
- There is no desktop portfolio model, REST request, WebSocket, or holdings renderer. Portfolio data and UI are entirely the hosted web client.

Authentication:

- There is no native login or credential storage. The Electron renderer uses the hosted website's Auth Worker session.

## Deployed `/app/#dashboard` merch bug

Reproduction:

1. Load `/app/#dashboard`.
2. Navigate to `/app/#shop` in the same document.
3. Use browser Back.
4. The URL becomes `#dashboard`, but the merch surface remains rendered.

Root cause:

- `merch.js` added `body.public-shop` and activated the shop panel but never reversed that state on a non-shop hash.
- `app.js` handled clicks but did not listen for `hashchange`, so browser Back/Forward did not re-run the portfolio router.
- The URL and DOM therefore disagreed; this was a client routing/state bug, not a build artifact selecting the wrong `index.html`.

Fix:

- The portfolio router now re-synchronizes on `hashchange` and `pageshow`, clears `public-shop`, and runs once at startup.
- The merch router now has a symmetric exit path and also re-synchronizes on `hashchange` and `pageshow`.
- Asset versions in `app/index.html` were advanced so the deployed page does not reuse the affected JavaScript from cache.

Verification:

- The deployed bug was reproduced in the browser before editing.
- The same dashboard -> shop -> browser Back sequence was run against the local fixed site.
- After Back, the URL was `#dashboard`, `body.public-shop` was absent, dashboard was the only active panel, shop was hidden, and the document title was restored to `SmartSleeve Portfolio OS`.

## Protocol gate

`platform/docs/realtime_portfolio_freshness_design.md` currently describes the architecture and an illustrative account slice, but its status is proposed and it is not a complete published client-facing protocol. Client WebSocket wiring must wait for the backend owner to publish at least:

- ticket endpoint, method, request/response schema, expiry/error behavior, and how the one-use ticket is presented during upgrade;
- WebSocket URL and any required subprotocol;
- protocol/schema version and complete message-type definitions;
- initial snapshot, account-slice update, connection/error, and heartbeat semantics;
- account ID, `sourceEpoch`, and `sequence` reset/resume/rollback rules;
- reconnect/resume behavior and whether a client supplies its last accepted sequence map;
- authoritative timestamp formats and freshness-state thresholds;
- `valueMethod`/derived-value vocabulary and null/missing-field behavior;
- feature-flag source and production/shadow endpoint selection.

No client implementation should infer these details from the illustrative JSON.

## Realtime integration plan after protocol publication

### 1. Web first

1. Add a protocol adapter next to `portfolio-data.js`, behind the backend-defined feature flag.
2. Boot from the existing authenticated `/api/app-feed` poll and render immediately.
3. Mint a short-lived connection ticket through the existing authenticated request helper, then connect to the specified WebSocket endpoint.
4. Validate the published schema version and message type before passing data to the app data layer.
5. Maintain the latest accepted `{sourceEpoch, sequence}` per account. Apply only updates permitted by the published snapshot/reset semantics and never roll an account backward.
6. Replace only the changed account slice, then run the existing normalization/aggregation/render path. Do not rebuild protocol semantics inside render functions.
7. Keep the five-minute poll active as fallback. On socket failure, retain the last good state, surface connection/fallback state, and reconnect according to the published backoff rules.
8. Pause/reconnect cleanly across `visibilitychange`, `online`/`offline`, and `pageshow` so WebView background suspension does not produce a false live state.

### 2. Freshness UI

- Show socket state separately from data freshness; a connected socket does not make an old account live.
- Show separate `positionsAsOf`, `cashAsOf`, `priceAsOf`, and `brokerEquityAsOf` states at account level and wherever a field could otherwise be misleading.
- Label marked equity derived from streaming prices as derived/marked, without advancing the positions or cash clocks.
- Preserve broker equity as its own field and clock rather than silently replacing it with marked equity.
- Use the backend-published thresholds/vocabulary for live, delayed, stale, derived-value, and fallback.
- Keep last-good values visible during failures and make fallback state explicit.

### 3. Desktop, then mobile

- Desktop should inherit the web implementation through its hosted URL. Verify Electron WebSocket lifecycle, external-navigation rules, reconnect after sleep/wake, and packaged-app sessions before declaring it complete.
- iOS should also inherit the web implementation. Verify `WKWebView` background/foreground recovery and Auth Worker cookie/ticket behavior.
- Before Android validation, remove the CDN divergence or formalize a canonical deployment sync. Then verify Android WebView background/foreground recovery, Back navigation, and both product flavors.
- Native code changes are only required if testing proves that a shell must expose lifecycle or network-state signals not available to the page; do not duplicate the portfolio model natively without a separate product decision.

## Required test matrix

- Initial REST snapshot followed by newer per-account realtime slices.
- Interleaved updates for multiple accounts.
- Duplicate, stale, rollback, epoch-change, reconnect, and cold-start snapshot cases exactly as defined by the protocol.
- Price-only update changes marked value and `priceAsOf` without changing quantity, cash, `positionsAsOf`, or `cashAsOf`.
- Socket loss retains data, changes connection state, and continues polling.
- Invalid/expired/replayed ticket fails closed without losing the last good portfolio.
- User scope never receives or retains another user's account after reconnect or initial snapshot.
- Dashboard/shop Back/Forward routing remains correct in browser, Electron, WKWebView, and Android WebView.
