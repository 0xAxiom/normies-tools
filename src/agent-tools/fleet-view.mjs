#!/usr/bin/env node
/**
 * fleet-view.mjs — View all Normies operated by a given wallet address.
 *
 * Reads from local census snapshot (data/census/) to find all agents
 * registered by the specified operator. Shows name, type, tokenId, agentId,
 * TBA address, and registration date.
 *
 * Usage:
 *   node fleet-view.mjs 0x523Eff3dB03938eaa31a5a6FBd41E3B9d23edde5
 *   node fleet-view.mjs 0x523E...dde5 --json
 *   node fleet-view.mjs --top 5          # top 5 operators by fleet size
 *   node fleet-view.mjs --stats          # operator distribution stats
 */

import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CENSUS_DIR = path.join(__dirname, "../../data/census");

// ERC-6551 constants (same as tba-resolver.mjs)
const ERC6551_REGISTRY = "0x000000006551c19487814612e58FE06813775758";
const ACCOUNT_V3_IMPL = "0x55266d75D1a14E4572138116aF39863Ed6596E7F";
const NORMIES_CONTRACT = "0x9Eb6E2025B64f340691e424b7fe7022fFDE12438";
const NORMIES_CHAIN_ID = 1;
const SALT = 0n;

function computeTBA(tokenId) {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  // Match canonical tba-resolver.mjs logic exactly
  const proxyBytecode = ethers.concat([
    "0x3d60ad80600a3d3981f3363d3d373d3d3d363d73",
    ACCOUNT_V3_IMPL,
    "0x5af43d82803e903d91602b57fd5bf3",
  ]);
  const context = abiCoder.encode(
    ["uint256", "uint256", "address", "uint256"],
    [SALT, BigInt(NORMIES_CHAIN_ID), NORMIES_CONTRACT, BigInt(tokenId)]
  );
  const fullBytecode = ethers.concat([proxyBytecode, context]);
  const bytecodeHash = ethers.keccak256(fullBytecode);
  const saltBytes = ethers.zeroPadValue(ethers.toBeHex(SALT || 0), 32);
  return ethers.getCreate2Address(ERC6551_REGISTRY, saltBytes, bytecodeHash);
}

function loadLatestCensus() {
  if (!fs.existsSync(CENSUS_DIR)) {
    console.error("No census data found. Run: python3 src/agent-tools/census-snapshot.py");
    process.exit(1);
  }
  const files = fs.readdirSync(CENSUS_DIR).filter(f => f.endsWith(".json")).sort();
  if (files.length === 0) {
    console.error("No census snapshots found.");
    process.exit(1);
  }
  const latest = files[files.length - 1];
  const data = JSON.parse(fs.readFileSync(path.join(CENSUS_DIR, latest), "utf-8"));
  return { data, filename: latest };
}

function formatDate(unixTs) {
  return new Date(Number(unixTs) * 1000).toISOString().split("T")[0];
}

function showFleet(address, agents, jsonMode) {
  const fleet = agents
    .filter(a => a.registeredBy.toLowerCase() === address.toLowerCase())
    .sort((a, b) => Number(b.agentId) - Number(a.agentId));

  if (fleet.length === 0) {
    console.error(`No agents found for operator ${address}`);
    process.exit(1);
  }

  if (jsonMode) {
    const result = fleet.map(a => ({
      ...a,
      tba: computeTBA(a.tokenId),
      registeredDate: formatDate(a.registeredAt),
    }));
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`\nOperator: ${address}`);
  console.log(`Fleet size: ${fleet.length} agents\n`);
  console.log("  Token  | Agent  | Type   | Name                 | TBA                                        | Registered");
  console.log("  -------|--------|--------|----------------------|--------------------------------------------|------------");
  for (const a of fleet) {
    const tba = computeTBA(a.tokenId);
    const name = (a.name || "?").padEnd(20).slice(0, 20);
    const type = (a.type || "?").padEnd(6).slice(0, 6);
    console.log(
      `  #${String(a.tokenId).padEnd(5)}| ${String(a.agentId).padEnd(6)}| ${type}| ${name}| ${tba} | ${formatDate(a.registeredAt)}`
    );
  }
  console.log("");
}

function showTopOperators(agents, n) {
  const counts = {};
  for (const a of agents) {
    const op = a.registeredBy.toLowerCase();
    counts[op] = (counts[op] || 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n);
  console.log(`\nTop ${n} operators by fleet size (total ${agents.length} agents, ${Object.keys(counts).length} operators):\n`);
  console.log("  Rank | Agents | Operator");
  console.log("  -----|--------|------------------------------------------");
  for (let i = 0; i < sorted.length; i++) {
    const [addr, count] = sorted[i];
    console.log(`  ${String(i + 1).padStart(4)} | ${String(count).padStart(6)} | ${addr}`);
  }
  console.log("");
}

function showStats(agents) {
  const counts = {};
  for (const a of agents) {
    const op = a.registeredBy.toLowerCase();
    counts[op] = (counts[op] || 0) + 1;
  }
  const sizes = Object.values(counts).sort((a, b) => b - a);
  const total = agents.length;
  const operators = sizes.length;
  const solo = sizes.filter(s => s === 1).length;
  const multi = operators - solo;
  const top10pct = sizes.slice(0, Math.ceil(operators * 0.1)).reduce((s, v) => s + v, 0);

  console.log(`\nOperator distribution (census: ${total} agents):\n`);
  console.log(`  Total operators:     ${operators}`);
  console.log(`  Solo (1 agent):      ${solo} (${((solo / operators) * 100).toFixed(1)}%)`);
  console.log(`  Multi (2+ agents):   ${multi} (${((multi / operators) * 100).toFixed(1)}%)`);
  console.log(`  Max fleet:           ${sizes[0]}`);
  console.log(`  Median fleet:        ${sizes[Math.floor(sizes.length / 2)]}`);
  console.log(`  Top 10% control:     ${top10pct} agents (${((top10pct / total) * 100).toFixed(1)}% of total)`);
  console.log("");

  // Distribution buckets
  const buckets = [1, 2, 5, 10, 20, 50, 100];
  console.log("  Fleet size | Operators");
  console.log("  -----------|----------");
  for (let i = 0; i < buckets.length; i++) {
    const lo = buckets[i];
    const hi = i < buckets.length - 1 ? buckets[i + 1] - 1 : Infinity;
    const label = hi === Infinity ? `${lo}+` : lo === hi ? `${lo}` : `${lo}-${hi}`;
    const count = sizes.filter(s => s >= lo && s <= hi).length;
    if (count > 0) {
      console.log(`  ${label.padEnd(11)}| ${count}`);
    }
  }
  console.log("");
}

// --- Main ---
const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const statsMode = args.includes("--stats");
const topIdx = args.indexOf("--top");

const { data, filename } = loadLatestCensus();
const agents = data.agents || [];

console.log(`[census: ${filename}, ${agents.length} agents]`);

if (statsMode) {
  showStats(agents);
} else if (topIdx !== -1) {
  const n = parseInt(args[topIdx + 1]) || 10;
  showTopOperators(agents, n);
} else {
  const address = args.find(a => a.startsWith("0x") && a.length >= 40);
  if (!address) {
    console.error("Usage: node fleet-view.mjs <operator-address> [--json]");
    console.error("       node fleet-view.mjs --top [N]");
    console.error("       node fleet-view.mjs --stats");
    process.exit(1);
  }
  showFleet(address, agents, jsonMode);
}
