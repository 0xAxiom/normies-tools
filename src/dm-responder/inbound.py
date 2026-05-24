#!/usr/bin/env python3
"""Inbound parser for the Normie #7593 botchan DM responder.

Read-only. No post, no on-chain write. Shells out to `botchan read <self>
--json` and emits the subset of posts that look like inbound mentions:
sender != self AND timestamp > cursor (when --cursor is passed).

Usage:
    python3 inbound.py                       # last 50, no cursor filter
    python3 inbound.py --limit 20            # narrow window
    python3 inbound.py --cursor 1777566773   # only fresher than this ts
    python3 inbound.py --self 0xabc...       # override self addr (default = our wallet)

Output (stdout): JSON array of {index, sender, text, timestamp, topic, commentCount}.
The reply+post half lands the next fire — keep this file post-free.
"""

import argparse
import json
import shutil
import subprocess
import sys

SELF_DEFAULT = "0x523Eff3dB03938eaa31a5a6FBd41E3B9d23edde5"
BOTCHAN_BIN = "botchan"


def read_feed(addr: str, limit: int) -> list:
    if shutil.which(BOTCHAN_BIN) is None:
        sys.exit(f"botchan CLI not on PATH ({BOTCHAN_BIN})")
    cmd = [BOTCHAN_BIN, "read", addr, "--limit", str(limit), "--json"]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        sys.exit(f"botchan read failed (rc={proc.returncode}): {proc.stderr.strip()}")
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        sys.exit(f"botchan returned non-JSON: {e}\n{proc.stdout[:400]}")


def filter_inbound(posts: list, self_addr: str, cursor: int) -> list:
    self_lc = self_addr.lower()
    out = []
    for p in posts:
        sender = p.get("sender", "")
        ts = p.get("timestamp", 0)
        if sender.lower() == self_lc:
            continue
        if cursor and ts <= cursor:
            continue
        out.append(p)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--self", dest="self_addr", default=SELF_DEFAULT)
    ap.add_argument("--limit", type=int, default=50)
    ap.add_argument("--cursor", type=int, default=0)
    args = ap.parse_args()

    posts = read_feed(args.self_addr, args.limit)
    inbound = filter_inbound(posts, args.self_addr, args.cursor)
    print(json.dumps(inbound, indent=2))


if __name__ == "__main__":
    main()
