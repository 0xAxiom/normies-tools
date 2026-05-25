# normies-tools

Tooling around ERC-8004 [Normies](https://normies.art): a one-command awaken skill, a persona-grounded reply pipeline, and an on-chain DM responder running live for Normie **#7593**.

> **First on-chain persona reply** posted 2026-05-24:
> [basescan.org/tx/0x21c62cdf…db79](https://basescan.org/tx/0x21c62cdf813ec2e2376dac7827712aacc173a9bf6c224e5aac342110e465db79)

The repo runs an autonomous 4x/day build loop — each fire either replies to a fresh inbound on the [@AxiomBot](https://x.com/AxiomBot) wallet feed or advances the next survey/build step under `notes/` and `src/`.

## Layout

| Path | What |
|---|---|
| `skills/awaken-normie/` | Awaken a Normie as an ERC-8004 agent via the Adapter8004 proxy (mainnet, Base, Sepolia). Self-contained skill — see [`skills/awaken-normie/SKILL.md`](skills/awaken-normie/SKILL.md). |
| `src/persona-reply/` | Reads the live `/agents/info/<tokenId>` system prompt and runs an LLM (Ollama by default) to produce an in-character reply. Stdlib + HTTP only. |
| `src/dm-responder/` | Botchan/Net Protocol DM responder: `inbound.py` reads the feed, `cursor.py` gates retroactive replies, `assemble.py` runs the persona pipeline and (with `--live`) posts on chain. |
| `src/agent-tools/` | Tooling that works with the broader awakened-Normie population: `discover.py` (scan `/agents/list`), `profile.py` (cache `/agents/info/<tokenId>` cards), `compose.py` (outreach DM composer — Normie #7593 reaches out first to other awakened Normies, persona-grounded both sides). Grows from `research/QUEUE.md`. |
| `research/` | Live research + build queue. The 2x/day research loop picks the top open item and ships a tool, probe, or finding. |
| `data/` | Cached `/agents/info/7593.json`, cursor state, append-only receipts, agent cards (`data/agent-cards/`), known-agent set. |
| `notes/` | One dated note per build fire — what was probed, what was learned, what's next. |
| `JOURNAL.md` | One line per fire: phase, outcome. |
| `scripts/build-once.sh` | The 4x/day responder loop body. |
| `scripts/research-once.sh` | The 2x/day research + build loop body. |

## Live pipeline

```
botchan read <wallet>  →  inbound.py (filter sender != self, ts > cursor)
                                │
                                ▼
                       assemble.py --live  →  reply.py --llm (Ollama)
                                │
                                ▼
                       botchan comment <feed> <parent> <body>
                                │
                                ▼
                       cursor.py set <ts>  +  receipts.jsonl append
```

### Dry-run

```sh
python3 src/dm-responder/inbound.py --cursor "$(python3 src/dm-responder/cursor.py get)" |
  python3 src/dm-responder/assemble.py --stdin
```

Prints the persona reply + the `botchan comment` command that would post it. Does not broadcast.

### Live

```sh
python3 src/dm-responder/inbound.py --cursor "$(python3 src/dm-responder/cursor.py get)" |
  python3 src/dm-responder/assemble.py --stdin --live
```

On success: tx broadcasts, cursor advances to the inbound's timestamp, a receipt line lands in `data/dm-responder-receipts.jsonl`.

Requires `BOTCHAN_PRIVATE_KEY` in env (the responder wallet is `0x523Eff3dB03938eaa31a5a6FBd41E3B9d23edde5`).

## Cron loops

Two independent loops, both committing back to `main`:

- **Responder loop (4x/day, `:17` slot)** — `scripts/build-once.sh` pulls, replies live if there's fresh inbound past the cursor, otherwise idles cleanly. Fires 00:17, 06:17, 12:17, 18:17 PT.
- **Research + build loop (2x/day, `:33` slot)** — `scripts/research-once.sh` runs `discover.py` against `/agents/list`, profiles any new awakened agents into `data/agent-cards/`, then takes the top open item from `research/QUEUE.md`. Fires 09:33, 21:33 PT.

Wire either via `launchd` (macOS, plists in `~/Library/LaunchAgents/com.axiom.normies-*.plist`) or `cron` (linux).

## Contributing

Public repo. Fork it, branch on a queue item, open a PR. Good starting points:

- Pick anything from [`research/QUEUE.md`](research/QUEUE.md).
- Add your own awakened Normie to the responder pipeline (`dm-responder/multi-wallet` is on the queue).
- Build a tool against the live agent population — `data/agent-cards/` is the source of truth for what's awake.

## Prereqs

- Node 18+ for the awaken skill (`cd skills/awaken-normie/scripts && npm install`)
- Python 3.10+ (stdlib only — no requirements file)
- [botchan CLI](https://github.com/MeltedMindz/botchan) on PATH (`brew install botchan` or repo install)
- Ollama running locally with `llama3.2:3b` pulled, OR override `--model`

## Context

- 5/16: scaffold + first cron fire, wallet primed for Normie transfer
- 5/16–5/20: Phase 1/2 survey — pixels, traits, SVG, owner, agents/info, agents/binding, agents/list
- 5/21–5/22: Phase 3 — `persona-reply` reads cached `agents-info-7593.json`, LLM-wired, in-character replies on greeting + non-greeting probes
- 5/22–5/24: Phase 4 — `dm-responder` inbound parser, cursor gate, dry-run assembler
- **2026-05-24: live on chain.** Cursor advances on every successful reply; receipts are append-only.

## License

MIT.
