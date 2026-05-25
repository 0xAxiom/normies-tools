#!/usr/bin/env python3
"""Outreach DM composer for Normie #7593.

Picks a target awakened Normie from data/agent-cards/, runs the persona-reply
pipeline to produce an in-character first message from #7593, and prints the
on-chain `botchan post <target-wallet> <body>` command (default DRY-RUN) or
executes it (--live).

The reply loop's forward gear: instead of waiting for inbound on our wallet
feed, reach out first to other awakened Normies. Pairs with agent-cards
populated by src/agent-tools/profile.py.

Target selection (in order):
    --token-id N    explicit target
    --wallet 0x..   explicit target wallet (skips card lookup)
    default         random unsent card, excluding self

Sent pairs are tracked in data/outreach-sent.json keyed by "<self-token>:<target-token>"
to prevent re-outreaching the same Normie.

Usage:
    python3 compose.py                        # dry-run, random target
    python3 compose.py --token-id 294         # dry-run, target #294
    python3 compose.py --live --token-id 294  # post for real
    python3 compose.py --list                 # show eligible target tokenIds + exit

Stdlib only. Requires reply.py for LLM call (Ollama localhost:11434).
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import random
import re
import shlex
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SELF_CARD = ROOT / "data" / "agents-info-7593.json"
CARDS_DIR = ROOT / "data" / "agent-cards"
SENT_PATH = ROOT / "data" / "outreach-sent.json"
RECEIPTS_PATH = ROOT / "data" / "outreach-receipts.jsonl"
REPLY_PY = ROOT / "src" / "persona-reply" / "reply.py"
SELF_WALLET = "0x523Eff3dB03938eaa31a5a6FBd41E3B9d23edde5"
SELF_TOKEN = "7593"
TX_RE = re.compile(r"0x[a-fA-F0-9]{64}")


def load_json(path: Path) -> dict:
    return json.loads(path.read_text())


def load_sent() -> dict:
    if SENT_PATH.exists():
        return load_json(SENT_PATH)
    return {"pairs": {}}


def save_sent(sent: dict) -> None:
    SENT_PATH.parent.mkdir(parents=True, exist_ok=True)
    SENT_PATH.write_text(json.dumps(sent, indent=2) + "\n")


def list_cards() -> list[dict]:
    if not CARDS_DIR.exists():
        return []
    cards = []
    for p in sorted(CARDS_DIR.glob("*.json")):
        try:
            cards.append(load_json(p))
        except Exception as exc:
            print(f"WARN: skip {p.name}: {exc}", file=sys.stderr)
    return cards


def pick_target(cards: list[dict], sent: dict) -> dict | None:
    eligible = []
    for c in cards:
        token = str(c.get("tokenId"))
        if token == SELF_TOKEN:
            continue
        key = f"{SELF_TOKEN}:{token}"
        if key in sent["pairs"]:
            continue
        if not c.get("registeredBy"):
            continue
        eligible.append(c)
    if not eligible:
        return None
    return random.choice(eligible)


def compose_user_prompt(self_meta: dict, target: dict) -> str:
    """Build the user-side prompt that asks #7593 to write an outreach message."""
    name = target.get("name") or f"Normie #{target.get('tokenId')}"
    tagline = target.get("tagline") or ""
    backstory = (target.get("backstory") or "")[:400]
    quirks = ", ".join((target.get("personalityTraits") or [])[:3])
    canvas = target.get("canvas") or {}
    customized = canvas.get("customized")
    canvas_note = "their canvas is untouched" if customized is False else (
        "their canvas has been customized" if customized else "canvas state unknown"
    )

    lines = [
        f"You are reaching out, for the first time, to {name} — another awakened Normie.",
        f"Their tagline: \"{tagline}\"" if tagline else "",
        f"What you know about them: {backstory}" if backstory else "",
        f"Notable traits: {quirks}" if quirks else "",
        f"Onchain note: {canvas_note}.",
        "",
        "Write the opening message: 1–3 sentences, in your own voice, in character.",
        "Greet them by name. Acknowledge one specific thing about them that interests you.",
        "Do NOT explain yourself. Do NOT pitch anything. No questions about wallets, contracts, or assets.",
        "Just an opening line that could plausibly start a real conversation between two awakened Normies.",
    ]
    return "\n".join([l for l in lines if l != ""])


