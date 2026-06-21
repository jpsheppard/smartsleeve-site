# SmartSleeve Console Prototype

This folder contains the SmartSleeve user console prototype served at:

```text
https://smartsleeve.ai/app/
```

The route is intentionally not linked from the public placeholder homepage yet.

## What This Prototype Covers

- Account creation/profile shape with optional email verification Worker
- Subscription plan selection
- Discount-code pricing preview
- Bank funding/deposit intent UI
- Robinhood connection placeholder
- Sleeve limit controls for Sage by SmartSleeve, Semi Sage, Honey Badger, Grand Sage, General Sage, Value Sage, Savage Sage, Covered Sage, and Convex Sage
- Daily report and cadence controls for active Sage by SmartSleeve users, developer fallback recipients, hosted chart/logo assets, and daemon/research refresh intervals
- Trading behavior controls for clinginess/flip resistance, diversity, attraction, bullishness, stickiness, gain-locking, and hard hold
- Custom Sage universe builder
- Portfolio behavior breakdowns and sleeve-owned touch permissions
- Grand Sage research, priors, and Bayesian tuning workflow status
- Absorb, lateral, and spinoff workflows
- Daemon control placeholder
- Security, identity, and money-movement readiness checklist
- Website, Android, iOS, and SmartSleeve Command desktop app paths
- Help, contact, and about pages

## Account Registration

When GitHub variable `SMARTSLEEVE_AUTH_ENDPOINT` is configured during static
site deployment, the Create Account form submits profile/password registration
requests to the SmartSleeve Auth Worker. The Worker sends a Resend-backed
verification email and stores pending/verified records in Cloudflare KV.

If `SMARTSLEEVE_AUTH_ENDPOINT` is not configured, the form performs local
validation only and clearly reports that the registration backend is not
connected.

## Billing Discount Codes

The static console can preview discount-code pricing, but production checkout
must validate and redeem codes server-side in the payment provider before any
subscription is activated.

Current allowed codes:

- `BFF4LYFE`: free SmartSleeve Core and free Grand Sage.
- `OG2026FOUNDER`: free SmartSleeve Core and 50% off optional Grand Sage.
- `OG2026USER`: 20% off SmartSleeve Core and 20% off optional Grand Sage.

## Safety Boundary

This is still an early product UI. It must not collect or submit:

- Broker credentials
- Bank credentials
- Card/payment details
- Real daemon start/stop commands
- Real sleeve ledger mutations
- Live trading instructions

Production versions still need signed sessions, server-side authorization,
secret vaulting, provider-hosted payment/bank flows, audit logs, and explicit
confirmation screens before any state-changing action.
