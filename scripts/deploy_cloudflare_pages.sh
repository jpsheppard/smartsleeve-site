#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
OUTPUT_DIR="${ROOT_DIR}/.deploy/cloudflare-pages"
PROJECT_NAME="${CLOUDFLARE_PAGES_PROJECT:-smartsleeve-site}"
WRANGLER="${ROOT_DIR}/merch_checkout/node_modules/.bin/wrangler"

if [ ! -x "${WRANGLER}" ]; then
  echo "Wrangler is unavailable. Run npm ci in merch_checkout first." >&2
  exit 1
fi

"${ROOT_DIR}/scripts/build_cloudflare_pages.sh" "${OUTPUT_DIR}"

commit_hash="$(git -C "${ROOT_DIR}" rev-parse HEAD)"
commit_message="$(git -C "${ROOT_DIR}" log -1 --pretty=%s)"
export WRANGLER_LOG_PATH="${WRANGLER_LOG_PATH:-/tmp/smartsleeve-pages-deploy.log}"

"${WRANGLER}" pages deploy "${OUTPUT_DIR}" \
  --project-name="${PROJECT_NAME}" \
  --branch=main \
  --commit-hash="${commit_hash}" \
  --commit-message="${commit_message}"
