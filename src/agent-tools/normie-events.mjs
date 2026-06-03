#!/usr/bin/env node
/**
 * normie-events.mjs — On-chain event scanner for the Normies ecosystem.
 *
 * Queries recent events from Ethereum mainnet:
 *   - AgentBound (Adapter8004) — new awakenings
 *   - Transfer (Normies ERC-721) — ownership changes
 *   - setTransformBitmap (Normies) — pixel edits
 *
 * Usage:
 *   node normie-events.mjs                    # last 1000 blocks (~3.3 hours)
 *   node normie-events.mjs --blocks 7200      # last 24 hours
 *   node normie-events.mjs --since 2026-06-01 # since date
 *   node normie-events.mjs --type awakening   # filter by event type
 *   node normie-events.mjs --json             # machine-readable
 *   node normie-events.mjs --save             # save to data/events/
 */

import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadEnv } from "../../skills/awaken-normie/scripts/lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const EVENTS_DIR = path.join(ROOT, "data", "events");

const NORMIES = "0x9Eb6E2025B64f340691e424b7fe7022fFDE12438";
const ADAPTER = "0xde152AfB7db5373F34876E1499fbD893A82dD336";

const AGENT_BOUND_TOPIC = ethers.id("AgentBound(uint256,uint8,address,uint256,address)");
const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");

const BLOCK_TIME_SEC = 12;

function getProviderUrl() {
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
  if (data.error) throw new Error(`RPC error: ${data.error.message}`);
  return data.result;
}

async function rpcBatch(rpcUrl, calls) {
  const body = calls.map((c, i) => ({
    jsonrpc: "2.0",
    method: c.method,
    params: c.params,
    id: i + 1,
  }));
  const resp = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const results = await resp.json();
  return results.sort((a, b) => a.id - b.id).map((r) => r.result);
}

function hexToInt(hex) {
  return parseInt(hex, 16);
}

function padAddress(addr) {
  return "0x" + addr.toLowerCase().replace("0x", "").padStart(64, "0");
}

function unpadAddress(hex) {
  return "0x" + hex.slice(-40);
}

function formatTimestamp(ts) {
  return new Date(ts * 1000).toISOString().replace("T", " ").replace(/\.\d+Z/, " UTC");
}

function dateToBlock(dateStr, currentBlock) {
  const target = new Date(dateStr + "T00:00:00Z").getTime() / 1000;
  const now = Date.now() / 1000;
  const blockDiff = Math.ceil((now - target) / BLOCK_TIME_SEC);
  return Math.max(currentBlock - blockDiff, 0);
}

async function fetchAwakeningEvents(rpcUrl, fromBlock, toBlock) {
  // Filter by tokenContract = Normies in topic[3]
  const logs = await rpcCall(rpcUrl, "eth_getLogs", [
    {
      address: ADAPTER,
      topics: [AGENT_BOUND_TOPIC, null, null, padAddress(NORMIES)],
      fromBlock: "0x" + fromBlock.toString(16),
      toBlock: "0x" + toBlock.toString(16),
    },
  ]);

  return (logs || []).map((log) => {
    const agentId = hexToInt(log.topics[1]);
    const tokenContract = unpadAddress(log.topics[3]);
    // data: tokenId (uint256) + registeredBy (address)
    const data = log.data.slice(2);
    const tokenId = Number(BigInt("0x" + data.slice(0, 64)));
    const registeredBy = unpadAddress("0x" + data.slice(64, 128));

    return {
      type: "awakening",
      blockNumber: hexToInt(log.blockNumber),
      txHash: log.transactionHash,
      logIndex: hexToInt(log.logIndex),
      agentId,
      tokenId,
      registeredBy,
    };
  });
}

