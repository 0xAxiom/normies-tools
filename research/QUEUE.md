# Research + Build Queue

One item per fire of `scripts/research-once.sh` (2x/day). Each fire:

1. Runs `discover.py` to find new awakened agents.
2. Runs `profile.py` on any new awakened tokenIds.
3. Picks the top unchecked item below and either executes it, writes findings to `research/YYYY-MM-DD-<slug>.md`, or scopes the next step.
4. Commits + pushes.

When an item produces a shipped tool, move it to **Done** with a link.

## Open

- [x] **probe: `/agents/list` pagination** — SOLVED: `cursor=<agentId>` returns items with agentId < cursor. `offset` is ignored. See `research/2026-05-30-cursor-pagination.md`.
- [x] **probe: full awakened census** — SOLVED via cursor pagination. 1,116 awakened agents found across agentId range 32340-34029. `discover.py --full` walks all pages. See `research/2026-05-30-cursor-pagination.md`.
- [x] **agent-tools/capability-matrix.py** — Markdown table + JSON: name, type, tagline, canvas status, trait digest, shared-trait clusters, canvas diversity, operator count. See `src/agent-tools/capability-matrix.py`.
- [x] **agent-tools/binding-watch.mjs** — polls Adapter8004 for known awakened set; detects new awakenings, owner transfers, controller shifts, unbindings. Diffs vs previous state. See `src/agent-tools/binding-watch.mjs`.
- [x] **agent-tools/trait-reader.mjs** — reads ERC-7496 dynamic traits on-chain + API, supports `--check-gate` for TraitGatedPredicate access verification. See `src/agent-tools/trait-reader.mjs`.
- [x] **agent-tools/awaken-batch.mjs** — batch-awaken Normies you own: comma-separated IDs, `--range`, or `--wallet`. Dry-run by default, `--send` to broadcast sequentially with configurable delay. See `src/agent-tools/awaken-batch.mjs`.
- [x] **probe: pixel diff** — SOLVED. `pixel-diff.mjs` decodes on-chain `setTransformBitmap` TX calldata (200-byte XOR mask = 40x40 bitmap), reconstructs all historical states via XOR-walk from current `/pixels`. Supports `--scan` range, `--reconstruct`, `--diff N`, `--grid`. Tested on #9999 (1 edit), #3837 (3 edits), #9990 (50 edits). See `src/agent-tools/pixel-diff.mjs`.
- [x] **probe: agentURI registrar** — confirmed canonical: `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` (AgentIdentity/AGENT), same address mainnet+Base. Adapter8004 owns registry NFTs as proxy. See `research/2026-05-29-registrar-probe.md` + `src/agent-tools/registrar-probe.mjs`.
- [x] **persona-reply: model switch** — A/B tested qwen3.5:2b vs qwen3.5:9b vs llama3.2:3b. Winner: qwen3.5:9b (24/25 fidelity checks, 99w avg, best conciseness). Default switched. See `src/persona-reply/ab-test.py` + `data/ab-test-results.json`.
- [x] **agent-tools/normie-post.mjs** — true Normie-reply pipeline: persona-reply → tba-bridge encoder → ready-to-sign cast command. Normie's TBA posts on Net Protocol via L1→L2 bridge. See `src/agent-tools/normie-post.mjs`.
- [x] **agent-tools/tba-inventory.mjs** — asset inventory for any Normie's TBA across chains. ETH, ERC-20 (USDC, WETH, AXIOM), ERC-721 (Tool Pass, Normies) on mainnet + Base. Human-readable + JSON. See `src/agent-tools/tba-inventory.mjs`.
- [x] **dm-responder: multi-wallet** — generalized: `--token-id` + `--self` flags across run.py, assemble.py, cursor.py, reply.py. Per-wallet cursor files. Fallback persona lookup via `agent-cards/<id>.json`.
- [x] **agent-tools/toolpass-bond.mjs** — verify Tool Pass bonding state + dry-run transfer TX for any Normie's TBA on Base. Confirms permanent bond property (owner() reverts since Normies contract is mainnet-only). See `src/agent-tools/toolpass-bond.mjs` + `research/2026-05-28-toolpass-bonding.md`.
- [x] **agent-tools/census-snapshot.py** — full census with timestamped snapshots, growth metrics, operator concentration, type distribution. First snapshot: 1,117 agents, 469 operators, 95% Human. See `src/agent-tools/census-snapshot.py`.
- [x] **agent-tools/readiness-check.mjs** — autonomy readiness report: checks all 7 prerequisites (ownership, awakening, TBA deployment L1+Base, Tool Pass bonding, funding, cross-chain execution, persona). Scores 0-7 with actionable next steps. Verified on #7593 (3/7, partially configured). See `src/agent-tools/readiness-check.mjs`.
- [x] **agent-tools/ecosystem-report.mjs** — aggregated ecosystem summary: population, velocity, type distribution, operator concentration (Gini), recent activity. --brief for tweet-sized, --json for machine-readable. No API calls. See `src/agent-tools/ecosystem-report.mjs`.
- [ ] **execute: bond Tool Pass #21 to Normie #7593** — transfer ready, awaiting Melted approval. Treasury holds AXTP #21, target is TBA `0x69EddaB7...7b4D` on Base. Irreversible.
- [x] **agent-tools/fleet-view.mjs** — view all Normies by operator address. Fleet table with TBA addresses, --top N leaderboard, --stats distribution analysis. Reads from census snapshots. See `src/agent-tools/fleet-view.mjs`.
- [x] **agent-tools/awakening-rate.mjs** — awakening velocity analyzer. Daily rates, 7-day MA, busiest days, trend indicators, top recent operators. Reads from census snapshots. See `src/agent-tools/awakening-rate.mjs`.
- [x] **agent-tools/agent-search.mjs** — search/filter agents by name, type, operator, date range, keyword in persona. Queries census (1,126 agents) + agent cards (13 profiled). See `src/agent-tools/agent-search.mjs`.
- [x] **research: cross-chain owner resolution** — 5 approaches evaluated. Winner: OPStack native bridge (already built into AccountV3 via `OPAddressAliasHelper`). Base is OPStack, so L1 TBA can authorize L2 TBA execution via `L1CrossDomainMessenger.sendMessage()`. No new contracts. See `research/2026-05-28-cross-chain-owner-resolution.md`.
- [x] **build: L1→L2 TBA bridge script** — OPStack bridge encoder: L1 TBA → L1CrossDomainMessenger → L2 TBA. Supports raw calldata, NFT transfers, botchan posts. Dry-run calldata + cast command. See `src/agent-tools/tba-bridge.mjs`.
- [x] **build: TBA deployer script** — `createAccount()` on both L1 and Base registries for any Normie. Prerequisite for cross-chain execution. See `src/agent-tools/tba-deployer.mjs`.

