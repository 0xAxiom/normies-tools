#!/usr/bin/env python3
"""Fetch /agents/info/<tokenId>, write card to data/agent-cards/<tokenId>.json.

Usage:
  profile.py <tokenId> [<tokenId> ...]

Skips tokens whose card already exists and is < FRESH_DAYS old.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.request
from pathlib import Path

INFO = "https://api.normies.art/agents/info"
ROOT = Path(__file__).resolve().parents[2]
CARDS_DIR = ROOT / "data" / "agent-cards"
FRESH_SECONDS = 7 * 86400


def fetch_info(token_id: str) -> dict | None:
    url = f"{INFO}/{token_id}"
    req = urllib.request.Request(url, headers={"User-Agent": "normies-tools/research"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read())
    except Exception as exc:
        print(f"info {token_id} failed: {exc}", file=sys.stderr)
        return None


def card_path(token_id: str) -> Path:
    return CARDS_DIR / f"{token_id}.json"


def is_fresh(path: Path) -> bool:
    if not path.exists():
        return False
    age = time.time() - path.stat().st_mtime
    return age < FRESH_SECONDS


def main(argv: list[str]) -> int:
    if not argv:
        print("usage: profile.py <tokenId> [<tokenId> ...]", file=sys.stderr)
        return 2

    CARDS_DIR.mkdir(parents=True, exist_ok=True)
    written = 0
    skipped = 0
    for tid in argv:
        path = card_path(tid)
        if is_fresh(path):
            skipped += 1
            continue
        card = fetch_info(tid)
        if card is None:
            continue
        card["_fetchedAt"] = int(time.time())
        path.write_text(json.dumps(card, indent=2, sort_keys=True) + "\n")
        written += 1
    print(json.dumps({"written": written, "skipped": skipped}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
