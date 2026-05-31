# Pixel Diff — setTransformBitmap Decoding

## Finding

The `setTransformBitmap(uint256 tokenId, bytes bitmap)` function (selector `0x01173e70`) on the Normies contract at `0x64951d92e345c50381267380e2975f66810e869c` encodes a 200-byte (1600-bit) XOR mask representing the 40x40 pixel grid.

Each bit in the mask corresponds to a pixel that was **toggled** (flipped on/off). To reconstruct the state before an edit, XOR the current pixel state with the mask. To walk back through N edits, chain the XOR operations.

## API Endpoints

- `/history/normie/{id}/versions` — returns edit history: `{version, changeCount, newPixelCount, transformer, blockNumber, timestamp, txHash}`. Version 0 = most recent. No per-version pixel endpoint exists.
- `/normie/{id}/pixels` — returns current 1600-char bitstring (40x40, row-major).
- No `?version=N` parameter for `/pixels`.

## Key Data Points

- `changeCount` = number of toggled pixels = number of `1` bits in the TX bitmap mask
- `newPixelCount` = total on-pixels after applying the transform
- Versions are sorted newest-first (version 0 = latest edit, highest version = earliest edit)

## Edited Normies Found

Most Normies have empty version history (mint state unchanged). Sampled findings:
- **#9999**: 1 edit, 152 pixels changed, 615 on (mint) -> 717 on (current)
- **#3837**: 3 edits by same transformer, pixel count fluctuates 439-467
- **#9990**: 50 edits by 2 transformers (active canvas artist)
- **#6000**: 3 edits

## Tool

`src/agent-tools/pixel-diff.mjs` — reconstructs all historical states via XOR-walk from current `/pixels` endpoint, using on-chain TX calldata from mainnet RPC.