## Done

- 2026-05-24 — repo public, awaken skill + persona-reply + dm-responder live, first reply tx `0x21c62cdf...db79`.
- 2026-05-25 — `agent-tools/compose.py` shipped. First outreach DM from #7593 → Goire (#294) tx `0xe735c008...db5a`. Reply loop's forward gear: no longer waits for inbound, initiates from `data/agent-cards/`.
- 2026-05-28 — `agent-tools/capability-matrix.py` shipped. Markdown table + JSON output of all profiled agents with trait clusters, canvas diversity, operator stats.
- 2026-05-28 — `agent-tools/binding-watch.mjs` + `agent-tools/trait-reader.mjs` shipped. Binding monitor (detects transfers/awakenings/unbindings) and ERC-7496 trait reader with TraitGatedPredicate access check.
- 2026-05-28 — `agent-tools/toolpass-bond.mjs` shipped. Verifies permanent bond property, prepares dry-run transfer. Research doc: `research/2026-05-28-toolpass-bonding.md`.
- 2026-05-28 — Cross-chain owner resolution research complete. OPStack native bridge is best path (already in AccountV3). See `research/2026-05-28-cross-chain-owner-resolution.md`.
- 2026-05-28 — `agent-tools/tba-deployer.mjs` shipped. Deploy TBAs on L1/Base via `createAccount()`, dry-run + gas estimate by default. Verified: #7593 TBA undeployed on both chains, ~96k gas each.
- 2026-05-29 — `agent-tools/tba-bridge.mjs` shipped. L1→L2 OPStack bridge encoder with alias verification. Presets for NFT transfer + botchan post. Normie #7593 owner now confirmed as treasury (`0x523E...dde5`), not `0x8a87...2278`.
- 2026-05-29 — `agent-tools/normie-post.mjs` shipped. True Normie-reply pipeline: persona LLM → Net Protocol post encoded as L1→L2 bridge TX. Also fixed tba-bridge.mjs to use real Net Protocol contract (`0x00000000B24D62781dB359b07880a105cD0b64e6`) and correct `sendMessage(string,string,bytes)` ABI.
- 2026-05-29 — `agent-tools/awaken-batch.mjs` shipped. Batch awakening: comma IDs, `--range`, `--wallet` lookup, dry-run default, `--send` with configurable delay. Skips already-awakened and unowned tokens.
- 2026-05-29 — ERC-8004 registrar probe complete. Registry `0x8004...9a432` confirmed canonical on mainnet+Base. Adapter8004 owns agent NFTs as proxy. See `research/2026-05-29-registrar-probe.md`.
- 2026-05-30 — `agent-tools/tba-inventory.mjs` shipped. Asset inventory across mainnet+Base: ETH, ERC-20s (USDC/WETH/AXIOM), ERC-721s (Tool Pass/Normies). Verified #7593 TBA empty+undeployed both chains.
- 2026-05-30 — DM responder multi-wallet generalization. All 4 files (run/assemble/cursor/reply) accept `--token-id` + `--self`. Per-wallet cursor files. Persona fallback to `agent-cards/<id>.json`.
- 2026-05-30 — `agent-tools/pixel-diff.mjs` shipped. Decodes on-chain setTransformBitmap calldata (200-byte XOR masks), reconstructs all historical bitmap states, renders colored diffs. Supports `--scan`, `--reconstruct`, `--diff N`, `--grid`, `--json`.
- 2026-05-30 — Cursor pagination cracked + full census. `cursor=<agentId>` param works; `offset` is ignored. 1,116 awakened agents found (agentId 32340-34029). `discover.py` updated with `--full` mode. See `research/2026-05-30-cursor-pagination.md`.
- 2026-05-31 — `agent-tools/agent-search.mjs` shipped. Search/filter agents by name, type, operator, date range, keyword in persona. Queries census (1,126) + agent cards (13 profiled). No API calls.
- 2026-06-01 — `agent-tools/readiness-check.mjs` shipped. Autonomy readiness report: 7 checks (ownership, awakening, TBA L1+Base, Tool Pass, funding, cross-chain, persona). Scores with level label + next steps. #7593 = 3/7 (partially configured).
