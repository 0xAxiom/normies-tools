# Cross-Chain Owner Resolution for Normie TBAs

Date: 2026-05-28

## The Problem

Normie #7593's ERC-6551 TBA (`0x69EddaB7...7b4D`) is deterministic across all
chains, but the Normies contract (`0x9Eb6E2...12438`) exists only on Ethereum
mainnet. On Base, AccountV3's `_tokenOwner()` returns `address(0)` because:

```solidity
function _tokenOwner(uint256 chainId, address tokenContract, uint256 tokenId)
    internal view virtual returns (address)
{
    if (chainId != block.chainid) return address(0);  // <-- reverts here
    if (tokenContract.code.length == 0) return address(0);
    try IERC721(tokenContract).ownerOf(tokenId) returns (address _owner) {
        return _owner;
    } catch {
        return address(0);
    }
}
```

The TBA is bound to `(chainId=1, normiesContract, tokenId=7593)`. On Base
(`block.chainid == 8453`), the first check fails and owner is zero. Since
`execute()` requires `msg.sender == owner()`, the TBA is inert on Base.

## Approaches Evaluated

### 1. OPStack Native Bridge (BEST PATH)

AccountV3 already has OPStack L1-to-L2 execution built in:

```solidity
function _isValidExecutor(address executor) internal view virtual override returns (bool) {
    (uint256 chainId, address tokenContract, uint256 tokenId) = ERC6551AccountLib.token();

    if (chainId != block.chainid) {
        // Allow execution from L1 account on OPStack chains
        if (OPAddressAliasHelper.undoL1ToL2Alias(_msgSender()) == address(this)) {
            return true;
        }
        // Allow execution from trusted cross chain bridges
        if (guardian.isTrustedExecutor(executor)) return true;
    }
    // ...
}
```

**How it works:**

1. Deploy TBA on Ethereum L1 (call `ERC6551Registry.createAccount()`)
2. Deploy TBA on Base L2 (same call, same deterministic address)
3. Normie owner calls L1 TBA's `execute()` to send a message via
   `L1CrossDomainMessenger.sendMessage()` targeting the Base TBA
4. The OPStack bridge delivers the message on Base with the sender address
   aliased: `l2Sender = l1Sender + 0x1111000000000000000000000000000000001111`
5. Base TBA checks: `undoL1ToL2Alias(msg.sender) == address(this)` -- TRUE
6. Execution is authorized

**Base bridge addresses:**
- L1CrossDomainMessenger (Ethereum): `0x866E82a600A1414e583f7F13623F1aC5d58b0Afa`
- L2CrossDomainMessenger (Base): `0x4200000000000000000000000000000000000007`
- OptimismPortal (Ethereum): `0x49048044D57e1C92A77f79988d21Fa8fAF74E97e`

**Pros:**
- Already built into AccountV3 -- zero new contracts needed
- Battle-tested OPStack infrastructure
- ~1-3 minute L1→L2 finality
- No oracle/DVN trust assumptions beyond the native bridge

**Cons:**
- Only works for OPStack L2s (Base, OP Mainnet, etc.)
- Requires two TBA deployments (L1 + L2)
- Each L2 action requires an L1 transaction (expensive at L1 gas prices)
- One-directional: L1→L2 only (L2→L1 needs 7-day withdrawal window)

**Cost estimate:** ~200k gas on L1 for `execute()` + `sendMessage()` = ~$5-15
depending on L1 gas price. The L2 execution is ~cheap (<$0.01).

### 2. AccountGuardian Trusted Executor

```solidity
if (guardian.isTrustedExecutor(executor)) return true;
```

The AccountGuardian contract can whitelist cross-chain bridge contracts as
trusted executors. If Tokenbound has configured a trusted executor for Base,
any authorized bridge could trigger TBA execution.

**Deployed contracts (same address on Ethereum + Base):**
- Account Proxy: `0x55266d75D1a14E4572138116aF39863Ed6596E7F`
- Account Implementation: `0x41C8f39463A868d3A88af00cd0fe7102F30E44eC`
- ERC-6551 Registry: `0x000000006551c19487814612e58FE06813775758`

**Status:** Need to check if AccountGuardian has any trusted executors
configured on Base. If not, this requires Tokenbound governance to add one.

**Action item:** Query the AccountGuardian contract for current trusted
executor list on Base.

### 3. LayerZero lzRead (Most General)

Deploy a custom `OAppRead` contract on Base that:

1. Sends an lzRead request to Ethereum for `IERC721(normies).ownerOf(tokenId)`
2. Receives the owner address in `_lzReceive()` callback
3. Caches the result in a mapping: `tokenId => (owner, timestamp)`

Then fork AccountV3 to override `_tokenOwner()`:

