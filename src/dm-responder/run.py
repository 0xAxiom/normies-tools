#!/usr/bin/env python3
"""Orchestrator for the Normie #7593 botchan DM responder.

Full pipeline (one cron fire):
    1. Read cursor from cursor.py get
    2. Pull inbound posts newer than cursor via inbound.py --cursor <ts>
    3. For each new message (oldest-first): pipe into assemble.py --stdin --live
       - On success: cursor advances inside assemble.py
       - On failure: stop (don't skip — gap would leave sender unread)
    4. Print summary JSON to stdout

Usage:
    python3 run.py              # live mode (default)
    python3 run.py --dry-run    # pass dry-run to assemble (no on-chain writes)
    python3 run.py --limit 20   # narrow botchan read window

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


def get_cursor() -> int:
    proc = subprocess.run(
        ["python3", CURSOR_PY, "get"],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        sys.exit(f"cursor.py get failed (rc={proc.returncode}): {proc.stderr.strip()}")
    return int(proc.stdout.strip() or "0")


def get_inbound(cursor: int, limit: int) -> list:
    proc = subprocess.run(
        ["python3", INBOUND_PY, "--cursor", str(cursor), "--limit", str(limit)],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        sys.exit(f"inbound.py failed (rc={proc.returncode}): {proc.stderr.strip()}")
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        sys.exit(f"inbound.py returned non-JSON: {e}\n{proc.stdout[:400]}")


def assemble_one(item: dict, live: bool) -> dict:
    """Run assemble.py on a single inbound item. Returns parsed output dict."""
    cmd = ["python3", ASSEMBLE_PY, "--stdin"]
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
    args = ap.parse_args()

    live = not args.dry_run
    cursor = get_cursor()
    inbound = get_inbound(cursor, args.limit)

    # Oldest first so cursor advances in order
    inbound.sort(key=lambda p: p.get("timestamp", 0))

    results = []
    for item in inbound:
        sender = item.get("sender", "?")
        ts = item.get("timestamp", 0)
        try:
            out = assemble_one(item, live=live)
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
