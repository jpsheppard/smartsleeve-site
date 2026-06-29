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
import shlex
import ssl
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
DEFAULT_ENV_FILE = ROOT / ".env.printful.local"
API_BASE = "https://api.printful.com"
SIZES = ("XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL")
MACOS_SYSTEM_CA_FILE = Path("/private/etc/ssl/cert.pem")


@dataclass(frozen=True)
class ProductTarget:
    key: str
    name: str
    preview: str | None


def env_slug(value: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9]+", "_", value.strip().upper())
    return slug.strip("_")


def key_slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.strip().lower())
    return slug.strip("-")


def product_key(product_id: int, name: str) -> str:
    slug = key_slug(name)[:72].strip("-") or "product"
    return f"printful-{product_id}-{slug}"


def product_display_text(product: dict[str, Any]) -> str:
    return " ".join(
        str(product.get(key) or "")
        for key in ("name", "printful_name", "key")
    ).lower()


def merch_logo_rank(product: dict[str, Any]) -> int:
    text = product_display_text(product)
    return 1 if "sqts" in text else 0


def merch_back_rank(product: dict[str, Any]) -> int:
    text = product_display_text(product)
    if "website+qr" in text or "website qr" in text or "qr back" in text:
        return 2
    if "website back" in text:
        return 1
    if "plain back" in text or "blank back" in text:
        return 0
    return 3


def merch_gender_rank(product: dict[str, Any]) -> int:
    text = product_display_text(product)
    if "women" in text:
        return 1
    if "men" in text or "muscle tee" in text:
        return 0
    if "unisex" in text:
        return 2
    return 3


def merch_apparel_rank(product: dict[str, Any]) -> int:
    text = product_display_text(product)
    if "muscle tee" in text or "muscle shirt" in text:
        return 1
    if "tank" in text:
        return 2
    if "tee" in text or "t-shirt" in text or "shirt" in text:
        return 0
    return 9


def merch_sort_key(product: dict[str, Any]) -> tuple[int, int, int, int, str, int]:
    return (
        merch_gender_rank(product),
        merch_apparel_rank(product),
        merch_logo_rank(product),
        merch_back_rank(product),
        product_display_text(product),
        int(product.get("printful_product_id") or 0),
    )


def normalize(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def meaningful_tokens(value: str) -> set[str]:
    ignored = {"the", "and", "with", "black", "smart", "sleeve", "smartsleeve"}
    return {token for token in normalize(value).split() if len(token) > 1 and token not in ignored}


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export "):].strip()
        if "=" not in line:
            raise SystemExit(f"Invalid env line in {path}:{line_number}; expected KEY=value.")
        key, value = line.split("=", 1)
        key = key.strip()
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            raise SystemExit(f"Invalid env key in {path}:{line_number}: {key!r}")
        try:
            parsed = shlex.split(value, comments=False, posix=True)
        except ValueError as exc:
            raise SystemExit(f"Invalid env value in {path}:{line_number}: {exc}") from exc
        os.environ.setdefault(key, parsed[0] if parsed else "")


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
    def __init__(self, token: str, store_id: str | None = None, ca_file: Path | None = None) -> None:
        self.token = token
        self.store_id = store_id
        self.ssl_context = ssl.create_default_context(cafile=str(ca_file)) if ca_file else None

    def request(self, path: str, params: dict[str, Any] | None = None, include_store_id: bool = True) -> Any:
        url = f"{API_BASE}{path}"
        if params:
            url = f"{url}?{urllib.parse.urlencode(params)}"
        headers = {
            "Authorization": f"Bearer {self.token}",
            "User-Agent": "SmartSleeve storefront sync",
        }
        if include_store_id and self.store_id:
            headers["X-PF-Store-Id"] = self.store_id
        request = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=30, context=self.ssl_context) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            body = err.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Printful API {err.code} for {path}: {body}") from err
        except urllib.error.URLError as err:
            reason = getattr(err, "reason", err)
            if isinstance(reason, ssl.SSLCertVerificationError) or "CERTIFICATE_VERIFY_FAILED" in str(reason):
                raise RuntimeError(
                    "Printful TLS certificate verification failed. On macOS, rerun with "
                    "`SSL_CERT_FILE=/private/etc/ssl/cert.pem`, or use Codex's bundled Python runtime."
                ) from err
            raise RuntimeError(f"Printful API request failed for {path}: {reason}") from err

    def stores(self) -> list[dict[str, Any]]:
        payload = self.request("/stores", include_store_id=False)
        result = payload.get("result") or []
        if isinstance(result, list):
            return result
        if isinstance(result, dict):
            stores = result.get("stores")
            if isinstance(stores, list):
                return stores
        return []

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


