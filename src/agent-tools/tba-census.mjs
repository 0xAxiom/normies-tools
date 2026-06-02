#!/usr/bin/env node
/**
 * tba-census.mjs — Population-level TBA deployment and funding scan.
 *
 * Reads the latest census snapshot, computes TBA addresses for all awakened
 * Normies, and batch-checks deployment status + ETH balances on mainnet and
 * Base using JSON-RPC batching. Produces aggregate stats and saves a
 * timestamped snapshot to data/tba-census/.
 *
 * Usage:
 *   node tba-census.mjs                   # full scan, human-readable
 *   node tba-census.mjs --json            # JSON output
 *   node tba-census.mjs --sample 100      # random sample instead of full scan
 *   node tba-census.mjs --stats           # latest snapshot stats, no RPC
 *   node tba-census.mjs --compare         # compare latest two snapshots
 */

import { ethers } from "ethers";
import fs from "node:fs";
import path from "node:path";
import { computeTBA } from "./tba-resolver.mjs";
import { CHAINS, loadEnv } from "../../skills/awaken-normie/scripts/lib.mjs";

const NORMIES_CONTRACT = "0x9Eb6E2025B64f340691e424b7fe7022fFDE12438";
const ACCOUNT_V3_IMPL = "0x55266d75D1a14E4572138116aF39863Ed6596E7F";
const TOOL_PASS_CONTRACT = "0xfc9ce3990f85fA1A3a0eE51a710642396a6Cad82";

const CENSUS_DIR = path.resolve(import.meta.dirname, "../../data/census");
const TBA_CENSUS_DIR = path.resolve(import.meta.dirname, "../../data/tba-census");

const RPC_BATCH_SIZE = 80;
const BATCH_DELAY_MS = 200;

function getRpcUrl(chain) {
  loadEnv();
  const c = CHAINS[chain];
  const url = typeof c.rpc === "function" ? c.rpc() : c.rpc;
  if (!url) throw new Error(`No RPC configured for ${chain}`);
  return url;
}

async function batchRpc(rpcUrl, calls) {
  const body = calls.map((c, i) => ({
    jsonrpc: "2.0",
    id: i,
    method: c.method,
    params: c.params,
  }));
  const resp = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`RPC batch failed: ${resp.status}`);
  const results = await resp.json();
  if (!Array.isArray(results)) return [results];
  results.sort((a, b) => a.id - b.id);
  return results;
}

