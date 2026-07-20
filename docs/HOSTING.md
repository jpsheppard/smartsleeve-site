# SmartSleeve site hosting and recovery

## Architecture

The site frontend is a static deployment: the same HTML, CSS, JavaScript, JSON,
and image files are served at the edge. Dynamic capabilities remain independent
Cloudflare Workers and external APIs, including authentication, realtime
portfolio data, Stripe checkout, Printful fulfillment, and transactional email.
Moving the frontend between static hosts does not remove those capabilities.

Production uses Cloudflare Pages. GitHub remains the source repository and
GitHub Pages remains a warm standby. The public repository's standard GitHub
Pages runner is free, but production does not depend on that runner completing.

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

## Normal production deployment

Run `scripts/deploy_cloudflare_pages.sh`. It rebuilds the allowlisted public
bundle and uploads it directly to the `smartsleeve-site` Cloudflare Pages
project. This path uses local Wrangler authentication and does not consume a
GitHub Actions runner.

Before deploying, run the relevant application and Worker tests and keep the
working tree intentional. After deploying, verify the Pages deployment URL and
the custom domain before announcing completion.

## Redundancy and failover

Cloudflare Pages is the primary frontend host. GitHub Pages is the warm standby
and may continue to update whenever GitHub's Pages runner is available.

The direct Wrangler upload is also an emergency deployment path when GitHub or
GitHub Actions is unavailable. Provider failover is manual by design: automatic
multi-provider load balancing adds cost and another routing layer without a
current traffic or uptime requirement that justifies it.

If Cloudflare Pages is unavailable:

1. Confirm the outage is provider-side rather than an application or DNS issue.
2. Confirm the GitHub Pages standby serves the desired commit.
3. Point the SmartSleeve DNS records back to the documented GitHub Pages target.
4. Verify the apex domain, `www`, `/app/`, authentication, and merch checkout.
5. Restore Cloudflare Pages only after its deployment and TLS status are healthy.

Never change DNS before the alternate deployment has passed those checks.
