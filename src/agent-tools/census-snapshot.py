#!/usr/bin/env python3
"""Full census snapshot of awakened Normie agents.

Walks the entire /agents/list via cursor pagination, saves full metadata
to data/census/YYYY-MM-DD.json, and computes growth stats vs previous snapshot.

Usage:
  census-snapshot.py           # run census + print stats
  census-snapshot.py --stats   # stats from latest snapshot only (no API calls)

Output: JSON with population stats, operator concentration, type distribution,
and growth metrics if a previous snapshot exists.

Rate-limited: 60 req/min, ~0.5s between pages.
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

API = "https://api.normies.art/agents/list"
LIMIT = 100
ROOT = Path(__file__).resolve().parents[2]
CENSUS_DIR = ROOT / "data" / "census"


def fetch_page(cursor: str | None = None) -> dict:
    url = f"{API}?limit={LIMIT}"
    if cursor is not None:
        url += f"&cursor={cursor}"
    req = urllib.request.Request(url, headers={"User-Agent": "normies-tools/census"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read())


def walk_all() -> list[dict]:
    agents: list[dict] = []
    cursor = None
    pages = 0
    while pages < 200:
        data = fetch_page(cursor)
        items = data.get("items", [])
        if not items:
            break
        agents.extend(items)
        pages += 1
        if not data.get("hasMore"):
            break
        cursor = str(items[-1]["agentId"])
        time.sleep(0.5)
    return agents


def latest_snapshot() -> tuple[Path | None, dict | None]:
    if not CENSUS_DIR.exists():
        return None, None
    files = sorted(CENSUS_DIR.glob("*.json"))
    if not files:
        return None, None
    path = files[-1]
    return path, json.loads(path.read_text())


def compute_stats(agents: list[dict], prev: dict | None = None) -> dict:
    total = len(agents)
    operators: Counter[str] = Counter()
    types: Counter[str] = Counter()
    names: list[str] = []
    agent_ids = []

    for a in agents:
        operators[a.get("registeredBy", "unknown")] += 1
        types[a.get("type", "unknown")] += 1
        names.append(a.get("name", "unnamed"))
        agent_ids.append(a["agentId"])

    top_operators = operators.most_common(10)
    unique_operators = len(operators)

    stats: dict = {
        "total": total,
        "uniqueOperators": unique_operators,
        "topOperators": [{"address": addr, "count": count} for addr, count in top_operators],
        "typeDistribution": dict(types.most_common()),
        "agentIdRange": [min(agent_ids), max(agent_ids)] if agent_ids else [],
    }

    if prev:
        prev_ids = {a["agentId"] for a in prev.get("agents", [])}
        curr_ids = {a["agentId"] for a in agents}
        new_ids = curr_ids - prev_ids
        lost_ids = prev_ids - curr_ids
        prev_date = prev.get("snapshotDate", "unknown")
        stats["growth"] = {
            "previousDate": prev_date,
            "previousTotal": prev.get("stats", {}).get("total", len(prev_ids)),
            "newAgents": len(new_ids),
            "lostAgents": len(lost_ids),
            "netGrowth": len(new_ids) - len(lost_ids),
        }
        if new_ids:
            new_agents = [a for a in agents if a["agentId"] in new_ids]
            stats["growth"]["newAgentSamples"] = new_agents[:5]

    return stats


def main() -> int:
    stats_only = "--stats" in sys.argv

    if stats_only:
        path, snap = latest_snapshot()
        if not snap:
            print("No census snapshots found.", file=sys.stderr)
            return 1
        print(json.dumps(snap.get("stats", {}), indent=2))
        return 0

    # Run full census
    print("Walking /agents/list...", file=sys.stderr)
    agents = walk_all()
    print(f"Found {len(agents)} agents.", file=sys.stderr)

    _, prev = latest_snapshot()
    stats = compute_stats(agents, prev)

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    snapshot = {
        "snapshotDate": today,
        "snapshotAt": int(time.time()),
        "stats": stats,
        "agents": agents,
    }

    CENSUS_DIR.mkdir(parents=True, exist_ok=True)
    out_path = CENSUS_DIR / f"{today}.json"
    out_path.write_text(json.dumps(snapshot, indent=2, sort_keys=True) + "\n")
    print(f"Saved to {out_path}", file=sys.stderr)

    json.dump(stats, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