async function fetchTransferEvents(rpcUrl, fromBlock, toBlock) {
  const logs = await rpcCall(rpcUrl, "eth_getLogs", [
    {
      address: NORMIES,
      topics: [TRANSFER_TOPIC],
      fromBlock: "0x" + fromBlock.toString(16),
      toBlock: "0x" + toBlock.toString(16),
    },
  ]);

  return (logs || []).map((log) => {
    const from = unpadAddress(log.topics[1]);
    const to = unpadAddress(log.topics[2]);
    const tokenId = hexToInt(log.topics[3]);

    const isMint = from === "0x" + "0".repeat(40);

    return {
      type: isMint ? "mint" : "transfer",
      blockNumber: hexToInt(log.blockNumber),
      txHash: log.transactionHash,
      logIndex: hexToInt(log.logIndex),
      tokenId,
      from,
      to,
    };
  });
}

async function fetchPixelEdits(rpcUrl, fromBlock, toBlock) {
  // setTransformBitmap doesn't emit a specific event — pixel edits use the
  // standard Transfer-like pattern. We scan for calls to the Normies contract
  // with the setTransformBitmap(uint256,bytes) selector via trace or tx scan.
  // Since eth_getLogs doesn't cover function calls, we look for the
  // BitmapTransformed event if it exists, otherwise return empty.
  const BITMAP_TOPIC = ethers.id("BitmapTransformed(uint256,bytes)");

  try {
    const logs = await rpcCall(rpcUrl, "eth_getLogs", [
      {
        address: NORMIES,
        topics: [BITMAP_TOPIC],
        fromBlock: "0x" + fromBlock.toString(16),
        toBlock: "0x" + toBlock.toString(16),
      },
    ]);

    return (logs || []).map((log) => {
      const tokenId = hexToInt(log.topics[1]);
      return {
        type: "pixel_edit",
        blockNumber: hexToInt(log.blockNumber),
        txHash: log.transactionHash,
        logIndex: hexToInt(log.logIndex),
        tokenId,
      };
    });
  } catch {
    return [];
  }
}

async function enrichWithTimestamps(rpcUrl, events) {
  if (!events.length) return events;

  // Get unique block numbers
  const blocks = [...new Set(events.map((e) => e.blockNumber))];

  // Batch fetch block timestamps
  const batchSize = 50;
  const timestamps = {};

  for (let i = 0; i < blocks.length; i += batchSize) {
    const batch = blocks.slice(i, i + batchSize);
    const results = await rpcBatch(
      rpcUrl,
      batch.map((b) => ({
        method: "eth_getBlockByNumber",
        params: ["0x" + b.toString(16), false],
      }))
    );
    for (let j = 0; j < batch.length; j++) {
      if (results[j]) {
        timestamps[batch[j]] = hexToInt(results[j].timestamp);
      }
    }
  }

  return events.map((e) => ({
    ...e,
    timestamp: timestamps[e.blockNumber] || null,
    time: timestamps[e.blockNumber]
      ? formatTimestamp(timestamps[e.blockNumber])
      : null,
  }));
}

