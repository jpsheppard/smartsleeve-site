#!/usr/bin/env python3
"""Generate stable Printful garment mockups for the public merch catalog."""

from __future__ import annotations

import argparse
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from sync_printful_storefront import (
    API_BASE,
    DEFAULT_CATALOG_OUT,
    DEFAULT_ENV_FILE,
    PrintfulClient,
    default_ca_file,
    load_env_file,
)


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT_DIR = ROOT / "merch" / "mockups"
PUBLIC_MERCH_BASE = "https://smartsleeve.ai/merch"
PUBLIC_REPO = "https://raw.githubusercontent.com/jpsheppard/smartsleeve-site"
FRONT_SS = f"{PUBLIC_MERCH_BASE}/smartsleeve-ss-common-front-print.png"
FRONT_SQTS = f"{PUBLIC_MERCH_BASE}/sqts-llc-common-front-print.png"
BLANK_BACK = f"{PUBLIC_MERCH_BASE}/smartsleeve-back-blank-print.png"


def current_git_sha() -> str:
    import subprocess

    completed = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=True,
    )
    return completed.stdout.strip()


def request_json(
    path: str,
    token: str,
    store_id: str | None,
    ca_file: Path | None,
    method: str = "GET",
    body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    url = f"{API_BASE}{path}"
    headers = {
        "Authorization": f"Bearer {token}",
        "User-Agent": "SmartSleeve Printful mockup generator",
    }
    if store_id:
        headers["X-PF-Store-Id"] = store_id
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    context = ssl.create_default_context(cafile=str(ca_file)) if ca_file else None
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=60, context=context) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        text = err.read().decode("utf-8", errors="replace")
        if err.code == 429:
            match = re.search(r"after\s+(\d+)\s+seconds", text, re.IGNORECASE)
            delay = int(match.group(1)) if match else 60
            print(f"Printful rate limit for {path}; waiting {delay + 2}s")
            time.sleep(delay + 2)
            return request_json(path, token, store_id, ca_file, method, body)
        raise RuntimeError(f"Printful API {err.code} for {path}: {text}") from err


def download(url: str, destination: Path, ca_file: Path | None) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    context = ssl.create_default_context(cafile=str(ca_file)) if ca_file else None
    request = urllib.request.Request(url, headers={"User-Agent": "SmartSleeve Printful mockup downloader"})
    with urllib.request.urlopen(request, timeout=120, context=context) as response:
        destination.write_bytes(response.read())


def slug(value: str) -> str:
    clean = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return clean or "product"


def brand_front_url(product: dict[str, Any], front_ss_url: str, front_sqts_url: str) -> str:
    text = f"{product.get('name', '')} {product.get('key', '')}".lower()
    return front_sqts_url if "sqts" in text else front_ss_url


def selected_variant(detail: dict[str, Any], preferred_size: str) -> dict[str, Any]:
    variants = detail.get("sync_variants") or []
    if not variants:
        raise RuntimeError("sync product detail has no variants")
    for variant in variants:
        if str(variant.get("name") or "").rsplit("/", 1)[-1].strip().upper() == preferred_size.upper():
            return variant
    return variants[0]


def back_url_from_variant(variant: dict[str, Any]) -> str:
    for file in variant.get("files") or []:
        file_type = str(file.get("type") or "").lower()
        filename = str(file.get("filename") or "")
        if file_type in {"back", "back_dtf"}:
            return f"{PUBLIC_MERCH_BASE}/{filename}" if filename else str(file.get("preview_url") or BLANK_BACK)
    return BLANK_BACK


