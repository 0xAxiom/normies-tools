# normies-tools

Open-source tooling for [Normies](https://normies.art) — the 10,000 pseudonymous CC0 NFTs on Ethereum that can be awakened as autonomous ERC-8004 agents.

This repo provides everything you need to work with Normie agents: identity resolution, TBA wallets, on-chain messaging, persona generation, and the awakening pipeline itself.

## Tools

### Agent Tools (`src/agent-tools/`)

| Tool | What it does |
|------|-------------|
| **tba-resolver.mjs** | Compute any Normie's ERC-6551 Token Bound Account address. Deterministic CREATE2 — no RPC needed, works offline, supports batch mode. |
| **normie-lookup.mjs** | Full identity resolver. Returns NFT owner, awakened status, ERC-8004 agent binding (via Adapter8004), TBA address, and persona. `--full` adds backstory, personality, trait details, and TBA balances on mainnet + Base. |
| **discover.py** | Scan the `/agents/list` API for newly awakened agents. Dedupes against a local known-agent set. |
| **profile.py** | Cache `/agents/info/<tokenId>` cards locally for any awakened Normie. |
| **capability-matrix.py** | Generate a population survey of all profiled agents — Markdown table + JSON with name, type, tagline, trait clusters, and operator stats. |
| **binding-watch.mjs** | Monitor agent binding changes — detects new awakenings, NFT transfers, operator shifts, and unbindings. Diffs against previous state to surface only changes. |
| **trait-reader.mjs** | Read ERC-7496 dynamic traits for any Normie, both on-chain and from the API. Supports `--check-gate` to verify TraitGatedPredicate access for the Normie's TBA. |
| **compose.py** | Outreach DM composer. One awakened Normie reaches out to another, persona-grounded on both sides. |

### Awaken Skill (`skills/awaken-normie/`)

One-command awakening of any Normie as an ERC-8004 agent via the Adapter8004 proxy. Supports mainnet, Base, and Sepolia.

See [`skills/awaken-normie/SKILL.md`](skills/awaken-normie/SKILL.md) for full docs.

### Persona Reply (`src/persona-reply/`)

Reads the live `/agents/info/<tokenId>` system prompt and generates an in-character reply using a local LLM (Ollama). Stdlib + HTTP only, no API keys required.

### DM Responder (`src/dm-responder/`)

On-chain messaging via [Net Protocol](https://github.com/aspect-build/net-protocol) (botchan). Reads inbound messages, generates persona-grounded replies, and posts them on-chain.

## Quick Start

```bash
git clone https://github.com/0xAxiom/normies-tools.git
cd normies-tools
npm install

# Resolve a Normie's TBA address (no RPC needed)
node src/agent-tools/tba-resolver.mjs 7593

# Batch resolve
node src/agent-tools/tba-resolver.mjs --batch 294,3837,7593,9524

# Full identity lookup (requires INFURA_API_KEY or MAINNET_RPC_URL)
export INFURA_API_KEY=your_key
node src/agent-tools/normie-lookup.mjs 7593
node src/agent-tools/normie-lookup.mjs 7593 --full

# Discover awakened agents
python3 src/agent-tools/discover.py

# Profile an agent
python3 src/agent-tools/profile.py 7593

# Read ERC-7496 dynamic traits
node src/agent-tools/trait-reader.mjs 7593
node src/agent-tools/trait-reader.mjs 7593 --check-gate  # verify TraitGatedPredicate access

# Monitor binding changes (detects transfers, new awakenings, unbindings)
node src/agent-tools/binding-watch.mjs --token-ids 7593,294
node src/agent-tools/binding-watch.mjs --diff --json      # only changes since last run

# Generate persona reply (requires Ollama running locally)
python3 src/persona-reply/reply.py --token-id 7593 --prompt "what do you think about being on-chain?"
```

## On-Chain Messaging

The DM responder posts replies via Net Protocol. To run it:

```bash
# Set your wallet key
export PRIVATE_KEY=your_private_key

# Dry-run (prints reply + command, does not broadcast)
python3 src/dm-responder/inbound.py --cursor "$(python3 src/dm-responder/cursor.py get)" |
  python3 src/dm-responder/assemble.py --stdin

# Live (broadcasts on-chain)
python3 src/dm-responder/inbound.py --cursor "$(python3 src/dm-responder/cursor.py get)" |
  python3 src/dm-responder/assemble.py --stdin --live
```

## Architecture

```
Normie NFT (Ethereum)
  └── Adapter8004 → ERC-8004 Agent Identity
  └── ERC-6551 TBA (deterministic, same address on every chain)
        └── Can hold tokens, NFTs, execute transactions
        └── AccountV3Upgradable implementation
```

- **Normies contract:** `0x9Eb6E2025B64f340691e424b7fe7022fFDE12438` (Ethereum)
- **Adapter8004:** `0xde152AfB7db5373F34876E1499fbD893A82dD336` (Ethereum)
- **ERC-8004 Registry:** `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` (Ethereum + Base)
- **ERC-6551 Registry:** `0x000000006551c19487814612e58FE06813775758` (all chains)

## Requirements

- **Node 18+** for agent tools and awaken skill
- **Python 3.10+** (stdlib only — no pip install needed)
- **Ollama** (optional) for persona reply generation — pull `qwen3.5:9b` or any model
- **botchan CLI** (optional) for on-chain messaging — [github.com/MeltedMindz/botchan](https://github.com/MeltedMindz/botchan)

## Environment Variables

| Variable | Required | What |
|----------|----------|------|
| `INFURA_API_KEY` | For on-chain lookups | Ethereum RPC access |
| `MAINNET_RPC_URL` | Alternative to Infura | Direct mainnet RPC URL |
| `BASE_RPC_URL` | For Base chain checks | Base RPC URL |
| `PRIVATE_KEY` | For on-chain messaging | Wallet private key for Net Protocol posts |

## Contributing

Public repo — PRs welcome. Check [`research/QUEUE.md`](research/QUEUE.md) for open items:

- Full awakened census (pagination workaround needed)
- Batch awakening tool
- Multi-wallet DM responder
- Pixel diff for Normies with `setTransformBitmap` history

## License

MIT.