async function batchCheck(rpcUrl, addresses, method) {
  const results = new Map();
  for (let i = 0; i < addresses.length; i += RPC_BATCH_SIZE) {
    const batch = addresses.slice(i, i + RPC_BATCH_SIZE);
    const calls = batch.map(addr => ({
      method,
      params: [addr, "latest"],
    }));
    const responses = await batchRpc(rpcUrl, calls);
    for (let j = 0; j < batch.length; j++) {
      const r = responses[j];
      results.set(batch[j], r?.result ?? null);
    }
    if (i + RPC_BATCH_SIZE < addresses.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
  }
  return results;
}

async function batchToolPassBalance(rpcUrl, addresses) {
  const iface = new ethers.Interface(["function balanceOf(address) view returns (uint256)"]);
  const results = new Map();
  for (let i = 0; i < addresses.length; i += RPC_BATCH_SIZE) {
    const batch = addresses.slice(i, i + RPC_BATCH_SIZE);
    const calls = batch.map(addr => ({
      method: "eth_call",
      params: [{ to: TOOL_PASS_CONTRACT, data: iface.encodeFunctionData("balanceOf", [addr]) }, "latest"],
    }));
    const responses = await batchRpc(rpcUrl, calls);
    for (let j = 0; j < batch.length; j++) {
      const r = responses[j];
      try {
        const bal = r?.result && r.result !== "0x" ? BigInt(r.result) : 0n;
        results.set(batch[j], bal);
      } catch {
        results.set(batch[j], 0n);
      }
    }
    if (i + RPC_BATCH_SIZE < addresses.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
  }
  return results;
}

function loadLatestCensus() {
  const files = fs.readdirSync(CENSUS_DIR)
    .filter(f => f.endsWith(".json"))
    .sort()
    .reverse();
  if (files.length === 0) throw new Error("No census snapshots found");
  const data = JSON.parse(fs.readFileSync(path.join(CENSUS_DIR, files[0]), "utf8"));
  return { date: files[0].replace(".json", ""), data };
}

function loadLatestTbaCensus() {
  if (!fs.existsSync(TBA_CENSUS_DIR)) return null;
  const files = fs.readdirSync(TBA_CENSUS_DIR)
    .filter(f => f.endsWith(".json"))
    .sort()
    .reverse();
  if (files.length === 0) return null;
  return JSON.parse(fs.readFileSync(path.join(TBA_CENSUS_DIR, files[0]), "utf8"));
}

function loadTwoPreviousTbaCensuses() {
  if (!fs.existsSync(TBA_CENSUS_DIR)) return [];
  const files = fs.readdirSync(TBA_CENSUS_DIR)
    .filter(f => f.endsWith(".json"))
    .sort()
    .reverse();
  return files.slice(0, 2).map(f =>
    JSON.parse(fs.readFileSync(path.join(TBA_CENSUS_DIR, f), "utf8"))
  );
}

function sampleArray(arr, n) {
  if (n >= arr.length) return arr;
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, n);
}

async function runCensus(agents, sampleSize) {
  const subset = sampleSize ? sampleArray(agents, sampleSize) : agents;
  const total = subset.length;

  process.stderr.write(`Computing TBA addresses for ${total} agents...\n`);
  const tbaMap = new Map();
  for (const agent of subset) {
    const tba = computeTBA(ACCOUNT_V3_IMPL, 1, NORMIES_CONTRACT, BigInt(agent.tokenId), 0n);
    tbaMap.set(agent.tokenId, tba);
  }
  const addresses = [...tbaMap.values()];

  const mainnetUrl = getRpcUrl("mainnet");
  const baseUrl = getRpcUrl("base");

  process.stderr.write(`Checking deployment status on mainnet (${Math.ceil(total / RPC_BATCH_SIZE)} batches)...\n`);
  const mainnetCode = await batchCheck(mainnetUrl, addresses, "eth_getCode");

  process.stderr.write(`Checking deployment status on Base (${Math.ceil(total / RPC_BATCH_SIZE)} batches)...\n`);
  const baseCode = await batchCheck(baseUrl, addresses, "eth_getCode");

  process.stderr.write(`Checking ETH balances on mainnet...\n`);
  const mainnetBal = await batchCheck(mainnetUrl, addresses, "eth_getBalance");

  process.stderr.write(`Checking ETH balances on Base...\n`);
  const baseBal = await batchCheck(baseUrl, addresses, "eth_getBalance");

  process.stderr.write(`Checking Tool Pass bonds on Base...\n`);
  const toolPassBal = await batchToolPassBalance(baseUrl, addresses);

  const results = [];
  let deployedL1 = 0, deployedBase = 0, deployedBoth = 0;
  let fundedL1 = 0, fundedBase = 0, fundedAny = 0;
  let toolPassBonded = 0;
  let totalEthL1 = 0n, totalEthBase = 0n;

  for (const agent of subset) {
    const tba = tbaMap.get(agent.tokenId);
    const l1Code = mainnetCode.get(tba);
    const bCode = baseCode.get(tba);
    const l1Bal = mainnetBal.get(tba);
    const bBal = baseBal.get(tba);
    const tpBal = toolPassBal.get(tba) || 0n;

    const isDeployedL1 = l1Code && l1Code !== "0x" && l1Code !== "0x0";
    const isDeployedBase = bCode && bCode !== "0x" && bCode !== "0x0";
    const l1Wei = l1Bal ? BigInt(l1Bal) : 0n;
    const baseWei = bBal ? BigInt(bBal) : 0n;

    if (isDeployedL1) deployedL1++;
    if (isDeployedBase) deployedBase++;
    if (isDeployedL1 && isDeployedBase) deployedBoth++;
    if (l1Wei > 0n) fundedL1++;
    if (baseWei > 0n) fundedBase++;
    if (l1Wei > 0n || baseWei > 0n) fundedAny++;
    if (tpBal > 0n) toolPassBonded++;
    totalEthL1 += l1Wei;
    totalEthBase += baseWei;

    results.push({
      tokenId: agent.tokenId,
      name: agent.name,
      type: agent.type,
      operator: agent.registeredBy,
      tba,
      deployedL1: !!isDeployedL1,
      deployedBase: !!isDeployedBase,
      l1Eth: ethers.formatEther(l1Wei),
      baseEth: ethers.formatEther(baseWei),
      toolPassCount: Number(tpBal),
    });
  }

  const topFundedL1 = results
    .filter(r => parseFloat(r.l1Eth) > 0)
    .sort((a, b) => parseFloat(b.l1Eth) - parseFloat(a.l1Eth))
    .slice(0, 10);

  const topFundedBase = results
    .filter(r => parseFloat(r.baseEth) > 0)
    .sort((a, b) => parseFloat(b.baseEth) - parseFloat(a.baseEth))
    .slice(0, 10);

  const deployedByOperator = {};
  for (const r of results) {
    if (r.deployedL1 || r.deployedBase) {
      deployedByOperator[r.operator] = (deployedByOperator[r.operator] || 0) + 1;
    }
  }
  const topDeployOperators = Object.entries(deployedByOperator)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([op, count]) => ({ operator: op, deployed: count }));

  const readinessDistribution = {
    level0_awakened_only: 0,
    level1_tba_one_chain: 0,
    level2_tba_both_chains: 0,
    level3_funded: 0,
    level4_tool_pass: 0,
  };

  for (const r of results) {
    if (r.toolPassCount > 0) readinessDistribution.level4_tool_pass++;
    else if (parseFloat(r.l1Eth) > 0 || parseFloat(r.baseEth) > 0) readinessDistribution.level3_funded++;
    else if (r.deployedL1 && r.deployedBase) readinessDistribution.level2_tba_both_chains++;
    else if (r.deployedL1 || r.deployedBase) readinessDistribution.level1_tba_one_chain++;
    else readinessDistribution.level0_awakened_only++;
  }

  return {
    meta: {
      date: new Date().toISOString().split("T")[0],
      scanned: total,
      totalPopulation: agents.length,
      sampled: !!sampleSize,
    },
    deployment: {
      l1: { count: deployedL1, pct: pct(deployedL1, total) },
      base: { count: deployedBase, pct: pct(deployedBase, total) },
      both: { count: deployedBoth, pct: pct(deployedBoth, total) },
      neither: { count: total - (deployedL1 + deployedBase - deployedBoth), pct: pct(total - (deployedL1 + deployedBase - deployedBoth), total) },
    },
    funding: {
      l1: { count: fundedL1, pct: pct(fundedL1, total) },
      base: { count: fundedBase, pct: pct(fundedBase, total) },
      any: { count: fundedAny, pct: pct(fundedAny, total) },
      totalEthL1: ethers.formatEther(totalEthL1),
      totalEthBase: ethers.formatEther(totalEthBase),
    },
    toolPass: {
      bonded: toolPassBonded,
      pct: pct(toolPassBonded, total),
    },
    readinessDistribution,
    topFundedL1,
    topFundedBase,
    topDeployOperators,
    agents: results,
  };
}

