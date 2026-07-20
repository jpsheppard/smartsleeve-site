# SmartSleeve site hosting and recovery

## Architecture

The site frontend is a static deployment: the same HTML, CSS, JavaScript, JSON,
and image files are served at the edge. Dynamic capabilities remain independent
Cloudflare Workers and external APIs, including authentication, realtime
portfolio data, Stripe checkout, Printful fulfillment, and transactional email.
Moving the frontend between static hosts does not remove those capabilities.

The production domain currently uses GitHub Pages. Cloudflare Pages is an
independently built warm standby at `https://smartsleeve-site.pages.dev`.
Both deployments read the same `main` branch, but the Cloudflare build does not
use a GitHub Actions runner. The public repository's standard GitHub Pages
runner is free.

## Public bundle boundary

Run `scripts/build_cloudflare_pages.sh` to create `.deploy/cloudflare-pages`.
The script copies only tracked public website files and validates Cloudflare's
Free plan file-count and per-file-size limits. It deliberately excludes source,
operations, and documentation paths such as:

- `docs/`
- `merch_checkout/`
- `scripts/`
- `site_auth/`
- repository metadata and the GitHub Pages `CNAME`

This is narrower than publishing the repository root and prevents Worker source
or operational documentation from becoming website assets.

## Direct Cloudflare standby deployment

Run `scripts/deploy_cloudflare_pages.sh`. It rebuilds the allowlisted public
bundle and uploads it directly to the `smartsleeve-site` Cloudflare Pages
project. This path uses local Wrangler authentication and does not consume a
GitHub Actions runner.

Before deploying, run the relevant application and Worker tests and keep the
working tree intentional. After deploying, verify the Pages deployment URL.
A custom domain must be verified separately if Cloudflare is later promoted.

## Redundancy and failover

GitHub Pages currently serves `smartsleeve.ai`. Cloudflare Pages is the warm
standby and automatically builds the same branch through Cloudflare's GitHub
integration.

The direct Wrangler upload is also an emergency deployment path when GitHub or
GitHub Actions is unavailable. Provider failover is manual by design: automatic
multi-provider load balancing adds cost and another routing layer without a
current traffic or uptime requirement that justifies it.

The authoritative DNS zone is currently hosted by DigitalOcean. Its apex and
`www` records target GitHub Pages. Do not treat the Cloudflare project as the
branded-domain primary unless its custom-domain and DNS configuration have
been deliberately completed and verified.

If GitHub Pages is unavailable:

1. Confirm the outage is provider-side rather than an application or DNS issue.
2. Confirm `smartsleeve-site.pages.dev` serves the desired commit and passes the
   critical application checks below.
3. Promote Cloudflare Pages only through a planned custom-domain and DNS change;
   do not improvise apex records during an incident.
4. Verify the apex domain, `www`, `/app/`, authentication, and merch checkout.
5. Restore the preferred routing only after its deployment and TLS status are
   healthy.

Never change DNS before the alternate deployment has passed those checks.
