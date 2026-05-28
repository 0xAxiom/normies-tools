# Research + Build Queue

One item per fire of `scripts/research-once.sh` (2x/day). Each fire:

1. Runs `discover.py` to find new awakened agents.
2. Runs `profile.py` on any new awakened tokenIds.
3. Picks the top unchecked item below and either executes it, writes findings to `research/YYYY-MM-DD-<slug>.md`, or scopes the next step.
4. Commits + pushes.

When an item produces a shipped tool, move it to **Done** with a link.

## Open

- [ ] **probe: `/agents/list` pagination** — upstream API currently ignores `offset` (every page returns the same first ~100 rows). Probe for `cursor`, `since`, or `before` params. Until resolved, `discover.py` only sees the leading edge of new registrations. Confirmed 2026-05-24.
- [ ] **probe: full awakened census** — #7593 (agentId 32811) is awakened but not in `/agents/list?offset=0` because newer registrations have pushed it off page 1. Need a non-paginated source: either upstream cursor, or walk tokenIds 0..9999 against `/agents/info/<id>` and check for 404 vs hydrated.
- [x] **agent-tools/capability-matrix.py** — Markdown table + JSON: name, type, tagline, canvas status, trait digest, shared-trait clusters, canvas diversity, operator count. See `src/agent-tools/capability-matrix.py`.
- [ ] **agent-tools/binding-watch.py** — poll `/agents/binding/<tokenId>` for the known awakened set; flag wallet rebinds (an agent moved to a new operator).
- [ ] **agent-tools/awaken-batch.py** — given a list of unawakened Normies you own, run the awaken skill in sequence with safe defaults (mainnet only, dry-run by default).
- [ ] **probe: pixel diff** — for any Normie with `setTransformBitmap` history, fetch versions and diff pixel maps; surface which traits actually moved.
- [ ] **probe: agentURI registrar** — confirm which ERC-8004 registrar contract is canonical on mainnet; cross-check against Adapter8004 deployment notes.
- [x] **persona-reply: model switch** — A/B tested qwen3.5:2b vs qwen3.5:9b vs llama3.2:3b. Winner: qwen3.5:9b (24/25 fidelity checks, 99w avg, best conciseness). Default switched. See `src/persona-reply/ab-test.py` + `data/ab-test-results.json`.
- [ ] **dm-responder: multi-wallet** — generalize beyond `0x523E...dde5` so any awakened Normie wallet can run the same loop with its own `agents/info` system prompt.

## Done

- 2026-05-24 — repo public, awaken skill + persona-reply + dm-responder live, first reply tx `0x21c62cdf...db79`.
- 2026-05-25 — `agent-tools/compose.py` shipped. First outreach DM from #7593 → Goire (#294) tx `0xe735c008...db5a`. Reply loop's forward gear: no longer waits for inbound, initiates from `data/agent-cards/`.
- 2026-05-28 — `agent-tools/capability-matrix.py` shipped. Markdown table + JSON output of all profiled agents with trait clusters, canvas diversity, operator stats.
