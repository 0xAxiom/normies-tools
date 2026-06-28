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
| **toolpass-bond.mjs** | Verify and prepare Tool Pass bonding to a Normie's TBA on Base. Checks deployment status, permanent bond property, and generates dry-run transfer TX. |
| **tba-deployer.mjs** | Deploy ERC-6551 TBA for any Normie on L1 and/or Base via `createAccount()`. Dry-run by default, `--live` to broadcast. Prerequisite for cross-chain execution. Supports batch mode. |
| **tba-bridge.mjs** | L1→L2 cross-chain execution via OPStack native bridge. Encodes the full TX chain: L1 TBA → L1CrossDomainMessenger → L2 TBA. Supports raw calldata, ERC-721 transfers, and Net Protocol posts. Dry-run only — outputs calldata + cast command for the Normie owner to sign. |
| **normie-post.mjs** | True Normie-reply pipeline. Generates persona-grounded reply via local LLM, encodes as L1→L2 bridge TX targeting Net Protocol. The Normie's TBA posts on-chain itself — no treasury impersonation. Supports custom topics, raw messages, and bridge prerequisite checks. |
| **awaken-batch.mjs** | Batch-prep multiple Normies for ERC-8004 awakening. Accepts comma-separated IDs, `--range lo-hi`, or `--wallet 0x...` for auto-discovery. Dry-run by default — checks ownership, skips already-awakened tokens, estimates gas, and prints per-token readiness. **Do not use `--send`; live register txs must use dry-run calldata submitted through Bankr.** |
| **tba-inventory.mjs** | Asset inventory for any Normie's TBA across chains. Checks ETH balance, deployment status, ERC-20 tokens (USDC, WETH, AXIOM), and ERC-721 NFTs (Tool Pass, Normies) on mainnet + Base. Human-readable or `--json` output. Supports `--batch`. |
| **pixel-diff.mjs** | Pixel diff for Normies with `setTransformBitmap` history. Decodes on-chain TX calldata, reconstructs all historical bitmap states via XOR-walk, and renders colored diffs. Supports `--scan` to find edited Normies in a range. |
| **census-snapshot.py** | Full census snapshot of all awakened agents. Walks `/agents/list` via cursor pagination, saves timestamped snapshots to `data/census/`, computes growth metrics vs previous snapshot. Shows operator concentration, type distribution, agent ID range. `--stats` for latest snapshot without API calls. |
| **fleet-view.mjs** | View all Normies operated by a given wallet. Shows name, type, tokenId, agentId, TBA address, and registration date in a table. `--top N` for operator leaderboard. `--stats` for fleet size distribution analysis. Reads from local census snapshots — no API calls. |
| **awakening-rate.mjs** | Analyze awakening velocity from census data. Daily rates, 7-day moving averages, busiest days, top recent operators, trend indicators (accelerating/decelerating/steady). `--days N` for recent window, `--operators` for operator focus. No API calls. |
| **agent-search.mjs** | Search and filter awakened agents by name, type, operator, date range, or keyword in persona/backstory. Queries census data (1000+ agents) and enriched agent cards. `--profiled` for cards-only. `--stats` for type distribution. `--json` output. No API calls. |
| **readiness-check.mjs** | Autonomy readiness report for any Normie. Checks all 7 prerequisites for full on-chain agent operation: ownership, ERC-8004 awakening, TBA deployment (L1+Base), Tool Pass bonding, funding, cross-chain execution readiness, and active persona. Scores 0-7 with level label and actionable next steps. `--json` and `--batch` supported. |
| **ecosystem-report.mjs** | Aggregated ecosystem summary from census data. Population, velocity (7-day avg + trend), type distribution, operator concentration (Gini coefficient, top 10% control), recent activity. `--brief` for tweet-sized output, `--json` for machine-readable. No API calls. |
| **activation-planner.mjs** | Full activation cost estimator for any Normie. Uses live gas prices on mainnet + Base to plan every step: awakening, TBA deployment, funding, Tool Pass bonding. Shows ordered execution plan with commands, gas estimates, and USD cost. `--batch` and `--json` supported. |
| **wallet-report.mjs** | Complete portfolio view for any Normie operator. Finds all Normies a wallet operates (from census), runs readiness checks (on-chain), and builds a prioritized action plan. `--deep` adds live gas cost estimates. `--json` supported. |
| **census-diff.mjs** | Deep comparison between two census snapshots. Shows new awakenings, departed agents, operator fleet changes, type distribution shifts, and concentration trends. `--all` for timeline across all snapshots, `--json` for machine-readable. No API calls. |
| **tba-census.mjs** | Population-level TBA deployment and funding scan across all awakened Normies. Uses JSON-RPC batching for efficiency (~90 calls for 1,100+ agents). Checks deployment status (L1+Base), ETH balances, Tool Pass bonds. Readiness distribution, top funded, top operators. Saves timestamped snapshots to `data/tba-census/`. `--sample N`, `--stats`, `--compare`, `--json` supported. |
| **normie-dossier.mjs** | Comprehensive identity dossier for any Normie. Combines identity (owner, agent binding), TBA status (deployment + balances on L1/Base), autonomy readiness (7-check score), asset holdings (ERC-20s + NFTs), persona (backstory + personality), pixel edit history, and ecosystem context (operator rank, fleet size, registration date) from census data. One command, full picture. `--batch` and `--json` supported. |
| **normie-activate.mjs** | Step-by-step activation orchestrator. Chains all steps: readiness check → deploy TBAs (L1+Base) → fund → bond Tool Pass. Dry-run by default shows commands; `--live` executes on-chain. `--skip-bond` excludes irreversible Tool Pass bonding. `--step <id>` for single-step execution. `--batch` and `--json` supported. |
| **normie-events.mjs** | On-chain event scanner. Queries Ethereum mainnet for Normie ecosystem events: awakenings (AgentBound from Adapter8004), transfers, and burns. Configurable block range or `--since` date. `--type` filter, `--save` to `data/events/`, `--json` for machine-readable. |
| **watchlist.mjs** | Track a set of Normies and detect state changes over time. Manage a watchlist of token IDs, snapshot their on-chain + API state, and diff against previous snapshots to surface changes: ownership transfers, new awakenings, TBA deployments, funding changes, Tool Pass bonds, and persona updates. Retry with exponential backoff for RPC rate limits. `--json` and `--since N` supported. |

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