function pct(n, total) {
  return total > 0 ? `${((n / total) * 100).toFixed(1)}%` : "0%";
}

function saveSnapshot(data) {
  if (!fs.existsSync(TBA_CENSUS_DIR)) fs.mkdirSync(TBA_CENSUS_DIR, { recursive: true });
  const file = path.join(TBA_CENSUS_DIR, `${data.meta.date}.json`);
  const slim = { ...data, agents: data.agents };
  fs.writeFileSync(file, JSON.stringify(slim, null, 2));
  return file;
}

function printReport(data) {
  const bar = "=".repeat(64);
  console.log(`\n${bar}`);
  console.log(`  TBA CENSUS — ${data.meta.date}`);
  console.log(`  ${data.meta.scanned} agents scanned${data.meta.sampled ? ` (sampled from ${data.meta.totalPopulation})` : ""}`);
  console.log(`${bar}\n`);

  console.log("  DEPLOYMENT STATUS");
  console.log(`    Mainnet TBA deployed:  ${data.deployment.l1.count} (${data.deployment.l1.pct})`);
  console.log(`    Base TBA deployed:     ${data.deployment.base.count} (${data.deployment.base.pct})`);
  console.log(`    Both chains:           ${data.deployment.both.count} (${data.deployment.both.pct})`);
  console.log(`    Neither (awaken only): ${data.deployment.neither.count} (${data.deployment.neither.pct})\n`);

  console.log("  FUNDING");
  console.log(`    Funded on mainnet:  ${data.funding.l1.count} (${data.funding.l1.pct})`);
  console.log(`    Funded on Base:     ${data.funding.base.count} (${data.funding.base.pct})`);
  console.log(`    Funded anywhere:    ${data.funding.any.count} (${data.funding.any.pct})`);
  console.log(`    Total ETH (L1):     ${data.funding.totalEthL1} ETH`);
  console.log(`    Total ETH (Base):   ${data.funding.totalEthBase} ETH\n`);

  console.log("  TOOL PASS");
  console.log(`    Bonded to TBA:  ${data.toolPass.bonded} (${data.toolPass.pct})\n`);

  console.log("  READINESS DISTRIBUTION");
  const rd = data.readinessDistribution;
  console.log(`    Level 0 — Awakened only:     ${rd.level0_awakened_only}`);
  console.log(`    Level 1 — TBA (one chain):   ${rd.level1_tba_one_chain}`);
  console.log(`    Level 2 — TBA (both chains): ${rd.level2_tba_both_chains}`);
  console.log(`    Level 3 — Funded:            ${rd.level3_funded}`);
  console.log(`    Level 4 — Tool Pass bonded:  ${rd.level4_tool_pass}\n`);

  if (data.topFundedL1.length > 0) {
    console.log("  TOP FUNDED (Mainnet)");
    for (const r of data.topFundedL1.slice(0, 5)) {
      console.log(`    #${r.tokenId} ${r.name} — ${r.l1Eth} ETH`);
    }
    console.log();
  }

  if (data.topFundedBase.length > 0) {
    console.log("  TOP FUNDED (Base)");
    for (const r of data.topFundedBase.slice(0, 5)) {
      console.log(`    #${r.tokenId} ${r.name} — ${r.baseEth} ETH`);
    }
    console.log();
  }

  if (data.topDeployOperators.length > 0) {
    console.log("  TOP OPERATORS (by deployed TBAs)");
    for (const o of data.topDeployOperators.slice(0, 5)) {
      console.log(`    ${o.operator.slice(0, 10)}... — ${o.deployed} deployed`);
    }
    console.log();
  }
}

