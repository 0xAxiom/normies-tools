#!/usr/bin/env python3
"""Emit a Markdown capability matrix from populated agent cards.

Reads data/agent-cards/*.json, produces a summary table with:
  - tokenId, name, type, tagline
  - trait archetype (top 3 personality traits condensed)
  - canvas status (customized/untouched, level, action points, edit count)
  - registration date + registeredBy wallet (truncated)

Also emits trait-cluster analysis: which personality traits recur across agents.

Usage:
    python3 capability-matrix.py                # Markdown to stdout
    python3 capability-matrix.py --json         # structured JSON to stdout
    python3 capability-matrix.py --out FILE     # write Markdown to FILE
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CARDS_DIR = ROOT / "data" / "agent-cards"
SELF_TOKEN = "7593"


def load_cards() -> list[dict]:
    if not CARDS_DIR.exists():
        return []
    cards = []
    for p in sorted(CARDS_DIR.glob("*.json"), key=lambda f: int(f.stem)):
        try:
            cards.append(json.loads(p.read_text()))
        except Exception as exc:
            print(f"WARN: skip {p.name}: {exc}", file=sys.stderr)
    return cards


def trunc_addr(addr: str) -> str:
    if not addr or len(addr) < 12:
        return addr or "?"
    return f"{addr[:6]}...{addr[-4:]}"


def canvas_summary(card: dict) -> str:
    canvas = card.get("canvas") or {}
    customized = canvas.get("customized")
    level = canvas.get("level", "?")
    ap = canvas.get("actionPoints", "?")
    if customized is False:
        return f"untouched (L{level})"
    elif customized is True:
        diff = canvas.get("diff") or {}
        added = diff.get("addedCount", 0)
        removed = diff.get("removedCount", 0)
        return f"edited +{added}/-{removed} (L{level}, {ap}AP)"
    return f"unknown (L{level})"


def trait_digest(card: dict, n: int = 3) -> str:
    traits = card.get("personalityTraits") or []
    condensed = []
    for t in traits[:n]:
        # Take the first clause (before comma) as the headline
        short = t.split(",")[0].strip()
        if len(short) > 50:
            short = short[:47] + "..."
        condensed.append(short)
    return "; ".join(condensed) if condensed else "none"


def reg_date(card: dict) -> str:
    at = card.get("registeredAt") or ""
    return at[:10] if len(at) >= 10 else "?"


def build_matrix(cards: list[dict]) -> str:
    lines = [
        "# Awakened Agent Capability Matrix",
        "",
        f"Population: {len(cards)} profiled agents",
        "",
        "| # | Name | Type | Tagline | Canvas | Traits (top 3) | Registered | Wallet |",
        "|---|------|------|---------|--------|----------------|------------|--------|",
    ]
    for c in cards:
        tid = c.get("tokenId", "?")
        name = c.get("name", "?")
        atype = c.get("type", "?")
        tag = (c.get("tagline") or "")[:40]
        canvas = canvas_summary(c)
        traits = trait_digest(c)
        reg = reg_date(c)
        wallet = trunc_addr(c.get("registeredBy", ""))
        marker = " (ours)" if str(tid) == SELF_TOKEN else ""
        lines.append(f"| {tid}{marker} | {name} | {atype} | {tag} | {canvas} | {traits} | {reg} | {wallet} |")

    # Trait cluster analysis
    trait_counter: Counter[str] = Counter()
    for c in cards:
        for t in c.get("personalityTraits") or []:
            # Normalize: lowercase first clause
            key = t.split(",")[0].strip().lower()
            trait_counter[key] += 1

    shared = [(k, v) for k, v in trait_counter.most_common(20) if v > 1]
    if shared:
        lines.extend([
            "",
            "## Shared Traits",
            "",
            "Traits appearing in 2+ agents:",
            "",
            "| Trait | Count |",
            "|-------|-------|",
        ])
        for trait, count in shared:
            lines.append(f"| {trait} | {count} |")

    # Canvas diversity
    customized_count = sum(1 for c in cards if (c.get("canvas") or {}).get("customized") is True)
    untouched_count = sum(1 for c in cards if (c.get("canvas") or {}).get("customized") is False)
    lines.extend([
        "",
        "## Canvas Diversity",
        "",
        f"- Customized: {customized_count}/{len(cards)}",
        f"- Untouched (purists): {untouched_count}/{len(cards)}",
    ])

    # Unique wallets (distinct holders operating agents)
    wallets = set()
    for c in cards:
        w = c.get("registeredBy")
        if w:
            wallets.add(w.lower())
    lines.extend([
        "",
        "## Operators",
        "",
        f"- Unique registrant wallets: {len(wallets)}",
    ])

    lines.append("")
    return "\n".join(lines)


def build_json(cards: list[dict]) -> dict:
    rows = []
    for c in cards:
        rows.append({
            "tokenId": c.get("tokenId"),
            "name": c.get("name"),
            "type": c.get("type"),
            "tagline": c.get("tagline"),
            "canvas": canvas_summary(c),
            "traits": trait_digest(c),
            "registeredAt": reg_date(c),
            "registeredBy": c.get("registeredBy"),
            "agentId": c.get("agentId"),
        })

    trait_counter: Counter[str] = Counter()
    for c in cards:
        for t in c.get("personalityTraits") or []:
            trait_counter[t.split(",")[0].strip().lower()] += 1

    return {
        "population": len(cards),
        "agents": rows,
        "shared_traits": [{"trait": k, "count": v} for k, v in trait_counter.most_common(20) if v > 1],
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true", help="output JSON instead of Markdown")
    ap.add_argument("--out", help="write to file instead of stdout")
    args = ap.parse_args()

    cards = load_cards()
    if not cards:
        print("no agent cards in data/agent-cards/", file=sys.stderr)
        return 1

    if args.json:
        output = json.dumps(build_json(cards), indent=2) + "\n"
    else:
        output = build_matrix(cards)

    if args.out:
        Path(args.out).write_text(output)
        print(f"wrote {len(output)} bytes to {args.out}", file=sys.stderr)
    else:
        print(output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
