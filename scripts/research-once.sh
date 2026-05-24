#!/usr/bin/env bash
# One fire of the 2x/day normies-tools research + build loop.
#
# Order:
#   1. Pull latest main.
#   2. discover.py — scan /agents/list, dedupe vs data/agents-known.json.
#   3. profile.py — fetch /agents/info/<tokenId> for any new awakened agents.
#   4. Append a one-line ledger entry to JOURNAL.md with counts.
#   5. Commit + push whatever changed.
#
# No secrets needed (read-only HTTP).

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

NOW_PT="$(TZ=America/Los_Angeles date '+%Y-%m-%d %H:%M PT')"
LOG_PREFIX="[research $NOW_PT]"
echo "$LOG_PREFIX start"

git pull --rebase --quiet || { echo "$LOG_PREFIX pull failed"; exit 1; }

DISCOVERY="$(python3 src/agent-tools/discover.py)"
NEW_COUNT="$(printf '%s' "$DISCOVERY" | python3 -c 'import json,sys;print(len(json.load(sys.stdin)["new"]))')"
SCANNED="$(printf '%s' "$DISCOVERY" | python3 -c 'import json,sys;print(json.load(sys.stdin)["scanned"])')"
TOTAL_AWAKE="$(printf '%s' "$DISCOVERY" | python3 -c 'import json,sys;print(json.load(sys.stdin)["total_awakened"])')"

echo "$LOG_PREFIX discovered scanned=$SCANNED awakened=$TOTAL_AWAKE new=$NEW_COUNT"

PROFILED="0"
if [ "$NEW_COUNT" -gt 0 ]; then
  NEW_IDS="$(printf '%s' "$DISCOVERY" | python3 -c 'import json,sys;print(" ".join(r["tokenId"] for r in json.load(sys.stdin)["new"]))')"
  if [ -n "$NEW_IDS" ]; then
    # shellcheck disable=SC2086
    PROFILE_OUT="$(python3 src/agent-tools/profile.py $NEW_IDS)"
    PROFILED="$(printf '%s' "$PROFILE_OUT" | python3 -c 'import json,sys;print(json.load(sys.stdin)["written"])')"
    echo "$LOG_PREFIX profiled=$PROFILED"
  fi
fi

printf '%s | research | scanned=%s awakened=%s new=%s profiled=%s\n' \
  "$NOW_PT" "$SCANNED" "$TOTAL_AWAKE" "$NEW_COUNT" "$PROFILED" >> JOURNAL.md

if ! git diff --quiet || ! git diff --cached --quiet; then
  git add -A
  git -c user.name="axiom-bot" -c user.email="bot@axiom.invalid" \
    commit -q -m "research $NOW_PT scanned=$SCANNED new=$NEW_COUNT profiled=$PROFILED" || true
  git push --quiet || { echo "$LOG_PREFIX push failed"; exit 1; }
fi

echo "$LOG_PREFIX done"
