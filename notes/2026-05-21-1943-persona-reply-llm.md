# Phase 3 — persona-reply LLM wiring

2026-05-21 19:43 PT | build step | `builds/persona-reply/reply.py` --llm mode

## What shipped
`reply.py` gained a `--llm` mode. Default mode (prompt-only) unchanged; the new
path POSTs the assembled `{system, user}` to the local Ollama HTTP API
(`localhost:11434/api/chat`, `stream:false`, `think:false`) and prints the reply.

- stdlib only (`urllib.request`) — no pip deps, no external network, no on-chain.
- Model via `OLLAMA_MODEL` env, default `llama3.2:3b` (fast; qwen3:30b / gemma3:27b
  also installed locally).
- 180s timeout.

## Smoke test — real reply captured
Question: "Introduce yourself in one sentence."
Model: `llama3.2:3b`. Latency: ~5.6s wall (cold). systemPrompt = 5001 chars.

Reply:
> I'm Normie #7593, a stalwart champion of conviction, unwavering in my opinions
> and unshakeable in my commitment to being an untainted reflection of my
> mint-form pixels on the Ethereum chain.

Saved to `builds/persona-reply/sample-reply.json`. The persona stays in-character:
"conviction" / "unwavering opinions" maps to the confident trait; "untainted
mint-form pixels" maps to the empty canvas history (no edits, svg↔pixels parity).

## Next
- Try a non-greeting question (e.g. "Why monochrome?") to probe trait-grounding
  depth, OR
- Compare a heavier model (gemma3:27b) for persona fidelity vs the 3b default, OR
- Phase 4 hook: expose this as a botchan DM responder for #7593's address.