def default_ca_file() -> Path | None:
    configured = os.environ.get("PRINTFUL_CA_FILE") or os.environ.get("SSL_CERT_FILE")
    if configured:
        return Path(configured)
    if sys.platform == "darwin" and MACOS_SYSTEM_CA_FILE.exists():
        return MACOS_SYSTEM_CA_FILE
    return None


def store_display_name(store: dict[str, Any]) -> str:
    for key in ("name", "store_name", "display_name"):
        value = store.get(key)
        if value:
            return str(value)
    return "(unnamed store)"


def store_identifier(store: dict[str, Any]) -> str | None:
    for key in ("id", "store_id"):
        value = store.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return None


def print_stores(stores: list[dict[str, Any]]) -> None:
    if not stores:
        print("No stores were returned for this Printful token.")
        return
    print("Printful stores available to this token:")
    for store in stores:
        store_id = store_identifier(store) or "UNKNOWN"
        print(f"- {store_id}: {store_display_name(store)}")


def print_sync_products(products: list[dict[str, Any]]) -> None:
    if not products:
        print("No synced Printful products were returned for this store.")
        return
    print("Printful sync products available to this store:")
    for product in products:
        product_id = product.get("id") or "UNKNOWN"
        name = product.get("name") or "(unnamed product)"
        variants = product.get("variants")
        variant_count = f", variants={variants}" if variants is not None else ""
        print(f"- {product_id}: {name}{variant_count}")


def resolve_store_id(client: PrintfulClient, configured_store_id: str | None, list_stores: bool) -> str | None:
    if configured_store_id:
        return configured_store_id
    stores = client.stores()
    if list_stores:
        print_stores(stores)
        return None
    if len(stores) == 1:
        store_id = store_identifier(stores[0])
        if store_id:
            print(f"Using only available Printful store {store_id}: {store_display_name(stores[0])}")
            return store_id
    print_stores(stores)
    raise SystemExit(
        "Set PRINTFUL_STORE_ID to the SmartSleeve store id above, then rerun the sync. "
        "Example: export PRINTFUL_STORE_ID=12345678"
    )


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
        match = re.search(r"(?<![A-Z0-9])(6XL|5XL|4XL|3XL|2XL|XL|XS|L|M|S)(?![A-Z0-9])", text)
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


def ordered_sizes(prices: dict[str, str]) -> list[str]:
    known = [size for size in SIZES if size in prices]
    extra = sorted(size for size in prices if size not in known)
    return known + extra


def duplicate_product_signature(name: str, prices: dict[str, str]) -> tuple[str, tuple[tuple[str, str], ...]]:
    return (
        normalize(name),
        tuple((size, prices[size]) for size in ordered_sizes(prices)),
    )


def toml_quote(value: Any) -> str:
    return json.dumps(str(value), ensure_ascii=False)


def preview_url(sync_product: dict[str, Any], matched: dict[str, Any] | None = None) -> str | None:
    candidates = [
        sync_product.get("thumbnail_url"),
        sync_product.get("thumbnail"),
        sync_product.get("image"),
        sync_product.get("preview_url"),
    ]
    if matched:
        candidates.extend([
            matched.get("thumbnail_url"),
            matched.get("thumbnail"),
            matched.get("image"),
            matched.get("preview_url"),
        ])
    for candidate in candidates:
        if candidate:
            return str(candidate)
    return None


def print_file_previews(variants: list[dict[str, Any]]) -> dict[str, str]:
    previews: dict[str, str] = {}
    for variant in variants:
        for file in variant.get("files") or []:
            if not isinstance(file, dict):
                continue
            file_type = str(file.get("type") or "").lower()
            preview = file.get("preview_url") or file.get("thumbnail_url")
            if not preview:
                continue
            if "front" in file_type or file_type == "default":
                previews.setdefault("front_print_preview", str(preview))
            elif "back" in file_type:
                previews.setdefault("back_print_preview", str(preview))
        if previews.get("front_print_preview") and previews.get("back_print_preview"):
            break
    return previews