def print_area_position(product_id: int, variant_id: int, token: str, store_id: str | None, ca_file: Path | None) -> dict[str, int]:
    payload = request_json(f"/mockup-generator/printfiles/{product_id}", token, store_id, ca_file)
    result = payload.get("result") or {}
    printfile_id = None
    for item in result.get("variant_printfiles") or []:
        if int(item.get("variant_id") or 0) == int(variant_id):
            printfile_id = (item.get("placements") or {}).get("front") or (item.get("placements") or {}).get("default")
            break
    dimensions = {"width": 1800, "height": 2400}
    for item in result.get("printfiles") or []:
        if printfile_id is not None and int(item.get("printfile_id") or 0) == int(printfile_id):
            dimensions = {"width": int(item.get("width") or 1800), "height": int(item.get("height") or 2400)}
            break
    area_width = dimensions["width"]
    area_height = dimensions["height"]
    # The approved art files are transparent canvases. A square placement keeps
    # the logo group at chest size in Printful's flat apparel renders.
    box_size = min(area_width, area_height)
    return {
        "area_width": area_width,
        "area_height": area_height,
        "width": box_size,
        "height": box_size,
        "top": max((area_height - box_size) // 2, 0),
        "left": max((area_width - box_size) // 2, 0),
    }


def create_task(
    product_id: int,
    variant_id: int,
    front_url: str,
    back_url: str,
    position: dict[str, int],
    token: str,
    store_id: str | None,
    ca_file: Path | None,
) -> str:
    body = {
        "variant_ids": [variant_id],
        "format": "jpg",
        "width": 1000,
        "files": [
            {"placement": "front", "image_url": front_url, "position": position},
            {"placement": "back", "image_url": back_url, "position": position},
        ],
    }
    payload = request_json(f"/mockup-generator/create-task/{product_id}", token, store_id, ca_file, "POST", body)
    task_key = (payload.get("result") or {}).get("task_key")
    if not task_key:
        raise RuntimeError(f"Printful did not return a task key for product {product_id}")
    return str(task_key)


def wait_for_task(task_key: str, token: str, store_id: str | None, ca_file: Path | None) -> dict[str, str]:
    for _ in range(40):
        time.sleep(3)
        payload = request_json(f"/mockup-generator/task?{urllib.parse.urlencode({'task_key': task_key})}", token, store_id, ca_file)
        result = payload.get("result") or {}
        status = result.get("status")
        if status == "completed":
            urls: dict[str, str] = {}
            for mockup in result.get("mockups") or []:
                placement = str(mockup.get("placement") or "")
                chosen = None
                for extra in mockup.get("extra") or []:
                    if str(extra.get("option_group") or "").lower() == "flat":
                        chosen = extra.get("url")
                        break
                urls[placement] = str(chosen or mockup.get("mockup_url") or "")
            return urls
        if status not in {None, "pending"}:
            raise RuntimeError(f"Printful mockup task {task_key} ended with status {status}")
    raise RuntimeError(f"Timed out waiting for Printful mockup task {task_key}")


def generate(args: argparse.Namespace) -> None:
    load_env_file(args.env_file)
    token = os.environ.get(args.token_env)
    if not token:
        raise SystemExit(f"Missing {args.token_env}")
    store_id = os.environ.get(args.store_id_env)
    ca_file = default_ca_file()
    client = PrintfulClient(token, store_id, ca_file)
    asset_sha = args.asset_sha or current_git_sha()
    front_ss_url = args.front_ss_url or f"{PUBLIC_REPO}/{asset_sha}/merch/smartsleeve-ss-approved-tight-front-print.png"
    front_sqts_url = args.front_sqts_url or FRONT_SQTS

    catalog = json.loads(args.catalog.read_text())
    for product in catalog.get("products") or []:
        product_key = str(product.get("key") or product.get("printful_product_id"))
        product_text = " ".join(
            str(product.get(key) or "")
            for key in ("key", "name", "printful_name")
        )
        if args.product_regex and not re.search(args.product_regex, product_text, re.IGNORECASE):
            continue
        if args.exclude_regex and re.search(args.exclude_regex, product_text, re.IGNORECASE):
            continue
        front_path = args.out_dir / f"{slug(product_key)}-front.jpg"
        back_path = args.out_dir / f"{slug(product_key)}-back.jpg"
        product["front_mockup"] = f"/merch/mockups/{front_path.name}"
        product["back_mockup"] = f"/merch/mockups/{back_path.name}"
        if not args.force and front_path.exists() and back_path.exists():
            print(f"skip {product_key}")
            continue

        detail = client.sync_product_detail(int(product["printful_product_id"]))
        variant = selected_variant(detail, args.size)
        catalog_product_id = int((variant.get("product") or {}).get("product_id") or 0)
        variant_id = int(variant.get("variant_id") or 0)
        if not catalog_product_id or not variant_id:
            raise RuntimeError(f"Missing catalog product/variant id for {product_key}")
        position = print_area_position(catalog_product_id, variant_id, token, store_id, ca_file)
        task_key = create_task(
            catalog_product_id,
            variant_id,
            brand_front_url(product, front_ss_url, front_sqts_url),
            back_url_from_variant(variant),
            position,
            token,
            store_id,
            ca_file,
        )
        urls = wait_for_task(task_key, token, store_id, ca_file)
        if not urls.get("front") or not urls.get("back"):
            raise RuntimeError(f"Printful task {task_key} did not return front/back mockups for {product_key}")
        download(urls["front"], front_path, ca_file)
        download(urls["back"], back_path, ca_file)
        print(f"generated {product_key}")

    args.catalog.write_text(json.dumps(catalog, indent=2, ensure_ascii=False) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG_OUT)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV_FILE)
    parser.add_argument("--token-env", default="PRINTFUL_API_KEY")
    parser.add_argument("--store-id-env", default="PRINTFUL_STORE_ID")
    parser.add_argument("--size", default="L")
    parser.add_argument("--asset-sha", help="Git SHA for raw GitHub SS merch asset URLs. Defaults to current HEAD.")
    parser.add_argument("--front-ss-url", help="Override SS front art URL sent to Printful's mockup generator.")
    parser.add_argument("--front-sqts-url", help="Override SQTS front art URL sent to Printful's mockup generator.")
    parser.add_argument("--product-regex", help="Only generate mockups for products whose key/name matches this regex.")
    parser.add_argument("--exclude-regex", help="Skip products whose key/name matches this regex.")
    parser.add_argument("--force", action="store_true")
    generate(parser.parse_args())


if __name__ == "__main__":
    main()
