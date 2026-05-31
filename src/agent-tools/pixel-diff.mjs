#!/usr/bin/env node
/**
 * pixel-diff.mjs — Pixel diff tool for Normies with setTransformBitmap history.
 *
 * Fetches version history, decodes on-chain transform bitmaps, and reconstructs
 * the full pixel state at every version by XOR-walking backwards from current state.
 *
 * Usage:
 *   node pixel-diff.mjs 9999                  # summary + current grid
 *   node pixel-diff.mjs 9999 --reconstruct    # reconstruct all historical states
 *   node pixel-diff.mjs 9999 --diff 0         # diff between version 0 and previous
 *   node pixel-diff.mjs 9999 --grid           # print 40x40 grids for each version
 *   node pixel-diff.mjs 9999 --json           # JSON output
 *   node pixel-diff.mjs --scan 1-100          # scan a range for edited Normies
 */

import { loadEnv } from "../../skills/awaken-normie/scripts/lib.mjs";

const API_BASE = "https://api.normies.art";
const GRID_SIZE = 40;
const BITMAP_BYTES = 200; // 1600 bits = 40x40

async function fetchJSON(url) {
  const resp = await fetch(url, {
    headers: { "User-Agent": "normies-tools/pixel-diff" },
  });
  if (!resp.ok) return null;
  return resp.json();
}

async function fetchText(url) {
  const resp = await fetch(url, {
    headers: { "User-Agent": "normies-tools/pixel-diff" },
  });
  if (!resp.ok) return null;
  return resp.text();
}

function getProvider() {
  loadEnv();
  const url =
    process.env.MAINNET_RPC_URL ||
    (process.env.INFURA_API_KEY
      ? `https://mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`
      : null);
  if (!url) {
    console.error("Set MAINNET_RPC_URL or INFURA_API_KEY");
    process.exit(1);
  }
  return url;
}

async function rpcCall(rpcUrl, method, params) {
  const resp = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  const data = await resp.json();
  return data.result;
}

/**
 * Decode setTransformBitmap calldata → 1600-char bitstring (the XOR mask).
 * ABI: setTransformBitmap(uint256 tokenId, bytes bitmap)
 * Selector: 0x01173e70
 */
function decodeBitmapFromCalldata(input) {
  if (!input || input.length < 10) return null;
  const selector = input.slice(0, 10);
  if (selector !== "0x01173e70") return null;

  const rest = input.slice(10);
  // uint256 tokenId at offset 0
  // uint256 offset to bytes at offset 64 hex chars
  const offset = parseInt(rest.slice(64, 128), 16);
  const dataStart = offset * 2;
  const length = parseInt(rest.slice(dataStart, dataStart + 64), 16);

  if (length !== BITMAP_BYTES) {
    // Unexpected length — not a standard 40x40 bitmap
    return null;
  }

  const rawHex = rest.slice(dataStart + 64, dataStart + 64 + length * 2);
  const bits = BigInt("0x" + rawHex)
    .toString(2)
    .padStart(1600, "0");
  return bits;
}

/**
 * XOR two 1600-char bitstrings.
 */
function xorBits(a, b) {
  let result = "";
  for (let i = 0; i < 1600; i++) {
    result += a[i] === b[i] ? "0" : "1";
  }
  return result;
}

function countOn(bits) {
  let c = 0;
  for (const ch of bits) if (ch === "1") c++;
  return c;
}

function printGrid(bits, label) {
  console.log(`\n--- ${label} (${countOn(bits)} on) ---`);
  for (let row = 0; row < GRID_SIZE; row++) {
    const line = bits.slice(row * GRID_SIZE, (row + 1) * GRID_SIZE);
    // Visual: use block chars
    console.log(
      line
        .split("")
        .map((b) => (b === "1" ? "\u2588" : "\u00B7"))
        .join("")
    );
  }
}

function diffSummary(before, after, label) {
  let added = 0,
    removed = 0;
  const addedPositions = [];
  const removedPositions = [];
  for (let i = 0; i < 1600; i++) {
    if (before[i] === "0" && after[i] === "1") {
      added++;
      addedPositions.push({ row: Math.floor(i / 40), col: i % 40 });
    } else if (before[i] === "1" && after[i] === "0") {
      removed++;
      removedPositions.push({ row: Math.floor(i / 40), col: i % 40 });
    }
  }
  console.log(`\n${label}`);
  console.log(`  pixels added:   ${added}`);
  console.log(`  pixels removed: ${removed}`);
  console.log(`  net change:     ${added - removed > 0 ? "+" : ""}${added - removed}`);
  console.log(`  before: ${countOn(before)} on → after: ${countOn(after)} on`);

  if (addedPositions.length <= 20) {
    console.log(
      `  added at:   ${addedPositions.map((p) => `(${p.row},${p.col})`).join(" ")}`
    );
  }
  if (removedPositions.length <= 20) {
    console.log(
      `  removed at: ${removedPositions.map((p) => `(${p.row},${p.col})`).join(" ")}`
    );
  }

  return { added, removed, addedPositions, removedPositions };
}

