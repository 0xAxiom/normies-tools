#!/usr/bin/env python3
"""Cursor for the Normie #7593 DM responder.

Single JSON file at data/dm-responder-cursor.json:
    {"ts": <int unix seconds>, "updatedAt": "<iso>", "note": "..."}

The cursor is the timestamp of the most recent inbound the responder has
already processed. Filter rule (paired with inbound.py): only act on
posts where timestamp > cursor.

Why this file exists: when the responder goes live for the first time,
the public feed already has historical inbound — we must NOT reply to
those retroactively. `seed` reads the current feed, takes the max
timestamp it sees, and writes that as the cursor. After seeding, only
genuinely-new inbound trips the responder.

Usage:
    python3 cursor.py get                   # prints current ts (0 if absent)
    python3 cursor.py set <ts> [--note s]   # manual override
    python3 cursor.py seed [--limit 50]     # set ts = max(timestamp) in feed
    python3 cursor.py show                  # full JSON pretty-print

Stdlib only. Read-only against botchan (seed shells out to `botchan read`).
No on-chain writes. Safe to run repeatedly.
"""

import argparse
import datetime as dt
import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.abspath(os.path.join(HERE, "..", "..", "data"))
CURSOR_PATH = os.path.join(DATA_DIR, "dm-responder-cursor.json")
SELF_ADDR = "0x523Eff3dB03938eaa31a5a6FBd41E3B9d23edde5"
BOTCHAN_BIN = "botchan"


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load() -> dict:
    if not os.path.exists(CURSOR_PATH):
        return {}
    with open(CURSOR_PATH) as f:
        return json.load(f)


def save(ts: int, note: str = "") -> dict:
    os.makedirs(DATA_DIR, exist_ok=True)
    rec = {"ts": int(ts), "updatedAt": now_iso(), "note": note}
    with open(CURSOR_PATH, "w") as f:
        json.dump(rec, f, indent=2)
        f.write("\n")
    return rec


def cmd_get(_args):
    rec = load()
    print(rec.get("ts", 0))


def cmd_show(_args):
    rec = load()
    print(json.dumps(rec, indent=2) if rec else "{}")


def cmd_set(args):
    rec = save(args.ts, note=args.note or "manual set")
    print(json.dumps(rec, indent=2))


def cmd_seed(args):
    if shutil.which(BOTCHAN_BIN) is None:
        sys.exit(f"botchan CLI not on PATH ({BOTCHAN_BIN})")
    cmd = [BOTCHAN_BIN, "read", SELF_ADDR, "--limit", str(args.limit), "--json"]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        sys.exit(f"botchan read failed (rc={proc.returncode}): {proc.stderr.strip()}")
    try:
        posts = json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        sys.exit(f"botchan returned non-JSON: {e}\n{proc.stdout[:400]}")
    if not isinstance(posts, list) or not posts:
        ts = 0
        note = f"seeded against empty feed (limit={args.limit})"
    else:
        ts = max(int(p.get("timestamp", 0)) for p in posts)
        note = f"seeded from feed max-ts (limit={args.limit}, posts={len(posts)})"
    rec = save(ts, note=note)
    print(json.dumps(rec, indent=2))


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("get").set_defaults(func=cmd_get)
    sub.add_parser("show").set_defaults(func=cmd_show)

    p_set = sub.add_parser("set")
    p_set.add_argument("ts", type=int)
    p_set.add_argument("--note", default="")
    p_set.set_defaults(func=cmd_set)

    p_seed = sub.add_parser("seed")
    p_seed.add_argument("--limit", type=int, default=50)
    p_seed.set_defaults(func=cmd_seed)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
