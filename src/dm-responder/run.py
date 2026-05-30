#!/usr/bin/env python3
"""Orchestrator for the Normie botchan DM responder — any wallet.

Full pipeline (one cron fire):
    1. Read cursor from cursor.py get --self <addr>
    2. Pull inbound posts newer than cursor via inbound.py --self <addr>
    3. For each new message: pipe into assemble.py --stdin --token-id <id> [--live]
    4. Print summary JSON to stdout

Usage:
    python3 run.py                              # Normie #7593 (default)
    python3 run.py --token-id 294 --self 0x...  # another Normie's wallet
    python3 run.py --dry-run                    # no on-chain writes

Exit codes: 0 = success (0 or more replies sent), 1 = error.
Stdlib only. No on-chain writes except via assemble.py --live.
"""

import argparse
import json
import os
import subprocess
import sys
import datetime as dt

HERE = os.path.dirname(os.path.abspath(__file__))
INBOUND_PY = os.path.join(HERE, "inbound.py")
ASSEMBLE_PY = os.path.join(HERE, "assemble.py")
CURSOR_PY = os.path.join(HERE, "cursor.py")


SELF_DEFAULT = "0x523Eff3dB03938eaa31a5a6FBd41E3B9d23edde5"


def get_cursor(self_addr: str) -> int:
    proc = subprocess.run(
        ["python3", CURSOR_PY, "--self", self_addr, "get"],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        sys.exit(f"cursor.py get failed (rc={proc.returncode}): {proc.stderr.strip()}")
    return int(proc.stdout.strip() or "0")


def get_inbound(cursor: int, limit: int, self_addr: str) -> list:
    proc = subprocess.run(
        ["python3", INBOUND_PY, "--self", self_addr,
         "--cursor", str(cursor), "--limit", str(limit)],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        sys.exit(f"inbound.py failed (rc={proc.returncode}): {proc.stderr.strip()}")
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        sys.exit(f"inbound.py returned non-JSON: {e}\n{proc.stdout[:400]}")


def assemble_one(item: dict, live: bool, token_id: int = 7593) -> dict:
    """Run assemble.py on a single inbound item. Returns parsed output dict."""
    cmd = ["python3", ASSEMBLE_PY, "--stdin", "--token-id", str(token_id)]
    if live:
        cmd.append("--live")
    proc = subprocess.run(
        cmd,
        input=json.dumps(item),
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"assemble.py failed (rc={proc.returncode}): {proc.stderr.strip()}"
        )
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"assemble.py returned non-JSON: {e}\n{proc.stdout[:400]}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true",
                    help="print commands but do not post on-chain")
    ap.add_argument("--limit", type=int, default=50)
    ap.add_argument("--token-id", type=int, default=7593,
                    help="Normie token ID for persona (default: 7593)")
    ap.add_argument("--self", dest="self_addr", default=SELF_DEFAULT,
                    help="wallet address to read inbound from")
    args = ap.parse_args()

    live = not args.dry_run
    cursor = get_cursor(args.self_addr)
    inbound = get_inbound(cursor, args.limit, args.self_addr)

    # Oldest first so cursor advances in order
    inbound.sort(key=lambda p: p.get("timestamp", 0))

    results = []
    for item in inbound:
        sender = item.get("sender", "?")
        ts = item.get("timestamp", 0)
        try:
            out = assemble_one(item, live=live, token_id=args.token_id)
            results.append({
                "status": "ok",
                "sender": sender,
                "ts": ts,
                "executed": out.get("executed", False),
                "tx_hash": out.get("tx_hash"),
                "reply_preview": out.get("reply", "")[:80],
            })
            if live:
                # assemble.py advances cursor on success; no extra step needed
                print(f"  ✓ replied to {sender}:{ts} tx={out.get('tx_hash')}", file=sys.stderr)
        except RuntimeError as e:
            results.append({"status": "error", "sender": sender, "ts": ts, "error": str(e)})
            print(f"  ✗ failed on {sender}:{ts} — stopping: {e}", file=sys.stderr)
            break  # stop on first failure to preserve cursor integrity

    summary = {
        "runAt": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "cursor_before": cursor,
        "inbound_count": len(inbound),
        "processed": len(results),
        "results": results,
        "mode": "live" if live else "dry-run",
    }
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
