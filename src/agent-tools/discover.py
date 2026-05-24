#!/usr/bin/env python3
"""Page /agents/list, filter to awakened agents, dedupe vs known set.

stdout: JSON {"new": [...rows...], "total_awakened": N, "scanned": M}
data/agents-known.json: append-only registry of awakened agentIds we've seen.
"""

from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

API = "https://api.normies.art/agents/list"
PAGE = 100
MAX_PAGES = 50  # 5,000 row ceiling per fire
ROOT = Path(__file__).resolve().parents[2]
KNOWN_PATH = ROOT / "data" / "agents-known.json"


def fetch_page(offset: int, limit: int) -> dict:
    url = f"{API}?limit={limit}&offset={offset}"
    req = urllib.request.Request(url, headers={"User-Agent": "normies-tools/research"})
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
    known = load_known()
    seen = set(known["agentIds"])
    new_rows: list[dict] = []
    scanned = 0
    awakened_total = 0

    for page in range(MAX_PAGES):
        offset = page * PAGE
        try:
            data = fetch_page(offset, PAGE)
        except Exception as exc:
            print(f"fetch failed at offset={offset}: {exc}", file=sys.stderr)
            break
        items = data.get("items", [])
        if not items:
            break
        scanned += len(items)
        for row in items:
            if row.get("type") != "Agent":
                continue
            awakened_total += 1
            aid = str(row["agentId"])
            if aid in seen:
                continue
            seen.add(aid)
            new_rows.append(row)
        if not data.get("hasMore"):
            break

    known["agentIds"] = sorted(seen, key=int)
    import time
    known["lastScanAt"] = int(time.time())
    save_known(known)

    out = {"new": new_rows, "total_awakened": awakened_total, "scanned": scanned}
    json.dump(out, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
