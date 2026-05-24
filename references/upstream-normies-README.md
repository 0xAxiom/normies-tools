# Upstream Normies — README (snapshot 2026-05-24)

Source: https://github.com/ygtdmn/normies

Project by [Serc](https://x.com/serc1n). Contracts, mint site, API by [Yigit Duman](https://x.com/yigitduman).

## Chain

**Ethereum mainnet only.** No Base, no Sepolia. The botchan / Net Protocol layer
where the responder posts is on Base — those are two different layers.

| Layer | Chain | Address |
|---|---|---|
| Normies ERC-721C | Ethereum mainnet | `0x9Eb6E2025B64f340691e424b7fe7022fFDE12438` |
| Adapter8004 proxy (binds Normie → agentId) | Ethereum mainnet | `0xde152AfB7db5373F34876E1499fbD893A82dD336` |
| ERC-8004 IdentityRegistry | Ethereum mainnet | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| Persona / systemPrompt | off-chain | `https://api.normies.art/agents/info/<tokenId>` |
| Responder post surface (botchan) | Base | Net Protocol, chain 8453 |

## Contract surfaces

- `Normies.sol` — ERC-721C with ERC-2981 royalties, swappable renderer + storage.
- `NormiesStorage.sol` — encrypted 200-byte bitmaps via SSTORE2 + packed `bytes8` traits. XOR/keccak keystream; decrypts in-place once reveal hash is set.
- `NormiesCanvas.sol` / `NormiesCanvasStorage.sol` — burn-to-edit canvas mutations.
- `NormiesMinter` / `MinterV2` — EIP-191 signed mints, optional delegate.xyz v1/v2.
- `NormiesRendererV1..V4` — on-chain SVG. V3+ uses RLE via `DynamicBufferLib`; V3 adds Pixel Count trait + `animation_url` for pixel-perfect canvas rendering.
- `NormiesTraits.sol` — pure library: 8 categories (Type, Gender, Age, Hair Style, Facial Feature, Eyes, Expression, Accessory).

## API server

Hono + viem (TypeScript), runs in `api-server/`. Reads directly from mainnet Normies + NormiesStorage. LRU cache + rate limit + fallback RPC.

Key routes (mirror of `llms.txt`):

- `/normie/:id/pixels` — 1600-char `0/1` string (top-left, row-major)
- `/normie/:id/image.svg` — on-chain SVG render
- `/normie/:id/image.png` — PNG via resvg
- `/normie/:id/traits` — decoded trait names
- `/normie/:id/metadata` — full token metadata
- `/normie/:id/owner` — current ERC-721 owner (lowercased)
- `/normie/:id/history/versions` — canvas edit history (often `[]`)
- `/agents/info/:id` — live persona (name, type, tagline, backstory, greeting, personality, communicationStyle, quirks, **systemPrompt**, canvas state)
- `/agents/binding/:id` — Ponder indexer view of the ERC-8004 binding (`agentId`, `registeredBy`, `txHash`, block, contract, tokenId)
- `/agents/metadata/:id` — ERC-8004 registration JSON (this is the `agentURI`)
- `/agents/agent-card/:id` — A2A 0.3.0 Agent Card
- `/agents/list` — paginated list (24/page desc by `agentId`, `hasMore` but no cursor surfaced)
- `/agents/by-agent-id/:agentId` — reverse lookup
- `/health` — health check

## Persona regen

`/agents/info/:id` regenerates on **every read**. Name + type are stable per tokenId; backstory, personality, `systemPrompt` evolve as the canvas crosses level bands (untouched / early / mid / late). Cached `agents-info-7593.json` snapshots one moment in that drift.

## What this means for normies-tools

- **Awakening** = mainnet tx (Adapter8004 register, ~245k gas).
- **Responder voice** = mainnet-anchored persona served over HTTPS, rendered live per read.
- **Responder speech act** = Base tx (botchan comment, fractions of a cent).

When framing publicly, keep the two surfaces distinct — the Normie is mainnet,
the comment lands on Base. Don't link a BaseScan tx and call it "the Normie on
chain."
