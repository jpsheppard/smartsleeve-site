#!/usr/bin/env python3
"""Replace SmartSleeve SS apparel front art on Printful sync variants.

The script intentionally scopes itself to SS tee, muscle tee, and tank products
from the public storefront catalog. It preserves prices, sizes, options, and
back print files while swapping only the SS front print source URL.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import ssl
import subprocess
import time
import urllib.error
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
FRONT_FILENAME = "smartsleeve-ss-approved-tight-front-print.png"
PUBLIC_REPO = "https://raw.githubusercontent.com/jpsheppard/smartsleeve-site"
FRONT_TYPES = {"default", "front", "front_dtf"}
BACK_TYPES = {"back", "back_dtf"}


def current_git_sha() -> str:
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
    method: str,
    body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    headers = {
        "Authorization": f"Bearer {token}",
        "User-Agent": "SmartSleeve Printful SS front-art updater",
    }
    if store_id:
        headers["X-PF-Store-Id"] = store_id
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    context = ssl.create_default_context(cafile=str(ca_file)) if ca_file else None
    request = urllib.request.Request(f"{API_BASE}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=60, context=context) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        text = err.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Printful API {err.code} for {path}: {text}") from err


def is_target_product(product: dict[str, Any]) -> bool:
    text = " ".join(str(product.get(key) or "") for key in ("name", "printful_name", "key")).lower()
    if "sqts" in text:
        return False
    if "ss" not in text:
        return False
    if any(skip in text for skip in ("polo", "fleece", "windbreaker", "jacket", "mousepad", "towel", "bandana")):
        return False
    return any(kind in text for kind in ("tee", "t-shirt", "tank", "muscle"))


def raw_merch_url(sha: str, filename: str) -> str:
    return f"{PUBLIC_REPO}/{sha}/merch/{filename}"


def has_current_front(variant: dict[str, Any], sha: str) -> bool:
    for file in variant.get("files") or []:
        if str(file.get("filename") or "") == FRONT_FILENAME and sha in str(file.get("url") or ""):
            return True
    return False


def build_files_payload(variant: dict[str, Any], sha: str) -> tuple[list[dict[str, Any]], bool]:
    files: list[dict[str, Any]] = []
    replaced_front = False
    front_url = raw_merch_url(sha, FRONT_FILENAME)
    has_back_file = any(str(file.get("type") or "") in BACK_TYPES for file in variant.get("files") or [])

    for file in variant.get("files") or []:
        file_type = str(file.get("type") or "default")
        filename = str(file.get("filename") or "")
        if file_type == "preview":
            continue

        if file_type in FRONT_TYPES and (
            filename == FRONT_FILENAME
            or "smartsleeve-ss-common-front-print" in str(file.get("url") or "")
            or "smartsleeve-ss-approved-tight-front-print" in str(file.get("url") or "")
            or "front" in file_type
        ):
            payload_type = "front" if file_type == "default" and has_back_file else file_type
            files.append(
                {
                    "type": payload_type,
                    "url": front_url,
                    "filename": FRONT_FILENAME,
                    "visible": bool(file.get("visible", True)),
                }
            )
            replaced_front = True
            continue

        if file_type in BACK_TYPES:
            back_url = str(file.get("url") or "")
            if not back_url and filename:
                back_url = raw_merch_url(sha, filename)
            if not back_url:
                raise RuntimeError(f"Cannot preserve back file for variant {variant.get('id')}: {file}")
            files.append(
                {
                    "type": file_type,
                    "url": back_url,
                    "filename": filename,
                    "visible": bool(file.get("visible", True)),
                }
            )
            continue

        if file.get("url"):
            files.append(
                {
                    "type": file_type,
                    "url": str(file["url"]),
                    "filename": filename,
                    "visible": bool(file.get("visible", True)),
                }
            )

    return files, replaced_front


def size_rank(variant: dict[str, Any]) -> tuple[int, str]:
    order = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL"]
    size = str(variant.get("size") or variant.get("name") or "").upper()
    for index, candidate in enumerate(order):
        if re.search(rf"(?<![A-Z0-9]){re.escape(candidate)}(?![A-Z0-9])", size):
            return index, size
    return len(order), size


def update(args: argparse.Namespace) -> None:
    load_env_file(args.env_file)
    token = os.environ.get(args.token_env)
    if not token:
        raise SystemExit(f"Missing {args.token_env}")
    store_id = os.environ.get(args.store_id_env)
    ca_file = default_ca_file()
    client = PrintfulClient(token, store_id, ca_file)
    sha = args.sha or current_git_sha()

    catalog = json.loads(args.catalog.read_text())
    targets = [product for product in catalog.get("products") or [] if is_target_product(product)]
    targets.sort(key=lambda product: int(product.get("printful_product_id") or 0))
    print(f"target_products={len(targets)} sha={sha} apply={args.apply}")

    updates = 0
    for product in targets:
        product_id = int(product["printful_product_id"])
        detail = client.sync_product_detail(product_id)
        sync_product = detail.get("sync_product") or {}
        variants = sorted(detail.get("sync_variants") or [], key=size_rank)
        print(f"product {product_id}: {sync_product.get('name') or product.get('name')} variants={len(variants)}")
        for variant in variants:
            if args.skip_current and has_current_front(variant, sha):
                print(f"  SKIP variant {variant.get('id')} {variant.get('size') or ''} already-current")
                continue
            files, replaced_front = build_files_payload(variant, sha)
            if not replaced_front:
                raise RuntimeError(f"No SS front file found for sync variant {variant.get('id')} {variant.get('name')}")
            body = {"files": files}
            updates += 1
            print(f"  {'PUT' if args.apply else 'DRY'} variant {variant.get('id')} {variant.get('size') or ''} files={len(files)}")
            if args.apply:
                request_json(f"/sync/variant/{int(variant['id'])}", token, store_id, ca_file, "PUT", body)
                time.sleep(args.sleep)

    print(f"{'updated' if args.apply else 'would_update'}={updates}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG_OUT)
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV_FILE)
    parser.add_argument("--token-env", default="PRINTFUL_API_KEY")
    parser.add_argument("--store-id-env", default="PRINTFUL_STORE_ID")
    parser.add_argument("--sha", help="Git SHA to use for raw GitHub art URLs. Defaults to current HEAD.")
    parser.add_argument("--sleep", type=float, default=6.5, help="Delay between live variant updates to respect Printful limits.")
    parser.add_argument("--no-skip-current", dest="skip_current", action="store_false", help="Re-update variants even if they already use the target SHA.")
    parser.set_defaults(skip_current=True)
    parser.add_argument("--apply", action="store_true", help="Apply live Printful updates. Without this, only prints the plan.")
    update(parser.parse_args())


if __name__ == "__main__":
    main()
