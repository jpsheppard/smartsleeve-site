#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
OUTPUT_INPUT="${1:-${ROOT_DIR}/.deploy/cloudflare-pages}"

case "${OUTPUT_INPUT}" in
  .deploy/*) OUTPUT_DIR="${ROOT_DIR}/${OUTPUT_INPUT}" ;;
  "${ROOT_DIR}/.deploy/"*|/tmp/*|/private/tmp/*) OUTPUT_DIR="${OUTPUT_INPUT}" ;;
  *)
    echo "Refusing to replace an output directory outside .deploy or /tmp: ${OUTPUT_INPUT}" >&2
    exit 1
    ;;
esac

PUBLIC_PATHS=(
  about.html
  app
  apple-touch-icon.png
  brand
  contact.html
  dev-login.html
  favicon-16x16.png
  favicon-192x192.png
  favicon-32x32.png
  favicon-512x512.png
  favicon.ico
  favicon.svg
  index.html
  merch
  reset-password.html
  site-auth.css
  site-auth.js
  site.webmanifest
  smartsleeve-brand-logo.png
  smartsleeve-ss-banner.png
  smartsleeve-ss-v2-mark.png
  special-offers.css
  special-offers.html
  special-offers.js
  sqts-logo-green-llc.png
  sqts-logo-green-original.png
  sqts-logo-green.png
  verify.html
)

rm -rf "${OUTPUT_DIR}"
mkdir -p "${OUTPUT_DIR}"

while IFS= read -r -d '' tracked_path; do
  mkdir -p "${OUTPUT_DIR}/$(dirname "${tracked_path}")"
  cp "${ROOT_DIR}/${tracked_path}" "${OUTPUT_DIR}/${tracked_path}"
done < <(git -C "${ROOT_DIR}" ls-files -z -- "${PUBLIC_PATHS[@]}")

file_count="$(find "${OUTPUT_DIR}" -type f | wc -l | tr -d ' ')"
if [ "${file_count}" -gt 20000 ]; then
  echo "Cloudflare Pages bundle exceeds the 20,000-file Free plan limit." >&2
  exit 1
fi

oversized_file="$(find "${OUTPUT_DIR}" -type f -size +25M -print -quit)"
if [ -n "${oversized_file}" ]; then
  echo "Cloudflare Pages bundle contains an asset larger than 25 MiB: ${oversized_file}" >&2
  exit 1
fi

for excluded in docs merch_checkout scripts site_auth README.md CNAME .gitignore; do
  if [ -e "${OUTPUT_DIR}/${excluded}" ]; then
    echo "Internal path leaked into public bundle: ${excluded}" >&2
    exit 1
  fi
done

echo "Built ${file_count}-file Cloudflare Pages bundle at ${OUTPUT_DIR}"