function printCompare(latest, previous) {
  console.log(`\n  COMPARE: ${previous.meta.date} → ${latest.meta.date}\n`);
  const d = (a, b) => a - b;
  const dp = latest.deployment, pp = previous.deployment;
  console.log(`  Deployed L1:   ${pp.l1.count} → ${dp.l1.count} (${d(dp.l1.count, pp.l1.count) >= 0 ? "+" : ""}${d(dp.l1.count, pp.l1.count)})`);
  console.log(`  Deployed Base: ${pp.base.count} → ${dp.base.count} (${d(dp.base.count, pp.base.count) >= 0 ? "+" : ""}${d(dp.base.count, pp.base.count)})`);
  console.log(`  Funded:        ${pp.funding.any.count} → ${latest.funding.any.count} (${d(latest.funding.any.count, pp.funding.any.count) >= 0 ? "+" : ""}${d(latest.funding.any.count, pp.funding.any.count)})`);
  console.log(`  Tool Pass:     ${pp.toolPass.bonded} → ${latest.toolPass.bonded} (${d(latest.toolPass.bonded, pp.toolPass.bonded) >= 0 ? "+" : ""}${d(latest.toolPass.bonded, pp.toolPass.bonded)})\n`);
}

function printStatsOnly() {
  const data = loadLatestTbaCensus();
  if (!data) {
    console.error("No TBA census snapshots found. Run without --stats first.");
    process.exit(1);
  }
  printReport(data);
}

async function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");
  const statsOnly = args.includes("--stats");
  const compareMode = args.includes("--compare");

  if (statsOnly) {
    if (jsonMode) {
      const data = loadLatestTbaCensus();
      if (!data) { console.error("No snapshots"); process.exit(1); }
      const { agents: _, ...summary } = data;
      console.log(JSON.stringify(summary, null, 2));
    } else {
      printStatsOnly();
    }
    return;
  }

  if (compareMode) {
    const [latest, previous] = loadTwoPreviousTbaCensuses();
    if (!latest || !previous) {
      console.error("Need at least 2 TBA census snapshots for comparison.");
      process.exit(1);
    }
    if (jsonMode) {
      console.log(JSON.stringify({ latest: latest.meta, previous: previous.meta }));
    } else {
      printCompare(latest, previous);
    }
    return;
  }

  const sampleIdx = args.indexOf("--sample");
  const sampleSize = sampleIdx >= 0 ? parseInt(args[sampleIdx + 1]) : null;

  const { data: census } = loadLatestCensus();
  const result = await runCensus(census.agents, sampleSize);

  const file = saveSnapshot(result);
  process.stderr.write(`Snapshot saved: ${file}\n`);

  if (jsonMode) {
    const { agents: _, ...summary } = result;
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printReport(result);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
