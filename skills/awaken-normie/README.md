# awaken-normie

Awaken a [Normies](https://normies.art) NFT as a real ERC-8004 agent on Ethereum mainnet (also runnable on Base / Sepolia for the adapter integration, but Normies only deploys on mainnet).

After awakening, the Normie has a stable on-chain `agentId`, a verifiable controller (whoever holds the Normie), and a live persona / A2A 0.3.0 agent card served at `api.normies.art`.

## Install

```bash
cp -r awaken-normie ~/.openclaw/skills/
cd awaken-normie/scripts && npm install
```

## Quick start

```bash
# Dry-run (predicts agentId, estimates gas, never broadcasts)
node scripts/awaken.mjs <tokenId>

# Encode calldata for Bankr API submission (all live txs go this route)
node scripts/awaken.mjs <tokenId> --encode-only

# Submit the encoded tx via Bankr API (replace TX_JSON with the output above)
BKEY=$(security find-generic-password -a axiom -s openclaw.BANKR_API_KEY -w)
curl -s -X POST "https://api.bankr.bot/agent/prompt" \
  -H "X-API-Key: $BKEY" -H "Content-Type: application/json" \
  -d "{\"prompt\": \"Submit this transaction: $(node scripts/awaken.mjs <tokenId> --encode-only)\"}"

# Verify an existing binding
node scripts/awaken.mjs --verify <agentId>

# Watch a wallet for incoming Normies (daemon)
node scripts/watch.mjs mainnet [walletAddress]
```

> **Never use `--send` or `NET_PRIVATE_KEY`** — the wallet is compromised. All live txs go through Bankr API. See [`SKILL.md`](./SKILL.md) prerequisites.

## ENV vars

| Var | Purpose |
|---|---|
| `BANKR_API_KEY` | Required for live txs — fetch from keychain, submit `--encode-only` calldata via Bankr API |
| `AXIOM_WALLET_ADDRESS` | Optional — used as default for `watch.mjs` |
| `INFURA_API_KEY` | Used to build the default RPCs (or override with `MAINNET_RPC_URL` / `BASE_RPC_URL` / `SEPOLIA_RPC_URL`) |

## Contracts

| Chain | Adapter8004 proxy |
|---|---|
| Ethereum mainnet | `0xde152AfB7db5373F34876E1499fbD893A82dD336` |
| Base | `0x270d25D2c59A8bcA1B0f40ad95fF7806c0025c27` |
| Sepolia | `0x7621630cB63a73a194f45A3E6801B8C6A7eC2f92` |

Adapter source: https://github.com/nxt3d/adapter · ERC-8004 draft: https://eips.ethereum.org/EIPS/eip-8004

## Cost

~245k gas per register. ~$0.05–$0.20 at typical mainnet base fees.

## Gotchas

See [`SKILL.md`](./SKILL.md) for the full list — the short version: the **adapter** owns the agent NFT (not you), `getAgentWallet` is `0x0` right after register (the adapter clears it on purpose), and the on-chain `agent-binding` metadata is the 20-byte adapter pointer only — readers find the adapter from those bytes, then call `bindingOf(agentId)` for the canonical record.

---

Part of [axiom-public](https://github.com/0xAxiom/axiom-public) · MIT License