function printDiffGrid(before, after, label) {
  console.log(`\n--- ${label} ---`);
  console.log("Legend: \u2588=unchanged on, \u00B7=unchanged off, \x1b[32m+\x1b[0m=added, \x1b[31m-\x1b[0m=removed");
  for (let row = 0; row < GRID_SIZE; row++) {
    let line = "";
    for (let col = 0; col < GRID_SIZE; col++) {
      const i = row * GRID_SIZE + col;
      if (before[i] === "0" && after[i] === "1") line += "\x1b[32m+\x1b[0m";
      else if (before[i] === "1" && after[i] === "0") line += "\x1b[31m-\x1b[0m";
      else if (after[i] === "1") line += "\u2588";
      else line += "\u00B7";
    }
    console.log(line);
  }
}

async function scanRange(startId, endId) {
  const edited = [];
  const batchSize = 10;
  console.log(`Scanning ${startId}-${endId} for edited Normies...`);

  for (let i = startId; i <= endId; i += batchSize) {
    const batch = [];
    for (let j = i; j < Math.min(i + batchSize, endId + 1); j++) {
      batch.push(
        fetchJSON(`${API_BASE}/history/normie/${j}/versions`).then((v) => ({
          id: j,
          versions: v,
        }))
      );
    }
    const results = await Promise.all(batch);
    for (const r of results) {
      if (r.versions && r.versions.length > 0) {
        const transformers = [...new Set(r.versions.map((v) => v.transformer))];
        edited.push({
          tokenId: r.id,
          edits: r.versions.length,
          transformers: transformers.length,
          latestPixels: r.versions[0].newPixelCount,
        });
        console.log(
          `  #${r.id}: ${r.versions.length} edits by ${transformers.length} transformer(s), ${r.versions[0].newPixelCount} pixels`
        );
      }
    }
    // Rate limit: 60/min, batches of 10
    if (i + batchSize <= endId) await new Promise((r) => setTimeout(r, 1500));
  }

  console.log(`\nFound ${edited.length} edited Normies in range ${startId}-${endId}`);
  return edited;
}