def variant_prices_and_ids(variants: list[dict[str, Any]]) -> tuple[dict[str, str], dict[str, int]]:
    prices: dict[str, str] = {}
    sync_variant_ids: dict[str, int] = {}
    for variant in variants:
        size = variant_size(variant)
        price = variant_price(variant)
        sync_id = int(variant.get("id") or variant.get("sync_variant_id") or 0)
        if size and price and sync_id:
            prices[size] = price
            sync_variant_ids[size] = sync_id
    return prices, sync_variant_ids


def append_product_vars(
    vars_lines: list[str],
    key: str,
    name: str,
    product_id: int,
    prices: dict[str, str],
    sync_variant_ids: dict[str, int],
) -> None:
    slug = env_slug(key)
    vars_lines.append("")
    vars_lines.append(f"# {name} -> Printful product {product_id}")
    vars_lines.append(f"MERCH_PRODUCT_KEY_{slug} = {toml_quote(key)}")
    vars_lines.append(f"MERCH_PRODUCT_NAME_{slug} = {toml_quote(name)}")
    vars_lines.append(f"MERCH_PRODUCT_DESCRIPTION_{slug} = {toml_quote('Published Printful product synced for SmartSleeve checkout.')}")
    vars_lines.append(f'PRINTFUL_SYNC_PRODUCT_ID_{slug} = "{product_id}"')
    for size in ordered_sizes(prices):
        vars_lines.append(f'MERCH_PRICE_USD_{slug}_{size} = "{prices[size]}"')
        vars_lines.append(f'PRINTFUL_SYNC_VARIANT_ID_{slug}_{size} = "{sync_variant_ids[size]}"')


def public_product(
    key: str,
    name: str,
    product_id: int,
    prices: dict[str, str],
    sync_product: dict[str, Any],
    matched: dict[str, Any] | None = None,
    preview: str | None = None,
    print_previews: dict[str, str] | None = None,
) -> dict[str, Any]:
    sizes = ordered_sizes(prices)
    product = {
        "key": key,
        "name": name,
        "printful_name": sync_product.get("name") or name,
        "printful_product_id": product_id,
        "preview": preview or preview_url(sync_product, matched),
        "price_label": price_label(prices),
        "sizes": sizes,
        "prices": {size: prices[size] for size in sizes},
    }
    if print_previews:
        product.update(print_previews)
    return product


def finalized_catalog_outputs(
    entries: list[dict[str, Any]],
    warnings: list[str],
) -> tuple[list[dict[str, Any]], str]:
    deduped: dict[tuple[str, tuple[tuple[str, str], ...]], dict[str, Any]] = {}
    for entry in entries:
        signature = duplicate_product_signature(str(entry["name"]), dict(entry["prices"]))
        existing = deduped.get(signature)
        if existing is None or int(entry["product_id"]) < int(existing["product_id"]):
            if existing is not None:
                warnings.append(
                    "Suppressed duplicate Printful product "
                    f"{existing['product_id']} ({existing['name']}); keeping {entry['product_id']}."
                )
            deduped[signature] = entry
        else:
            warnings.append(
                "Suppressed duplicate Printful product "
                f"{entry['product_id']} ({entry['name']}); keeping {existing['product_id']}."
            )

    kept_entries = sorted(deduped.values(), key=lambda entry: merch_sort_key(entry["public"]))
    vars_lines = [
        "# Generated by scripts/sync_printful_storefront.py.",
        "# Keep this file private; paste the [vars] entries into wrangler.toml or Cloudflare Worker vars.",
        "[vars]",
    ]
    public_products: list[dict[str, Any]] = []
    for entry in kept_entries:
        append_product_vars(
            vars_lines,
            str(entry["key"]),
            str(entry["name"]),
            int(entry["product_id"]),
            dict(entry["prices"]),
            dict(entry["sync_variant_ids"]),
        )
        public_products.append(dict(entry["public"]))
    return public_products, "\n".join(vars_lines) + "\n"


