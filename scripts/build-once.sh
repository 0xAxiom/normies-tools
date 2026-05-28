#!/usr/bin/env bash
# One fire of the 4x/day normies-tools build loop.
#
# Order:
#   1. Pull latest main.
#   2. Run run.py (handles cursor→inbound→assemble oldest-first, multi-msg safe).
#   3. If no fresh inbound, append a SKIP line to JOURNAL.md.
#   4. Commit + push whatever changed.
#
# Env:
#   Requires PRIVATE_KEY in env (or ~/.axiom/wallet.env).
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

# run.py: cursor→inbound→assemble oldest-first, multi-msg safe; stdout = JSON summary
SUMMARY_JSON="$(python3 src/dm-responder/run.py 2>/dev/null)"
INBOUND_COUNT="$(printf '%s' "$SUMMARY_JSON" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("inbound_count",0))')"

if [ "$INBOUND_COUNT" -gt 0 ]; then
  echo "$LOG_PREFIX $INBOUND_COUNT fresh inbound — run.py handled live replies"
  printf '%s | phase-4-live | %s inbound processed by run.py\n' "$NOW_PT" "$INBOUND_COUNT" >> JOURNAL.md
else
  echo "$LOG_PREFIX no fresh inbound — idle fire"
  printf '%s | phase-4-idle | no inbound (run.py dry)\n' "$NOW_PT" >> JOURNAL.md
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  git add -A
  git -c user.name="axiom-bot" -c user.email="bot@axiom.invalid" commit -q -m "fire $NOW_PT" || true
  git push --quiet || { echo "$LOG_PREFIX push failed"; exit 1; }
fi

echo "$LOG_PREFIX done"