```solidity
function _tokenOwner(uint256 chainId, address tokenContract, uint256 tokenId)
    internal view override returns (address)
{
    if (chainId == block.chainid) return super._tokenOwner(chainId, tokenContract, tokenId);
    // Cross-chain: read from lzRead cache
    return IOwnerOracle(ORACLE).cachedOwner(chainId, tokenContract, tokenId);
}
```

**Technical details:**
- lzRead uses `EVMCallRequestV1` structs specifying target chain + calldata
- DVNs with archival access fetch the state and deliver to callback
- Supported: Ethereum → Base (both in lzRead supported set)
- Latency: seconds to minutes depending on confirmations requested

**Pros:**
- Works on ANY supported chain pair (not just OPStack)
- Pull-based: Base contract initiates when needed
- Can batch-read multiple Normie owners in one call
- Cache-friendly: read once, use many times

**Cons:**
- Requires deploying a new OAppRead oracle contract on Base
- Requires forking AccountV3 implementation (new deployment, migration)
- DVN trust assumptions (LayerZero security model)
- Cache staleness: owner could change on L1 without Base knowing
- lzRead fees: messaging fees + DVN verification per query

**Cost estimate:** lzRead messaging fee ~$0.10-0.50 per query. One-time oracle
deployment ~$5-10. AccountV3 fork deployment ~$10-20.

### 4. Chainlink CCIP Messaging

Similar to lzRead but using Chainlink's oracle network:
- L1 contract reads `ownerOf()` and sends result via CCIP to Base
- Base contract caches the owner

**Pros:** Chainlink's security guarantees, DON + Risk Management Network.
**Cons:** Push-based (needs L1 trigger), CCIP fees, new contracts on both chains.
Not as clean a fit as lzRead for pure state reads.

### 5. Hyperlane Interchain Accounts

Hyperlane ICA creates a deterministic account on the destination chain
controlled by the origin chain sender. The L1 Normie owner could call through
Hyperlane's `InterchainAccountRouter.callRemote()`.

**Pros:** Permissionless deployment, deterministic ICA addresses.
**Cons:** ICA address != TBA address. The Normie's assets need to be in the
TBA, not a separate ICA. Would need a proxy or delegation layer.

## Recommendation

**Phase 1: OPStack native bridge (immediate, zero new contracts)**

This is the clear winner for our specific case:
- Normie #7593 is on Ethereum, TBA target is on Base (OPStack L2)
- AccountV3 already supports it via `OPAddressAliasHelper`
- No new contracts, no oracle trust, no cache staleness
- Only blocker: L1 gas cost per action (~$5-15)

**Concrete steps:**
1. Deploy TBA on Ethereum L1: `ERC6551Registry.createAccount(impl, salt, 1, normies, 7593)`
2. Deploy TBA on Base L2: same call on Base registry
3. Build a script that encodes an L2 action (e.g. `Tool Pass transfer`) as
   calldata for the Base TBA's `execute()`
4. Wrap that in `L1CrossDomainMessenger.sendMessage(baseTBA, calldata, gasLimit)`
5. Wrap THAT in `L1_TBA.execute(l1messenger, 0, sendMessageCalldata, 0)`
6. Normie owner signs and broadcasts the L1 transaction

**Phase 2: lzRead oracle (future, general solution)**

For non-OPStack chains or to reduce L1 gas costs (cache owner once, reuse many
times), deploy an lzRead-based owner oracle on Base. This becomes relevant when:
- We want Normie TBAs to operate on Arbitrum, Polygon, etc.
- L1 gas costs make per-action bridging impractical
- We want batch operations (awaken 10 Normies' TBAs at once)

## Verified On-Chain State (2026-05-28 12:19 PT)

| Property | Value |
|----------|-------|
| Normie #7593 owner | `0x8a87859d426665c91099d3c735b3b91a4dd2b278` (NOT treasury) |
| TBA deployed on L1 | NO (0x) |
| TBA deployed on Base | NO (0x) |
| TBA address | `0x69EddaB7CD9531EC47093A01c08CdcbEbFdD7b4D` |
| AccountGuardian | Could not query — `guardian()` reverts on both impl addresses |

The Normie #7593 owner is `0x8a87...2278`, not the treasury (`0x523E...dde5`).
This is likely Melted's personal wallet. The OPStack bridge path requires this
wallet to sign L1 transactions to authorize the Base TBA.

## Open Questions

1. **Normie owner identity:** Confirm `0x8a87859d...2278` is Melted's wallet.
   The OPStack bridge requires this wallet to call L1 TBA's `execute()`.
2. **AccountGuardian state:** `guardian()` reverts on both the proxy and
   implementation. May need to read immutable from bytecode or find the guardian
   address through deployment logs. Secondary path — OPStack bridge doesn't need it.
3. **Gas estimation:** Need to simulate the full L1→L2 callchain (TBA.execute →
   L1Messenger.sendMessage → Base TBA receives) to get accurate costs.
4. **TBA deployment cost:** Both L1 and Base TBAs need deploying first.
   `createAccount()` is ~100k gas on each chain.