# Batch-awaken (dry-run)
node src/agent-tools/awaken-batch.mjs 100,200,300
node src/agent-tools/awaken-batch.mjs --range 100-110
node src/agent-tools/awaken-batch.mjs --wallet 0xYourAddress

# Asset inventory — what does a Normie's wallet hold?
node src/agent-tools/tba-inventory.mjs 7593
node src/agent-tools/tba-inventory.mjs 7593 --json

# Population census snapshot
python3 src/agent-tools/census-snapshot.py
python3 src/agent-tools/census-snapshot.py --stats  # latest snapshot, no API calls

# Awakening velocity analysis (reads census data, no API calls)
node src/agent-tools/awakening-rate.mjs
node src/agent-tools/awakening-rate.mjs --days 7 --json

# Search agents by name, type, keyword, or date
node src/agent-tools/agent-search.mjs "Goire"                    # by name
node src/agent-tools/agent-search.mjs --type Cat --limit 5       # by type
node src/agent-tools/agent-search.mjs --keyword "conviction"     # in persona text
node src/agent-tools/agent-search.mjs --since 2026-05-28 --json  # recent, JSON output

# Autonomy readiness check — what does a Normie need to become fully autonomous?
node src/agent-tools/readiness-check.mjs 7593
node src/agent-tools/readiness-check.mjs --batch 294,3837,7593 --json

# Ecosystem report — aggregated stats, trends, operator concentration
node src/agent-tools/ecosystem-report.mjs
node src/agent-tools/ecosystem-report.mjs --brief  # tweet-sized summary
node src/agent-tools/ecosystem-report.mjs --json   # machine-readable

# Activation cost estimator — what does it cost to fully activate a Normie?
node src/agent-tools/activation-planner.mjs 7593
node src/agent-tools/activation-planner.mjs --batch 294,7593 --json

