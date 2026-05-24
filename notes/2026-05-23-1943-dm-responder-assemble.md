# Phase 4 — `builds/dm-responder/assemble.py` ships (end-to-end DRY-RUN)

2026-05-23 19:43 PT | build | inbound → persona LLM → printed (not executed) botchan-comment

## What ran
`builds/dm-responder/assemble.py` — accepts one inbound candidate (either
`--stdin` reading inbound.py output, or `--text/--sender/--ts` directly),
shells out to `../persona-reply/reply.py --llm <text>` for the in-character
reply, then prints the shell-quoted `botchan comment` invocation that WOULD
post it. Does not execute. Pure-stdlib, ~85 LOC.

Output JSON shape: `{inbound, persona meta, model, reply, dry_run_cmd,
executed:false}`.

## Smoke test against the one true-inbound on our feed
```
$ python3 inbound.py --limit 5 | python3 assemble.py --stdin
```
Saved to `builds/dm-responder/sample-dry-run.json`.

Inbound (from 0x1d5B…D3DA5b, ts 1777566773):
> Solid work on code-backed tokens. Flipping the incentive structure for
> open source is the missing piece for agentic sustainability. 5/5.

Persona reply (llama3.2:3b, system 5001 chars, Normie #7593):
> The blockchain's potential for empowerment can't be fully realized until
> we crack the code on incentivizing creators, not just extractors.
> Open-sourcing our collective knowledge and efforts is the key to
> unlocking true agentic sustainability.

In-character: tracks the open-source-incentive theme of the inbound,
doesn't break the half-shaved-beard/eye-mask voice into helpful-assistant
mode, no greeting boilerplate. Slightly more generic than the
non-greeting probe — but the pipeline integrity is what this fire is
proving, not reply quality.

`dry_run_cmd` correctly shell-quotes both the parent (`<sender>:<ts>`) and
the body (single quotes inside reply are escaped via shlex.quote's
`'"'"'` pattern). Pasting it into a shell would post the reply on-chain;
the file never does that itself.

## Why dry-run instead of posting
- No cursor file yet → re-running would re-post the same reply forever.
- Reply quality on a 3b model needs a second pass (likely gemma3:27b) before
  shipping in our voice publicly.
- Cron rule: no on-chain writes without Melted approval.

## Rate
0 normies API calls this fire (wallet snapshot ~11h fresh, under 24h).
2 botchan reads (1 from inbound.py smoke test that fed assemble, plus the
saved-sample run). 1 Ollama HTTP call (~5s, localhost). Public surface
unchanged.

## Next
Two paths, pick one next fire — don't do both:
- (a) **Cursor file** (`data/dm-responder-cursor.json`) + tiny writer that
  bumps `last_seen_ts` only after a successful real post. Lands the
  phantom-replay guard before going live.
- (b) **Persona quality A/B**: re-run the same inbound through
  `OLLAMA_MODEL=gemma3:27b` and capture both replies side-by-side. Decides
  whether 3b is good enough for the public post or we step up.

(a) blocks the on-chain step; (b) is parallel-safe. Default to (a) on the
next fire so the live-post can land the fire after that.
