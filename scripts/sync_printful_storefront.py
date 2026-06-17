#!/usr/bin/env python3
"""Sync published Printful product prices into the SmartSleeve storefront.

The public static site should display the prices configured in Printful, while
the checkout Worker needs private sync variant ids to create draft/real orders.
This script pulls Printful sync products and writes both artifacts without
putting the Printful token into the repo.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = ROOT / "merch" / "printful-launch-manifest.json"
DEFAULT_CATALOG_OUT = ROOT / "merch" / "printful-storefront-catalog.json"
DEFAULT_VARS_OUT = ROOT / "merch_checkout" / "printful-sync-variants.generated.toml"
DEFAULT_MAP = ROOT / "merch" / "printful-product-map.json"
API_BASE = "https://api.printful.com"
SIZES = ("S", "M", "L", "XL", "2XL")


@dataclass(frozen=True)
class ProductTarget:
    key: str
    name: str
    preview: str | None


def env_slug(value: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9]+", "_", value.strip().upper())
    return slug.strip("_")


def normalize(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def meaningful_tokens(value: str) -> set[str]:
    ignored = {"the", "and", "with", "black", "smart", "sleeve", "smartsleeve"}
    return {token for token in normalize(value).split() if len(token) > 1 and token not in ignored}


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def load_targets(path: Path) -> list[ProductTarget]:
    manifest = load_json(path, {})
    products = manifest.get("products") or []
    targets: list[ProductTarget] = []
    for product in products:
        key = str(product.get("key") or "").strip()
        name = str(product.get("name") or key).strip()
        if key:
            targets.append(ProductTarget(key=key, name=name, preview=product.get("preview")))
    if not targets:
        raise SystemExit(f"No products found in {path}")
    return targets


class PrintfulClient:
    def __init__(self, token: str, store_id: str | None = None) -> None:
        self.token = token
        self.store_id = store_id

    def request(self, path: str, params: dict[str, Any] | None = None) -> Any:
        url = f"{API_BASE}{path}"
        if params:
            url = f"{url}?{urllib.parse.urlencode(params)}"
        headers = {
            "Authorization": f"Bearer {self.token}",
            "User-Agent": "SmartSleeve storefront sync",
        }
        if self.store_id:
            headers["X-PF-Store-Id"] = self.store_id
        request = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            body = err.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Printful API {err.code} for {path}: {body}") from err

    def sync_products(self) -> list[dict[str, Any]]:
        products: list[dict[str, Any]] = []
        offset = 0
        limit = 100
        while True:
            payload = self.request("/sync/products", {"offset": offset, "limit": limit})
            batch = payload.get("result") or []
            products.extend(batch)
            paging = payload.get("paging") or {}
            total = int(paging.get("total") or len(products))
            offset += limit
            if offset >= total or not batch:
                return products

    def sync_product_detail(self, product_id: int) -> dict[str, Any]:
        payload = self.request(f"/sync/products/{product_id}")
        return payload.get("result") or {}


def map_entry(mapping: dict[str, Any], key: str) -> dict[str, Any]:
    raw = mapping.get(key)
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, int):
        return {"printful_product_id": raw}
    if isinstance(raw, str) and raw.strip().isdigit():
        return {"printful_product_id": int(raw.strip())}
    if isinstance(raw, str) and raw.strip():
        return {"name": raw.strip()}
    return {}


def match_product(target: ProductTarget, products: list[dict[str, Any]], mapping: dict[str, Any]) -> dict[str, Any] | None:
    entry = map_entry(mapping, target.key)
    wanted_id = entry.get("printful_product_id") or entry.get("id")
    if wanted_id:
        for product in products:
            if int(product.get("id") or 0) == int(wanted_id):
                return product
        return None
    wanted_name = normalize(str(entry.get("name") or target.name))
    exact = [product for product in products if normalize(str(product.get("name") or "")) == wanted_name]
    if len(exact) == 1:
        return exact[0]

    target_tokens = meaningful_tokens(f"{target.key} {target.name}")
    scored: list[tuple[int, int, dict[str, Any]]] = []
    for product in products:
        name = str(product.get("name") or "")
        tokens = meaningful_tokens(name)
        overlap = len(target_tokens & tokens)
        contains_bonus = 3 if normalize(target.name) in normalize(name) else 0
        score = overlap + contains_bonus
        if score > 0:
            scored.append((score, overlap, product))
    scored.sort(key=lambda item: (item[0], item[1]), reverse=True)
    if scored and (len(scored) == 1 or scored[0][0] > scored[1][0]):
        return scored[0][2]
    return None


def variant_size(variant: dict[str, Any]) -> str | None:
    candidates = [
        variant.get("size"),
        variant.get("option_size"),
        variant.get("name"),
        variant.get("variant_name"),
        (variant.get("product") or {}).get("name") if isinstance(variant.get("product"), dict) else None,
    ]
    for candidate in candidates:
        text = str(candidate or "").upper()
        match = re.search(r"(?<![A-Z0-9])(2XL|XL|L|M|S)(?![A-Z0-9])", text)
        if match:
            return match.group(1)
    return None


def variant_price(variant: dict[str, Any]) -> str | None:
    for key in ("retail_price", "price"):
        value = variant.get(key)
        if value is not None and str(value).strip():
            clean = re.sub(r"[^0-9.]+", "", str(value))
            if clean:
                return f"{float(clean):.2f}"
    return None


def price_label(prices: dict[str, str]) -> str:
    values = [float(value) for value in prices.values()]
    if not values:
        return "$19.99"
    min_price = min(values)
    max_price = max(values)
    if min_price == max_price:
        return f"${min_price:.2f}"
    return f"${min_price:.2f}-${max_price:.2f}"


def build_catalog_and_vars(
    targets: list[ProductTarget],
    products: list[dict[str, Any]],
    client: PrintfulClient,
    mapping: dict[str, Any],
) -> tuple[dict[str, Any], str, list[str]]:
    public_products: list[dict[str, Any]] = []
    vars_lines = [
        "# Generated by scripts/sync_printful_storefront.py.",
        "# Keep this file private; paste the [vars] entries into wrangler.toml or Cloudflare Worker vars.",
        "[vars]",
    ]
    warnings: list[str] = []

    for target in targets:
        matched = match_product(target, products, mapping)
        if not matched:
            warnings.append(f"No unique Printful product match for {target.key} ({target.name})")
            continue
        product_id = int(matched.get("id") or 0)
        detail = client.sync_product_detail(product_id)
        sync_product = detail.get("sync_product") or matched
        variants = detail.get("sync_variants") or []
        prices: dict[str, str] = {}
        sync_variant_ids: dict[str, int] = {}
        for variant in variants:
            size = variant_size(variant)
            price = variant_price(variant)
            sync_id = int(variant.get("id") or variant.get("sync_variant_id") or 0)
            if size in SIZES and price and sync_id:
                prices[size] = price
                sync_variant_ids[size] = sync_id
        if not prices:
            warnings.append(f"No priced size variants found for {target.key} ({sync_product.get('name')})")
            continue
        ordered_sizes = [size for size in SIZES if size in prices]
        slug = env_slug(target.key)
        vars_lines.append("")
        vars_lines.append(f"# {target.name} -> Printful product {product_id}: {sync_product.get('name')}")
        vars_lines.append(f'PRINTFUL_SYNC_PRODUCT_ID_{slug} = "{product_id}"')
        for size in ordered_sizes:
            vars_lines.append(f'MERCH_PRICE_USD_{slug}_{size} = "{prices[size]}"')
            vars_lines.append(f'PRINTFUL_SYNC_VARIANT_ID_{slug}_{size} = "{sync_variant_ids[size]}"')
        public_products.append(
            {
                "key": target.key,
                "name": target.name,
                "printful_name": sync_product.get("name") or matched.get("name"),
                "printful_product_id": product_id,
                "preview": target.preview,
                "price_label": price_label(prices),
                "sizes": ordered_sizes,
                "prices": {size: prices[size] for size in ordered_sizes},
            }
        )
        time.sleep(0.1)

    catalog = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "printful",
        "currency": "USD",
        "sizes": list(SIZES),
        "products": public_products,
    }
    return catalog, "\n".join(vars_lines) + "\n", warnings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--map", type=Path, default=DEFAULT_MAP, help="Optional product-key to Printful product-id/name map.")
    parser.add_argument("--catalog-out", type=Path, default=DEFAULT_CATALOG_OUT)
    parser.add_argument("--vars-out", type=Path, default=DEFAULT_VARS_OUT)
    parser.add_argument("--token-env", default="PRINTFUL_API_KEY")
    parser.add_argument("--store-id-env", default="PRINTFUL_STORE_ID")
    parser.add_argument("--fail-on-warning", action="store_true")
    args = parser.parse_args(argv)

    token = os.environ.get(args.token_env, "").strip()
    if not token:
        raise SystemExit(f"Set {args.token_env} to a Printful private token before running this script.")
    store_id = os.environ.get(args.store_id_env, "").strip() or None
    targets = load_targets(args.manifest)
    mapping = load_json(args.map, {})
    client = PrintfulClient(token=token, store_id=store_id)
    products = client.sync_products()
    catalog, vars_text, warnings = build_catalog_and_vars(targets, products, client, mapping)

    args.catalog_out.parent.mkdir(parents=True, exist_ok=True)
    args.vars_out.parent.mkdir(parents=True, exist_ok=True)
    args.catalog_out.write_text(json.dumps(catalog, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    args.vars_out.write_text(vars_text, encoding="utf-8")

    print(f"Wrote public storefront catalog: {args.catalog_out}")
    print(f"Wrote private Worker vars: {args.vars_out}")
    for warning in warnings:
        print(f"WARNING: {warning}", file=sys.stderr)
    if warnings and args.fail_on_warning:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