# Wallet portfolio report — all your Normies, readiness, and action plan
node src/agent-tools/wallet-report.mjs 0xYourWalletAddress
node src/agent-tools/wallet-report.mjs 0xYourWalletAddress --deep   # with cost estimates
node src/agent-tools/wallet-report.mjs 0xYourWalletAddress --json

# Population-level TBA census (all awakened agents, no API calls needed)
node src/agent-tools/tba-census.mjs                   # full scan
node src/agent-tools/tba-census.mjs --sample 50       # quick sample
node src/agent-tools/tba-census.mjs --stats            # latest snapshot, no RPC
node src/agent-tools/tba-census.mjs --compare          # diff two snapshots
node src/agent-tools/tba-census.mjs --json             # machine-readable

# Census diff — compare snapshots for growth and operator changes
node src/agent-tools/census-diff.mjs                            # latest vs previous
node src/agent-tools/census-diff.mjs 2026-05-31 2026-06-02      # specific dates
node src/agent-tools/census-diff.mjs --all                      # timeline across all snapshots
node src/agent-tools/census-diff.mjs --json                     # machine-readable

# Full identity dossier — everything about a Normie in one command
node src/agent-tools/normie-dossier.mjs 7593
node src/agent-tools/normie-dossier.mjs --batch 294,7593 --json

# Activation orchestrator — deploy TBAs, fund, bond Tool Pass in one command
node src/agent-tools/normie-activate.mjs 7593                     # dry-run: show steps
node src/agent-tools/normie-activate.mjs 7593 --live --skip-bond  # execute (skip irreversible bond)
node src/agent-tools/normie-activate.mjs 7593 --step deploy-l1 --live  # single step
node src/agent-tools/normie-activate.mjs --batch 294,7593 --json  # batch dry-run

# On-chain event scanner — awakenings, transfers, burns
node src/agent-tools/normie-events.mjs                     # last 1000 blocks (~3.3h)
node src/agent-tools/normie-events.mjs --blocks 7200       # last 24 hours
node src/agent-tools/normie-events.mjs --since 2026-06-01  # since date
node src/agent-tools/normie-events.mjs --type awakening    # filter by type
node src/agent-tools/normie-events.mjs --save --json       # save + machine-readable

# Watchlist — track specific Normies for state changes
node src/agent-tools/watchlist.mjs add 7593 294 3837       # add to watchlist
node src/agent-tools/watchlist.mjs list                     # show current watchlist
node src/agent-tools/watchlist.mjs check                    # snapshot + diff all watched
node src/agent-tools/watchlist.mjs check --json             # machine-readable output
node src/agent-tools/watchlist.mjs check --since 5          # show last 5 snapshots history
node src/agent-tools/watchlist.mjs remove 294               # remove from watchlist

# Generate persona reply (requires Ollama running locally)
python3 src/persona-reply/reply.py --llm "what do you think about being on-chain?"
```

## On-Chain Messaging

The DM responder posts replies via Net Protocol. Supports any awakened Normie via `--token-id` and `--self`.

**Signing:** All on-chain writes use `botchan comment --encode-only` to produce unsigned TX JSON, then submit via the Bankr API — no raw private key required or accepted.

```bash
# Dry-run (no on-chain writes — inspect the botchan comment command that would fire)
python3 src/dm-responder/run.py --dry-run

# Any other Normie (needs a cached agent card in data/)
python3 src/dm-responder/run.py --token-id 294 --self 0xYourWallet --dry-run

# Live (encodes TX via --encode-only, submits via Bankr API)
python3 src/dm-responder/run.py --token-id 294 --self 0xYourWallet
```

Set `BANKR_API_KEY` in your environment for live runs. **Never pass a raw `PRIVATE_KEY`** — if botchan asks for one, you are missing the `--encode-only` flag.

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
| `BANKR_API_KEY` | For live on-chain messaging | Submit `--encode-only` TX blobs via Bankr API |

## Contributing

Public repo — PRs welcome. Check [`research/QUEUE.md`](research/QUEUE.md) for open items:

- Tool Pass bonding execution (awaiting approval)
- Cross-chain TBA execution via OPStack bridge (scripts ready, awaiting live deployment)

## License

MIT.