async function main() {
  const args = process.argv.slice(2);

  // --scan mode
  const scanIdx = args.indexOf("--scan");
  if (scanIdx !== -1) {
    const range = args[scanIdx + 1] || "1-100";
    const [start, end] = range.split("-").map(Number);
    if (!start || !end || start > end) {
      console.error("Usage: --scan START-END (e.g. --scan 1-100)");
      process.exit(1);
    }
    const results = await scanRange(start, end);
    if (args.includes("--json")) {
      console.log(JSON.stringify(results, null, 2));
    }
    return;
  }

  const tokenId = parseInt(args.find((a) => /^\d+$/.test(a)));
  if (!tokenId) {
    console.error("Usage: node pixel-diff.mjs <tokenId> [--reconstruct] [--diff N] [--grid] [--json]");
    process.exit(1);
  }

  const doReconstruct = args.includes("--reconstruct");
  const doGrid = args.includes("--grid");
  const jsonOut = args.includes("--json");
  const diffIdx = args.indexOf("--diff");
  const diffVersion = diffIdx !== -1 ? parseInt(args[diffIdx + 1]) : null;

  // Fetch version history
  const versions = await fetchJSON(`${API_BASE}/history/normie/${tokenId}/versions`);
  if (!versions || versions.length === 0) {
    console.log(`Normie #${tokenId}: no edit history (mint state unchanged)`);
    if (doGrid) {
      const pixels = await fetchText(`${API_BASE}/normie/${tokenId}/pixels`);
      if (pixels) printGrid(pixels.trim(), `#${tokenId} (mint state)`);
    }
    return;
  }

  // Sort by version ascending (version 0 = most recent)
  // API already returns version 0 first (most recent), so reverse for chronological
  const chronological = [...versions].reverse();

  // Summary
  const transformers = [...new Set(versions.map((v) => v.transformer))];
  const firstEdit = new Date(parseInt(chronological[0].timestamp) * 1000);
  const lastEdit = new Date(parseInt(chronological[chronological.length - 1].timestamp) * 1000);

  console.log(`Normie #${tokenId} — ${versions.length} edits`);
  console.log(`  transformers: ${transformers.length} unique`);
  transformers.forEach((t) => {
    const count = versions.filter((v) => v.transformer === t).length;
    console.log(`    ${t} (${count} edits)`);
  });
  console.log(`  first edit:   ${firstEdit.toISOString()} (block ${chronological[0].blockNumber})`);
  console.log(`  last edit:    ${lastEdit.toISOString()} (block ${chronological[chronological.length - 1].blockNumber})`);
  console.log(`  current pixels: ${versions[0].newPixelCount} on`);

  if (!doReconstruct && diffVersion === null && !doGrid) {
    // Just summary + version table
    console.log("\nVersion history (newest first):");
    for (const v of versions) {
      const date = new Date(parseInt(v.timestamp) * 1000)
        .toISOString()
        .slice(0, 16)
        .replace("T", " ");
      console.log(
        `  v${v.version}: ${v.changeCount} changed → ${v.newPixelCount} on | ${date} | ${v.transformer.slice(0, 10)}...`
      );
    }
    if (!jsonOut) {
      console.log("\nUse --reconstruct to decode on-chain bitmaps and rebuild all states");
      console.log("Use --diff N to see what changed in version N");
      console.log("Use --grid to print 40x40 grids");
    }
    if (jsonOut) {
      console.log(
        JSON.stringify({ tokenId, edits: versions.length, transformers, versions }, null, 2)
      );
    }
    return;
  }

  // Reconstruct: need RPC access to decode TX calldata
  const rpcUrl = getProvider();
  const currentPixels = await fetchText(`${API_BASE}/normie/${tokenId}/pixels`);
  if (!currentPixels) {
    console.error("Failed to fetch current pixels");
    process.exit(1);
  }
  const current = currentPixels.trim();

  // Decode all transform masks from on-chain TXs (newest first = version 0, 1, 2, ...)
  console.log(`\nDecoding ${versions.length} transform TX(s) from mainnet...`);
  const masks = [];
  for (const v of versions) {
    const tx = await rpcCall(rpcUrl, "eth_getTransactionByHash", [v.txHash]);
    if (!tx) {
      console.error(`  v${v.version}: TX not found: ${v.txHash}`);
      masks.push(null);
      continue;
    }
    const mask = decodeBitmapFromCalldata(tx.input);
    if (!mask) {
      console.error(`  v${v.version}: failed to decode bitmap from TX`);
      masks.push(null);
      continue;
    }
    const maskOn = countOn(mask);
    console.log(`  v${v.version}: decoded mask (${maskOn} toggled pixels) ✓`);
    masks.push(mask);
  }

  // Reconstruct states by XOR-walking backwards
  // state[0] = current (after all edits)
  // state[1] = current XOR mask[0] (before most recent edit)
  // state[2] = state[1] XOR mask[1] (before second most recent)
  // ...
  // state[N] = mint state
  const states = [current];
  let prev = current;
  for (let i = 0; i < masks.length; i++) {
    if (!masks[i]) {
      console.error(`  Cannot reconstruct past version ${versions[i].version} — missing mask`);
      break;
    }
    prev = xorBits(prev, masks[i]);
    states.push(prev);
  }

  console.log(`\nReconstructed ${states.length} states (current + ${states.length - 1} historical)`);
  for (let i = 0; i < states.length; i++) {
    const on = countOn(states[i]);
    if (i === 0) {
      console.log(`  [current]  ${on} on pixels`);
    } else if (i === states.length - 1) {
      console.log(`  [mint]     ${on} on pixels`);
    } else {
      const v = versions[i - 1];
      console.log(`  [pre-v${v.version}]  ${on} on pixels`);
    }
  }

  // Specific diff
  if (diffVersion !== null) {
    const vIdx = versions.findIndex((v) => v.version === diffVersion);
    if (vIdx === -1) {
      console.error(`Version ${diffVersion} not found`);
      process.exit(1);
    }
    if (vIdx + 1 >= states.length) {
      console.error(`Cannot diff — not enough reconstructed states`);
      process.exit(1);
    }
    const before = states[vIdx + 1];
    const after = states[vIdx];
    const label = `Version ${diffVersion} diff`;
    diffSummary(before, after, label);
    printDiffGrid(before, after, label);
  }

  // Grid output
  if (doGrid) {
    printGrid(states[0], `#${tokenId} current`);
    if (states.length > 1) {
      printGrid(states[states.length - 1], `#${tokenId} mint state`);
    }
  }

  // JSON output
  if (jsonOut) {
    const result = {
      tokenId,
      edits: versions.length,
      transformers,
      states: states.map((s, i) => ({
        label:
          i === 0
            ? "current"
            : i === states.length - 1
              ? "mint"
              : `pre-v${versions[i - 1].version}`,
        onPixels: countOn(s),
        bits: s,
      })),
      versions: versions.map((v, i) => ({
        ...v,
        mask: masks[i] || null,
      })),
    };
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
