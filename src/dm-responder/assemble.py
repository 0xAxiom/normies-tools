#!/usr/bin/env python3
"""Reply-assembler for the Normie #7593 botchan DM responder.

End-to-end persona pipeline. Given one inbound candidate, runs it through
../persona-reply/reply.py --llm and either prints the on-chain `botchan
comment` call (default DRY-RUN) or executes it (--live).

Two input modes:
    --stdin                     read a single inbound JSON object (or array;
                                first element wins) from stdin
    --text "..." --sender 0x.. --ts <unix-ts>
                                supply the inbound fields directly

Flags:
    --live                      actually execute the botchan comment; on
                                success advance the cursor and append a
                                receipt line to data/dm-responder-receipts.jsonl

Output (stdout): JSON with {inbound, persona, model, reply, cmd, executed,
                            tx_hash?, raw_output?}.
"""

import argparse
import json
import os
import re
import shlex
import subprocess
import sys
import datetime as dt

HERE = os.path.dirname(os.path.abspath(__file__))
REPLY_PY = os.path.abspath(os.path.join(HERE, "..", "persona-reply", "reply.py"))
CURSOR_PY = os.path.abspath(os.path.join(HERE, "cursor.py"))
RECEIPTS_PATH = os.path.abspath(os.path.join(HERE, "..", "..", "data", "dm-responder-receipts.jsonl"))
SELF_DEFAULT = "0x523Eff3dB03938eaa31a5a6FBd41E3B9d23edde5"
TX_RE = re.compile(r"0x[a-fA-F0-9]{64}")


def load_inbound(args) -> dict:
    if args.stdin:
        raw = sys.stdin.read().strip()
        if not raw:
            sys.exit("--stdin: empty stdin")
        data = json.loads(raw)
        if isinstance(data, list):
            if not data:
                sys.exit("--stdin: empty array, nothing to reply to")
            return data[0]
        return data
    if not (args.text and args.sender and args.ts):
        sys.exit("need either --stdin or all of --text/--sender/--ts")
    return {"sender": args.sender, "timestamp": args.ts, "text": args.text}


def run_reply(text: str) -> dict:
    proc = subprocess.run(
        ["python3", REPLY_PY, "--llm", text],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        sys.exit(f"reply.py failed (rc={proc.returncode}): {proc.stderr.strip()}")
    return json.loads(proc.stdout)


def post_live(feed: str, parent: str, body: str) -> dict:
    """Execute the on-chain comment. Returns {tx_hash, raw_stdout, raw_stderr}."""
    proc = subprocess.run(
        ["botchan", "comment", feed, parent, body],
        capture_output=True, text=True,
    )
    combined = (proc.stdout or "") + "\n" + (proc.stderr or "")
    if proc.returncode != 0:
        sys.exit(f"botchan comment failed (rc={proc.returncode}):\n{combined.strip()}")
    m = TX_RE.search(combined)
    tx_hash = m.group(0) if m else None
    return {"tx_hash": tx_hash, "raw": combined.strip()}


def advance_cursor(ts: int, note: str) -> None:
    proc = subprocess.run(
        ["python3", CURSOR_PY, "set", str(ts), "--note", note],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        sys.stderr.write(f"WARN cursor advance failed (rc={proc.returncode}): {proc.stderr.strip()}\n")


def append_receipt(record: dict) -> None:
    os.makedirs(os.path.dirname(RECEIPTS_PATH), exist_ok=True)
    with open(RECEIPTS_PATH, "a") as f:
        f.write(json.dumps(record) + "\n")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stdin", action="store_true")
    ap.add_argument("--text")
    ap.add_argument("--sender")
    ap.add_argument("--ts", type=int)
    ap.add_argument("--self", dest="self_addr", default=SELF_DEFAULT)
    ap.add_argument("--live", action="store_true",
                    help="execute botchan comment for real; advance cursor on success")
    args = ap.parse_args()

    inbound = load_inbound(args)
    sender = inbound["sender"]
    ts = inbound["timestamp"]
    text = inbound["text"]

    persona = run_reply(text)
    reply_text = persona["reply"]

    parent = f"{sender}:{ts}"
    cmd_str = "botchan comment {feed} {parent} {body}".format(
        feed=shlex.quote(args.self_addr),
        parent=shlex.quote(parent),
        body=shlex.quote(reply_text),
    )

    out = {
        "inbound": {"sender": sender, "ts": ts, "text": text},
        "persona": persona["meta"],
        "model": persona["model"],
        "reply": reply_text,
        "cmd": cmd_str,
        "executed": False,
    }

    if args.live:
        live = post_live(args.self_addr, parent, reply_text)
        out["executed"] = True
        out["tx_hash"] = live["tx_hash"]
        out["raw_output"] = live["raw"]
        advance_cursor(ts, f"posted reply to {sender}:{ts} tx={live['tx_hash']}")
        append_receipt({
            "postedAt": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "inbound": out["inbound"],
            "reply": reply_text,
            "tx_hash": live["tx_hash"],
            "feed": args.self_addr,
            "parent": parent,
        })

    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
