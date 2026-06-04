#!/usr/bin/env bash
# One fire of the 2x/day normies-tools research + build loop.
#
# Order:
#   1. Pull latest main.
#   2. discover.py — scan /agents/list, dedupe vs data/agents-known.json.
#   3. profile.py — fetch /agents/info/<tokenId> for any new awakened agents.
#   4. watchlist.mjs check — snapshot watched Normies, alert Telegram on changes.
#   5. Append a one-line ledger entry to JOURNAL.md with counts.
#   6. Commit + push whatever changed.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

NOW_PT="$(TZ=America/Los_Angeles date '+%Y-%m-%d %H:%M PT')"
LOG_PREFIX="[research $NOW_PT]"
echo "$LOG_PREFIX start"

# RPC keys for on-chain watchlist checks
export INFURA_API_KEY
INFURA_API_KEY="$(security find-generic-password -a "$USER" -s openclaw.INFURA_API_KEY -w 2>/dev/null || true)"
export BASE_RPC_URL
BASE_RPC_URL="$(security find-generic-password -a "$USER" -s openclaw.BASE_RPC_URL -w 2>/dev/null || true)"

# Telegram for watchlist change alerts
TG_BOT_TOKEN="$(security find-generic-password -a "$USER" -s openclaw.TELEGRAM_BOT_TOKEN -w 2>/dev/null || true)"
TG_CHAT_ID="$(security find-generic-password -a "$USER" -s openclaw.TELEGRAM_CHAT_ID -w 2>/dev/null || true)"

tg_send() {
  [ -z "$TG_BOT_TOKEN" ] && return 0
  curl -sf --max-time 10 -X POST \
    "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TG_CHAT_ID}" \
    --data-urlencode "text=$1" \
    > /dev/null 2>&1 || true
}

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

# Watchlist check — snapshot watched Normies and alert on changes
WATCHLIST_CHANGES="0"
if [ -n "$INFURA_API_KEY" ]; then
  WATCHLIST_JSON="$(node src/agent-tools/watchlist.mjs check --json 2>/dev/null || echo '{}')"
  WATCHLIST_CHANGES="$(printf '%s' "$WATCHLIST_JSON" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("changesDetected",0))' 2>/dev/null || echo 0)"
  echo "$LOG_PREFIX watchlist changes=$WATCHLIST_CHANGES"

  if [ "$WATCHLIST_CHANGES" -gt 0 ]; then
    ALERT_LINES="$(printf '%s' "$WATCHLIST_JSON" | python3 -c '
import json, sys
d = json.load(sys.stdin)
lines = [f"Normie watchlist — {d[\"changesDetected\"]} change(s) detected:"]
for entry in d.get("changes", []):
  name = entry.get("name") or f"#{entry[\"tokenId\"]}"
  for c in entry.get("changes", []):
    lines.append(f"  #{entry[\"tokenId\"]} {name}: {c[\"label\"]}")
print("\n".join(lines))
' 2>/dev/null || echo "Normie watchlist: $WATCHLIST_CHANGES change(s) detected")"
    tg_send "$ALERT_LINES"
    printf '%s | watchlist | changes=%s\n' "$NOW_PT" "$WATCHLIST_CHANGES" >> JOURNAL.md
  fi
else
  echo "$LOG_PREFIX watchlist skipped (no INFURA_API_KEY in keychain)"
fi

printf '%s | research | scanned=%s awakened=%s new=%s profiled=%s\n' \
  "$NOW_PT" "$SCANNED" "$TOTAL_AWAKE" "$NEW_COUNT" "$PROFILED" >> JOURNAL.md

if ! git diff --quiet || ! git diff --cached --quiet; then
  git add -A
  git -c user.name="axiom-bot" -c user.email="bot@axiom.invalid" \
    commit -q -m "research $NOW_PT scanned=$SCANNED new=$NEW_COUNT profiled=$PROFILED changes=$WATCHLIST_CHANGES" || true
  git push --quiet || { echo "$LOG_PREFIX push failed"; exit 1; }
fi

echo "$LOG_PREFIX done"
