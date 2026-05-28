# Tool Pass Bonding to Normie TBA — Research

Date: 2026-05-28

## Summary

AXIOM Tool Pass NFTs (Base ERC-721) can be permanently bonded to a Normie's
ERC-6551 Token Bound Account by transferring the Tool Pass to the TBA address
on Base. Because the Normies contract only exists on Ethereum mainnet,
AccountV3's `owner()` reverts on Base, making `execute()` impossible — the
Tool Pass can never be extracted.

## Verified Facts

| Property | Value |
|----------|-------|
| Tool Pass contract | `0xfc9ce3990f85fA1A3a0eE51a710642396a6Cad82` (Base) |
| Tool Pass standard | ERC-721 Enumerable, 1000 supply, 436 holders |
| Normie #7593 TBA | `0x69EddaB7CD9531EC47093A01c08CdcbEbFdD7b4D` |
| TBA deployed on Base | NO (0x) |
| Normies contract on Base | NO (0x) — mainnet only |
| ERC-6551 Registry on Base | YES (canonical) |
| Treasury Tool Pass balance | 1 (token ID #21) |
| Treasury address | `0x523Eff3dB03938eaa31a5a6FBd41E3B9d23edde5` |

## Why Bonding is Permanent

1. ERC-6551 TBAs use CREATE2 — the address `0x69EddaB7...7b4D` is deterministic
   and the same on every chain, computed from (registry, implementation, salt,
   chainId=1, normiesContract, tokenId=7593).

2. The TBA implementation is AccountV3Upgradable (`0x55266d...596E7F`). Its
   `execute()` requires `msg.sender == owner()`.

3. `owner()` calls the token contract (Normies, `0x9Eb6E...12438`) on the
   bound chain (Ethereum mainnet, chainId 1). But on Base, that address has
   no code — the call reverts.

4. Since `owner()` reverts, `execute()` is unusable. No one can call
   `transferFrom` on the Tool Pass from the TBA's context.

5. Even if someone deploys the TBA on Base (anyone can call
   `ERC6551Registry.createAccount()`), `owner()` still reverts because the
   Normies contract doesn't exist on Base.

## Transfer Mechanics

- `transferFrom(treasury, tba, 21)` works because the TBA has no code on Base,
  so ERC-721 treats it as an EOA (no `onERC721Received` callback needed).
- `safeTransferFrom` also works — OZ's `_checkOnERC721Received` skips the
  callback when `to.code.length == 0`.
- Gas cost: standard ERC-721 transfer (~65k gas on Base, ~$0.01).

## What This Enables

- **Proof of Tool Pass**: anyone can verify `balanceOf(tba) > 0` on the Tool
  Pass contract to confirm a Normie holds a Tool Pass.
- **TraitGatedPredicate**: if the predicate checks the TBA address for NFT
  ownership, the Normie's TBA passes the gate.
- **Permanent binding**: the Tool Pass is irrecoverable until cross-chain owner
  resolution is built (Hyperlane/CCIP/LayerZero Read adapter for AccountV3).

## Execution Plan

The transfer requires Melted's explicit approval (on-chain write rule).
The `toolpass-bond.mjs` tool provides:
- `--verify 7593` — check current bonding state
- `--prepare 7593 --from <treasury>` — dry-run with calldata and cast command

## Next Steps

1. Get Melted approval for the transfer
2. Execute: `cast send` or viem script with treasury wallet
3. Verify with `--verify 7593` post-transfer
4. Research cross-chain owner resolution to eventually unlock the TBA
