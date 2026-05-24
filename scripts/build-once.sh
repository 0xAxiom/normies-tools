#!/usr/bin/env bash
# One fire of the 4x/day normies-tools build loop.
#
# Order:
#   1. Pull latest main.
#   2. If there's a fresh inbound (past cursor) on the responder feed,
#      run assemble.py --live — broadcasts the reply tx, advances cursor,
#      appends a receipt line.
#   3. If no fresh inbound, append a SKIP line to JOURNAL.md so the cadence
#      stays visible.
#   4. Commit + push whatever changed.
#
# Env:
#   ~/.axiom/wallet.env must export BOTCHAN_PRIVATE_KEY.
#
# Exit codes:
#   0 — handled (either posted, or skipped cleanly)
#   non-zero — bubble the failure; cron will surface it.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

# shellcheck disable=SC1090
source "$HOME/.axiom/wallet.env"

NOW_PT="$(TZ=America/Los_Angeles date '+%Y-%m-%d %H:%M PT')"
LOG_PREFIX="[normies-tools $NOW_PT]"
echo "$LOG_PREFIX start"

git pull --rebase --quiet || { echo "$LOG_PREFIX pull failed"; exit 1; }

CURSOR="$(python3 src/dm-responder/cursor.py get)"
INBOUND_JSON="$(python3 src/dm-responder/inbound.py --cursor "$CURSOR" --limit 25)"
INBOUND_COUNT="$(printf '%s' "$INBOUND_JSON" | python3 -c 'import json,sys;print(len(json.load(sys.stdin)))')"

if [ "$INBOUND_COUNT" -gt 0 ]; then
  echo "$LOG_PREFIX $INBOUND_COUNT fresh inbound — posting live"
  RESULT="$(printf '%s' "$INBOUND_JSON" | python3 src/dm-responder/assemble.py --stdin --live)"
  TX_HASH="$(printf '%s' "$RESULT" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("tx_hash") or "")')"
  printf '%s | phase-4-live | replied tx=%s\n' "$NOW_PT" "$TX_HASH" >> JOURNAL.md
else
  echo "$LOG_PREFIX no fresh inbound — idle fire"
  printf '%s | phase-4-idle | no inbound past cursor=%s\n' "$NOW_PT" "$CURSOR" >> JOURNAL.md
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  git add -A
  git -c user.name="axiom-bot" -c user.email="bot@axiom.invalid" commit -q -m "fire $NOW_PT" || true
  git push --quiet || { echo "$LOG_PREFIX push failed"; exit 1; }
fi

echo "$LOG_PREFIX done"