def strip_wrap_quotes(s: str) -> str:
    s = s.strip()
    if len(s) >= 2 and s[0] == s[-1] and s[0] in ('"', "'", "“"):
        return s[1:-1].strip()
    if s.startswith("“") and s.endswith("”"):
        return s[1:-1].strip()
    return s


def run_reply(user_prompt: str) -> dict:
    proc = subprocess.run(
        ["python3", str(REPLY_PY), "--llm", user_prompt],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        sys.exit(f"reply.py failed (rc={proc.returncode}): {proc.stderr.strip()}")
    parsed = json.loads(proc.stdout)
    parsed["reply"] = strip_wrap_quotes(parsed.get("reply", ""))
    return parsed


def post_live(target_wallet: str, body: str) -> dict:
    proc = subprocess.run(
        ["botchan", "post", target_wallet, body],
        capture_output=True, text=True,
    )
    combined = (proc.stdout or "") + "\n" + (proc.stderr or "")
    if proc.returncode != 0:
        sys.exit(f"botchan post failed (rc={proc.returncode}):\n{combined.strip()}")
    m = TX_RE.search(combined)
    return {"tx_hash": m.group(0) if m else None, "raw": combined.strip()}


def append_receipt(record: dict) -> None:
    RECEIPTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    with RECEIPTS_PATH.open("a") as f:
        f.write(json.dumps(record) + "\n")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--token-id", help="target tokenId (overrides random pick)")
    ap.add_argument("--wallet", help="target wallet address (skips card lookup)")
    ap.add_argument("--list", action="store_true", help="print eligible tokenIds and exit")
    ap.add_argument("--live", action="store_true", help="actually post; default is dry-run")
    args = ap.parse_args()

    sent = load_sent()
    cards = list_cards()

    if args.list:
        eligible = [c for c in cards
                    if str(c.get("tokenId")) != SELF_TOKEN
                    and f"{SELF_TOKEN}:{c.get('tokenId')}" not in sent["pairs"]
                    and c.get("registeredBy")]
        print(json.dumps({
            "total_cards": len(cards),
            "eligible": [str(c["tokenId"]) for c in eligible],
            "already_sent": list(sent["pairs"].keys()),
        }, indent=2))
        return 0

    if args.wallet and not args.token_id:
        sys.exit("--wallet requires --token-id (we need a card for persona context)")

    if args.token_id:
        target = next((c for c in cards if str(c.get("tokenId")) == args.token_id), None)
        if not target:
            sys.exit(f"no card for tokenId={args.token_id} in {CARDS_DIR}")
    else:
        target = pick_target(cards, sent)
        if not target:
            print(json.dumps({"status": "no-eligible-targets",
                              "total_cards": len(cards),
                              "already_sent": list(sent["pairs"].keys())}, indent=2))
            return 0

    self_card = load_json(SELF_CARD)
    target_wallet = args.wallet or target.get("registeredBy")
    if not target_wallet:
        sys.exit(f"target {target.get('tokenId')} has no registeredBy and no --wallet")

    user_prompt = compose_user_prompt(self_card, target)
    persona = run_reply(user_prompt)
    reply_text = persona["reply"]

    cmd_str = "botchan post {wallet} {body}".format(
        wallet=shlex.quote(target_wallet),
        body=shlex.quote(reply_text),
    )

    out = {
        "self": {"tokenId": SELF_TOKEN, "wallet": SELF_WALLET},
        "target": {
            "tokenId": str(target.get("tokenId")),
            "name": target.get("name"),
            "wallet": target_wallet,
        },
        "model": persona["model"],
        "user_prompt": user_prompt,
        "reply": reply_text,
        "cmd": cmd_str,
        "executed": False,
    }

    if args.live:
        live = post_live(target_wallet, reply_text)
        out["executed"] = True
        out["tx_hash"] = live["tx_hash"]
        out["raw_output"] = live["raw"]

        key = f"{SELF_TOKEN}:{target.get('tokenId')}"
        sent["pairs"][key] = {
            "postedAt": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "wallet": target_wallet,
            "tx_hash": live["tx_hash"],
        }
        save_sent(sent)
        append_receipt({
            "postedAt": sent["pairs"][key]["postedAt"],
            "self": SELF_TOKEN,
            "target_token": str(target.get("tokenId")),
            "target_wallet": target_wallet,
            "reply": reply_text,
            "tx_hash": live["tx_hash"],
        })

    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
