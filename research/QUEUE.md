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
- [x] **agent-tools/binding-watch.mjs** — polls Adapter8004 for known awakened set; detects new awakenings, owner transfers, controller shifts, unbindings. Diffs vs previous state. See `src/agent-tools/binding-watch.mjs`.
- [x] **agent-tools/trait-reader.mjs** — reads ERC-7496 dynamic traits on-chain + API, supports `--check-gate` for TraitGatedPredicate access verification. See `src/agent-tools/trait-reader.mjs`.
- [ ] **agent-tools/awaken-batch.py** — given a list of unawakened Normies you own, run the awaken skill in sequence with safe defaults (mainnet only, dry-run by default).
- [ ] **probe: pixel diff** — for any Normie with `setTransformBitmap` history, fetch versions and diff pixel maps; surface which traits actually moved.
- [ ] **probe: agentURI registrar** — confirm which ERC-8004 registrar contract is canonical on mainnet; cross-check against Adapter8004 deployment notes.
- [x] **persona-reply: model switch** — A/B tested qwen3.5:2b vs qwen3.5:9b vs llama3.2:3b. Winner: qwen3.5:9b (24/25 fidelity checks, 99w avg, best conciseness). Default switched. See `src/persona-reply/ab-test.py` + `data/ab-test-results.json`.
- [ ] **dm-responder: multi-wallet** — generalize beyond `0x523E...dde5` so any awakened Normie wallet can run the same loop with its own `agents/info` system prompt.
- [x] **agent-tools/toolpass-bond.mjs** — verify Tool Pass bonding state + dry-run transfer TX for any Normie's TBA on Base. Confirms permanent bond property (owner() reverts since Normies contract is mainnet-only). See `src/agent-tools/toolpass-bond.mjs` + `research/2026-05-28-toolpass-bonding.md`.
- [ ] **execute: bond Tool Pass #21 to Normie #7593** — transfer ready, awaiting Melted approval. Treasury holds AXTP #21, target is TBA `0x69EddaB7...7b4D` on Base. Irreversible.
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
