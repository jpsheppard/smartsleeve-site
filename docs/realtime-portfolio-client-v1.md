# Realtime portfolio web client v1

Status: implemented against `smartsleeve.portfolio.v1`; production feature flag enabled in the site repository.

Server contract: adjacent platform repository, `docs/realtime_portfolio_protocol_v1.md`.

## Runtime path

1. The app authenticates and renders the existing `/api/app-feed` response.
2. `app/portfolio-realtime.js` requests a one-use ticket bundle from `POST /api/realtime-ticket`.
3. It opens every returned `wss://` connection without persisting or logging ticket URLs.
4. `portfolio.snapshot` and `account.update` messages are validated against protocol v1.
5. Per-account ordering accepts a higher `sourceSequence` in the same `sourceEpoch`, accepts the first state from a new epoch, and ignores duplicate/lower sequences.
6. `app/portfolio-data.js` matches the account by exact `accountId`, preserves fallback-only analytics fields, and replaces holdings, quantities, cash, prices, broker/marked values, and freshness metadata.
7. Polling remains scheduled every five minutes. Poll results are re-merged with the last accepted realtime slices so a fallback response cannot roll a live account backward.

Realtime absence never deletes a fallback account. An account absent from the scoped `/api/app-feed` response cannot be added by a WebSocket message.

## Feature flag

Production HTML contains:

```html
<meta name="smartsleeve-realtime-enabled" content="true">
```

The query parameter `?realtime=0` disables the realtime adapter for rollback/diagnostics while leaving polling unchanged. `?realtime=1` enables it when testing an HTML build whose meta flag is off.

## UI semantics

- The top status distinguishes `Realtime live`, `Connecting`, `Polling fallback`, and feature-disabled `Polling`.
- Connection status is separate from field freshness. A fresh last-good value can remain `Live` briefly after transport loss while the connection pill clearly says `Polling fallback`; it becomes stale based on its own clock/threshold.
- Every account card and account detail shows separate positions, cash, price, and broker-equity clocks.
- `streaming_mark_to_market` is labeled `Derived marked value`. It updates marked equity without advancing positions or cash clocks.
- Field freshness uses the protocol source status plus each field timestamp and `staleAfterSeconds`.
- Socket loss preserves the last good values and the existing poll schedule.

## Lifecycle and security

- Every reconnect obtains a new ticket; tickets are never reused.
- Ticket URLs are passed directly to the WebSocket constructor and are not stored in client status, diagnostics, analytics, or logs.
- Account messages are rejected unless their account ID is present in that connection's ticket scope and in the scoped fallback feed.
- The client pauses the socket while offline, backgrounded, signed out, or browsing the public shop, then obtains fresh tickets when the portfolio view resumes.
- Binary, oversized, malformed, wrong-tenant, wrong-protocol, non-finite, and over-position-limit messages fail closed while last-good data remains visible.

## Verification

Automated module coverage proves:

- poll-first merge and realtime persistence across later polls;
- unknown-account rejection;
- snapshot application, duplicate/lower-sequence rejection, and new-epoch replacement;
- connection-scope enforcement;
- fresh ticket acquisition after disconnect;
- no ticket URL exposure through status;
- finite-value, timestamp, schema, and position-count validation;
- additive-field compatibility.

The browser integration harness verifies:

- fallback renders before the mock socket snapshot;
- a Schwab PCRA realtime slice updates holdings, cash, marked equity, and all field clocks;
- derived-value labeling is visible;
- disconnect shows polling fallback without erasing values;
- reconnect converges through a fresh socket;
- `?realtime=0` retains the original poll-only behavior;
- shop navigation pauses realtime and returning to the dashboard reconnects it.

## Remaining shell work

iOS and desktop load `smartsleeve.ai/app/` and inherit this web client after their normal hosted-page refresh. Validate background/foreground and sleep/wake behavior in the packaged shells.

Android product flavors still point at the legacy DigitalOcean CDN app. Move both flavors to the canonical `smartsleeve.ai/app/` URL, or establish a committed canonical artifact-sync process, before declaring Android realtime-enabled.
