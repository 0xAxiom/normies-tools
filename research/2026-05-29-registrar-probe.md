# ERC-8004 Registrar Probe — 2026-05-29

## Question

Which ERC-8004 registrar contract is canonical on mainnet, and does it match what's hardcoded in our tooling? Cross-check against Adapter8004 deployment.

## Findings

### Registry Contract

| Field | Value |
|-------|-------|
| Address | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| Name | AgentIdentity |
| Symbol | AGENT |
| Deployed on | Ethereum mainnet + Base (same address both chains) |

**Confirmed canonical:** `Adapter8004.identityRegistry()` returns `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` on both mainnet and Base. This matches our hardcoded value in `lib.mjs`.

### Adapter8004 Contracts

| Chain | Adapter Address |
|-------|----------------|
| Ethereum mainnet | `0xde152AfB7db5373F34876E1499fbD893A82dD336` |
| Base | `0x270d25D2c59A8bcA1B0f40ad95fF7806c0025c27` |
| Sepolia | `0x7621630cB63a73a194f45A3E6801B8C6A7eC2f92` |

Both mainnet and Base adapters point to the same registry (`0x8004...9a432`). Sepolia uses a different registry (`0x8004A818BFB912233c491871b3d84c89A494BD9e`).

### Agent #32811 (Normie #7593 "Mine")

| Field | Value |
|-------|-------|
| Registry ownerOf | `0xde152AfB7db5373F34876E1499fbD893A82dD336` (Adapter8004 itself) |
| Registry tokenURI | `https://api.normies.art/agents/metadata/7593` |
| Adapter tokenURI | `https://api.normies.art/agents/metadata/7593` |
| Adapter getAgentWallet | `0x0000...0000` (not set) |
| Binding | ERC721 / `0x9Eb6...2438` (Normies contract) / tokenId 7593 |
| registrationHash | `0xeefe2107b48649d336eda0ac7cb2336e7fe6ef2e6a871c1dcda2395f91ef1c4f` |
| getMetadata("erc8004.binding") | `0x` (empty) |

### Key Architecture Insight

The registry is an ERC-721 contract where each agent identity is an NFT (agentId = tokenId). The **Adapter8004** is the `ownerOf` the agent NFT in the registry — not the Normie owner. The adapter acts as a proxy: it owns the registry entry and controls agent metadata/URI updates, while the underlying NFT ownership (Normies contract) determines who can call adapter functions like `setAgentURI`.

This means:
- `registry.ownerOf(32811)` = Adapter8004 address (the proxy)
- `normies.ownerOf(7593)` = actual human owner (treasury `0x523E...dde5`)
- The adapter bridges these two ownership layers

### BINDING_METADATA_KEY

This function selector (`0xfa2622ad`) consistently reverts with Infura rate-limit errors or may not be implemented on this deployment. The `getMetadata` call with fallback key `"erc8004.binding"` returns `0x` (empty), suggesting binding metadata is stored differently or not yet set for this agent.

## Conclusion

- Registry is **confirmed canonical** at `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
- Same address on mainnet and Base (cross-chain identity)
- Hardcoded values in `lib.mjs` are correct
- Agent wallet (`getAgentWallet`) is unset — could be set to the TBA address in the future
- No config changes needed in our tooling

## Tool

Probe script: `src/agent-tools/registrar-probe.mjs`
