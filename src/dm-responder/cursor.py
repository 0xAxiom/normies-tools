#!/usr/bin/env python3
"""Cursor for the Normie DM responder — supports multiple wallets.

Cursor file per wallet at data/dm-responder-cursor-<addr>.json
(legacy data/dm-responder-cursor.json is used for default wallet).

Usage:
    python3 cursor.py get                        # default wallet
    python3 cursor.py get --self 0xABC...        # specific wallet
    python3 cursor.py set <ts> [--note s]
    python3 cursor.py seed [--limit 50]
    python3 cursor.py show

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
SELF_DEFAULT = "0x523Eff3dB03938eaa31a5a6FBd41E3B9d23edde5"
BOTCHAN_BIN = "botchan"


def cursor_path(self_addr: str) -> str:
    """Per-wallet cursor file. Legacy path for default wallet."""
    if self_addr.lower() == SELF_DEFAULT.lower():
        return os.path.join(DATA_DIR, "dm-responder-cursor.json")
    short = self_addr.lower()[:10]
    return os.path.join(DATA_DIR, f"dm-responder-cursor-{short}.json")


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load(self_addr: str = SELF_DEFAULT) -> dict:
    path = cursor_path(self_addr)
    if not os.path.exists(path):
        return {}
    with open(path) as f:
        return json.load(f)


def save(ts: int, note: str = "", self_addr: str = SELF_DEFAULT) -> dict:
    path = cursor_path(self_addr)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    rec = {"ts": int(ts), "updatedAt": now_iso(), "note": note, "wallet": self_addr}
    with open(path, "w") as f:
        json.dump(rec, f, indent=2)
        f.write("\n")
    return rec


def cmd_get(args):
    rec = load(args.self_addr)
    print(rec.get("ts", 0))


def cmd_show(args):
    rec = load(args.self_addr)
    print(json.dumps(rec, indent=2) if rec else "{}")


def cmd_set(args):
    rec = save(args.ts, note=args.note or "manual set", self_addr=args.self_addr)
    print(json.dumps(rec, indent=2))


def cmd_seed(args):
    if shutil.which(BOTCHAN_BIN) is None:
        sys.exit(f"botchan CLI not on PATH ({BOTCHAN_BIN})")
    addr = args.self_addr
    cmd = [BOTCHAN_BIN, "read", addr, "--limit", str(args.limit), "--json"]
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
    rec = save(ts, note=note, self_addr=addr)
    print(json.dumps(rec, indent=2))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--self", dest="self_addr", default=SELF_DEFAULT,
                    help="wallet address (default: treasury)")
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
