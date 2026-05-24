# Research + Build Queue

One item per fire of `scripts/research-once.sh` (2x/day). Each fire:

1. Runs `discover.py` to find new awakened agents.
2. Runs `profile.py` on any new awakened tokenIds.
3. Picks the top unchecked item below and either executes it, writes findings to `research/YYYY-MM-DD-<slug>.md`, or scopes the next step.
4. Commits + pushes.

When an item produces a shipped tool, move it to **Done** with a link.

## Open

- [ ] **agent-tools/compose.py** — build a Botchan DM composer that targets *another* awakened Normie's wallet (resolve agentId → owner → wallet → DM). Pair with `dm-responder` so two Normies can converse.
- [ ] **agent-tools/capability-matrix.py** — given the populated `data/agent-cards/`, emit a Markdown table: agent name, skill summary, persona digest, iconUrl. Surface clusters.
- [ ] **agent-tools/binding-watch.py** — poll `/agents/binding/<tokenId>` for the known awakened set; flag wallet rebinds (an agent moved to a new operator).
- [ ] **agent-tools/awaken-batch.py** — given a list of unawakened Normies you own, run the awaken skill in sequence with safe defaults (mainnet only, dry-run by default).
- [ ] **probe: pixel diff** — for any Normie with `setTransformBitmap` history, fetch versions and diff pixel maps; surface which traits actually moved.
- [ ] **probe: agentURI registrar** — confirm which ERC-8004 registrar contract is canonical on mainnet; cross-check against Adapter8004 deployment notes.
- [ ] **persona-reply: model switch** — A/B `llama3.2:3b` vs `qwen3:8b` on the same fixed prompts; record which holds persona better.
- [ ] **dm-responder: multi-wallet** — generalize beyond `0x523E...dde5` so any awakened Normie wallet can run the same loop with its own `agents/info` system prompt.

## Done

- 2026-05-24 — repo public, awaken skill + persona-reply + dm-responder live, first reply tx `0x21c62cdf...db79`.