def build_catalog_and_vars_for_all_products(
    products: list[dict[str, Any]],
    client: PrintfulClient,
) -> tuple[dict[str, Any], str, list[str]]:
    entries: list[dict[str, Any]] = []
    warnings: list[str] = []

    for product in products:
        product_id = int(product.get("id") or 0)
        if not product_id:
            continue
        detail = client.sync_product_detail(product_id)
        sync_product = detail.get("sync_product") or product
        if int(sync_product.get("synced") if sync_product.get("synced") is not None else product.get("synced") or 1) == 0:
            continue
        name = str(sync_product.get("name") or product.get("name") or f"Printful product {product_id}").strip()
        variants = detail.get("sync_variants") or []
        prices, sync_variant_ids = variant_prices_and_ids(variants)
        if not prices:
            warnings.append(f"No priced size variants found for Printful product {product_id} ({name})")
            continue
        key = product_key(product_id, name)
        entries.append({
            "key": key,
            "name": name,
            "product_id": product_id,
            "prices": prices,
            "sync_variant_ids": sync_variant_ids,
            "public": public_product(key, name, product_id, prices, sync_product, product, print_previews=print_file_previews(variants)),
        })
        time.sleep(0.1)

    public_products, vars_text = finalized_catalog_outputs(entries, warnings)
    catalog = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "printful",
        "currency": "USD",
        "sizes": list(SIZES),
        "products": public_products,
    }
    return catalog, vars_text, warnings


def build_catalog_and_vars(
    targets: list[ProductTarget],
    products: list[dict[str, Any]],
    client: PrintfulClient,
    mapping: dict[str, Any],
) -> tuple[dict[str, Any], str, list[str]]:
    entries: list[dict[str, Any]] = []
    warnings: list[str] = []

    for target in targets:
        matched = match_product(target, products, mapping)
        if not matched:
            warnings.append(f"No unique Printful product match for {target.key} ({target.name})")
            continue
        product_id = int(matched.get("id") or 0)
        detail = client.sync_product_detail(product_id)
        sync_product = detail.get("sync_product") or matched
        if int(sync_product.get("synced") if sync_product.get("synced") is not None else matched.get("synced") or 1) == 0:
            warnings.append(f"Skipping unsynced Printful product for {target.key} ({sync_product.get('name')})")
            continue
        variants = detail.get("sync_variants") or []
        prices, sync_variant_ids = variant_prices_and_ids(variants)
        if not prices:
            warnings.append(f"No priced size variants found for {target.key} ({sync_product.get('name')})")
            continue
        entries.append({
            "key": target.key,
            "name": target.name,
            "product_id": product_id,
            "prices": prices,
            "sync_variant_ids": sync_variant_ids,
            "public": public_product(target.key, target.name, product_id, prices, sync_product, matched, target.preview, print_file_previews(variants)),
        })
        time.sleep(0.1)

    public_products, vars_text = finalized_catalog_outputs(entries, warnings)
    catalog = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "printful",
        "currency": "USD",
        "sizes": list(SIZES),
        "products": public_products,
    }
    return catalog, vars_text, warnings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--map", type=Path, default=DEFAULT_MAP, help="Optional product-key to Printful product-id/name map.")
    parser.add_argument("--catalog-out", type=Path, default=DEFAULT_CATALOG_OUT)
    parser.add_argument("--vars-out", type=Path, default=DEFAULT_VARS_OUT)
    parser.add_argument("--token-env", default="PRINTFUL_API_KEY")
    parser.add_argument("--store-id-env", default="PRINTFUL_STORE_ID")
    parser.add_argument("--ca-file", type=Path, default=default_ca_file())
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV_FILE, help="Optional gitignored env file with PRINTFUL_API_KEY/PRINTFUL_STORE_ID.")
    parser.add_argument("--list-stores", action="store_true", help="List Printful stores visible to the token and exit.")
    parser.add_argument("--list-products", action="store_true", help="List synced Printful products for the selected store and exit.")
    parser.add_argument("--manifest-only", action="store_true", help="Only sync products listed in the launch manifest.")
    parser.add_argument("--fail-on-warning", action="store_true")
    args = parser.parse_args(argv)

    load_env_file(args.env_file)
    token = os.environ.get(args.token_env, "").strip()
    if not token:
        raise SystemExit(f"Set {args.token_env} to a Printful private token before running this script.")
    store_id = os.environ.get(args.store_id_env, "").strip() or None
    store_probe = PrintfulClient(token=token, ca_file=args.ca_file)
    store_id = resolve_store_id(store_probe, store_id, args.list_stores)
    if args.list_stores:
        return 0
    targets = load_targets(args.manifest)
    mapping = load_json(args.map, {})
    client = PrintfulClient(token=token, store_id=store_id, ca_file=args.ca_file)
    products = client.sync_products()
    if args.list_products:
        print_sync_products(products)
        return 0
    if args.manifest_only:
        catalog, vars_text, warnings = build_catalog_and_vars(targets, products, client, mapping)
    else:
        catalog, vars_text, warnings = build_catalog_and_vars_for_all_products(products, client)

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
