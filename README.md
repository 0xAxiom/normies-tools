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
| `data/` | Cached `/agents/info/7593.json`, cursor state, append-only receipts. |
| `notes/` | One dated note per build fire — what was probed, what was learned, what's next. |
| `JOURNAL.md` | One line per fire: phase, outcome. |
| `scripts/build-once.sh` | The single loop body. Cron / launchd runs this. |

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

## 4x/day cron

`scripts/build-once.sh` runs one fire: pulls, attempts a live reply if there's fresh inbound, otherwise picks up the next survey step from `JOURNAL.md`, commits, pushes. Wire it via `launchd` (macOS) or `cron` (linux) to fire at 06:17, 12:17, 18:17, 00:17 PT.

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