function printHuman(events, blockRange) {
  console.log(`\n  Normies On-Chain Events`);
  console.log(`  Blocks ${blockRange.from.toLocaleString()} → ${blockRange.to.toLocaleString()} (${(blockRange.to - blockRange.from).toLocaleString()} blocks, ~${Math.round(((blockRange.to - blockRange.from) * BLOCK_TIME_SEC) / 3600)}h)\n`);

  if (!events.length) {
    console.log("  No events found in this range.\n");
    return;
  }

  // Group by type
  const byType = {};
  for (const e of events) {
    if (!byType[e.type]) byType[e.type] = [];
    byType[e.type].push(e);
  }

  const typeLabels = {
    awakening: "Awakenings",
    transfer: "Transfers",
    mint: "Mints",
    pixel_edit: "Pixel Edits",
  };

  console.log(`  Summary: ${events.length} event${events.length !== 1 ? "s" : ""}`);
  for (const [type, items] of Object.entries(byType)) {
    console.log(`    ${typeLabels[type] || type}: ${items.length}`);
  }
  console.log();

  // Print chronologically
  const sorted = [...events].sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);

  for (const e of sorted) {
    const time = e.time ? `[${e.time}]` : `[block ${e.blockNumber}]`;
    const tx = e.txHash.slice(0, 10) + "…" + e.txHash.slice(-4);

    switch (e.type) {
      case "awakening":
        console.log(`  ${time} AWAKENED  Normie #${e.tokenId} → Agent #${e.agentId} (by ${e.registeredBy.slice(0, 8)}…) tx:${tx}`);
        break;
      case "transfer":
        console.log(`  ${time} TRANSFER  Normie #${e.tokenId} ${e.from.slice(0, 8)}… → ${e.to.slice(0, 8)}… tx:${tx}`);
        break;
      case "mint":
        console.log(`  ${time} MINT      Normie #${e.tokenId} → ${e.to.slice(0, 8)}… tx:${tx}`);
        break;
      case "pixel_edit":
        console.log(`  ${time} PIXEL     Normie #${e.tokenId} edited tx:${tx}`);
        break;
    }
  }
  console.log();
}

function saveEvents(events, blockRange) {
  fs.mkdirSync(EVENTS_DIR, { recursive: true });
  const filename = `events-${blockRange.from}-${blockRange.to}.json`;
  const filepath = path.join(EVENTS_DIR, filename);
  fs.writeFileSync(
    filepath,
    JSON.stringify(
      {
        scannedAt: new Date().toISOString(),
        blockRange,
        eventCount: events.length,
        events,
      },
      null,
      2
    ) + "\n"
  );
  console.log(`  Saved to ${path.relative(ROOT, filepath)}`);
}

async function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");
  const saveMode = args.includes("--save");

  let blockCount = 1000;
  let sinceDateStr = null;
  let typeFilter = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--blocks" && args[i + 1]) {
      blockCount = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === "--since" && args[i + 1]) {
      sinceDateStr = args[i + 1];
      i++;
    } else if (args[i] === "--type" && args[i + 1]) {
      typeFilter = args[i + 1].toLowerCase();
      i++;
    }
  }

  const rpcUrl = getProviderUrl();

  // Get current block
  const currentBlockHex = await rpcCall(rpcUrl, "eth_blockNumber", []);
  const currentBlock = hexToInt(currentBlockHex);

  let fromBlock;
  if (sinceDateStr) {
    fromBlock = dateToBlock(sinceDateStr, currentBlock);
  } else {
    fromBlock = currentBlock - blockCount;
  }

  const blockRange = { from: fromBlock, to: currentBlock };

  // Fetch events in parallel
  const [awakenings, transfers, pixelEdits] = await Promise.all([
    (!typeFilter || typeFilter === "awakening")
      ? fetchAwakeningEvents(rpcUrl, fromBlock, currentBlock)
      : [],
    (!typeFilter || typeFilter === "transfer" || typeFilter === "mint")
      ? fetchTransferEvents(rpcUrl, fromBlock, currentBlock)
      : [],
    (!typeFilter || typeFilter === "pixel_edit")
      ? fetchPixelEdits(rpcUrl, fromBlock, currentBlock)
      : [],
  ]);

  let allEvents = [...awakenings, ...transfers, ...pixelEdits];

  // Filter by type if requested
  if (typeFilter) {
    allEvents = allEvents.filter((e) => e.type === typeFilter);
  }

  // Enrich with timestamps
  allEvents = await enrichWithTimestamps(rpcUrl, allEvents);

  // Sort chronologically
  allEvents.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);

  if (jsonMode) {
    console.log(
      JSON.stringify(
        {
          blockRange,
          eventCount: allEvents.length,
          events: allEvents,
        },
        null,
        2
      )
    );
  } else {
    printHuman(allEvents, blockRange);
  }

  if (saveMode) {
    saveEvents(allEvents, blockRange);
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
