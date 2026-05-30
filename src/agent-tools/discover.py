#!/usr/bin/env python3
"""Page /agents/list via cursor pagination, dedupe vs known set.

stdout: JSON {"new": [...rows...], "total_awakened": N, "scanned": M}
data/agents-known.json: append-only registry of awakened agentIds we've seen.

Supports two modes:
  --full    Walk the entire agent list (cursor pagination). Use for census.
  (default) Fetch only the leading edge (first page) for incremental discovery.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.request
from pathlib import Path

API = "https://api.normies.art/agents/list"
LIMIT = 100
ROOT = Path(__file__).resolve().parents[2]
KNOWN_PATH = ROOT / "data" / "agents-known.json"


def fetch_page(cursor: str | None = None) -> dict:
    url = f"{API}?limit={LIMIT}"
    if cursor is not None:
        url += f"&cursor={cursor}"
    req = urllib.request.Request(url, headers={"User-Agent": "normies-tools/discover"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read())


def load_known() -> dict:
    if KNOWN_PATH.exists():
        return json.loads(KNOWN_PATH.read_text())
    return {"agentIds": [], "lastScanAt": None}


def save_known(known: dict) -> None:
    KNOWN_PATH.parent.mkdir(parents=True, exist_ok=True)
    KNOWN_PATH.write_text(json.dumps(known, indent=2, sort_keys=True) + "\n")


def main() -> int:
    full_mode = "--full" in sys.argv
    known = load_known()
    seen = set(known["agentIds"])
    new_rows: list[dict] = []
    scanned = 0
    awakened_total = 0
    cursor = None
    pages = 0
    max_pages = 200 if full_mode else 1

    while pages < max_pages:
        try:
            data = fetch_page(cursor)
        except Exception as exc:
            print(f"fetch failed at cursor={cursor}: {exc}", file=sys.stderr)
            break
        items = data.get("items", [])
        if not items:
            break
        scanned += len(items)
        pages += 1
        for row in items:
            awakened_total += 1
            aid = str(row["agentId"])
            if aid in seen:
                continue
            seen.add(aid)
            new_rows.append(row)
        if not data.get("hasMore"):
            break
        cursor = str(items[-1]["agentId"])
        if full_mode:
            time.sleep(0.5)

    known["agentIds"] = sorted(seen, key=int)
    known["lastScanAt"] = int(time.time())
    known["totalAtLastFullScan"] = awakened_total if full_mode else known.get("totalAtLastFullScan")
    save_known(known)

    out = {"new": new_rows, "total_awakened": awakened_total, "scanned": scanned}
    json.dump(out, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
