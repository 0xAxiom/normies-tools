#!/usr/bin/env node
/**
 * wallet-report.mjs — Complete portfolio view for any Normie operator.
 *
 * Combines fleet discovery (census), readiness checks (on-chain), and
 * activation cost estimates into a single report. Shows every Normie
 * the wallet operates, scored and costed, with a prioritized action plan.
 *
 * Usage:
 *   node wallet-report.mjs 0x523Eff3dB03938eaa31a5a6FBd41E3B9d23edde5
 *   node wallet-report.mjs 0x523E...dde5 --json
 *   node wallet-report.mjs 0x523E...dde5 --deep   # includes activation costs
 */

import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { computeTBA } from "./tba-resolver.mjs";
import {
  CHAINS, ADAPTER_ABI, REGISTRY_ABI, ERC721_ABI,
  loadEnv, getProvider,
} from "../../skills/awaken-normie/scripts/lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CENSUS_DIR = path.join(__dirname, "../../data/census");

const NORMIES_CONTRACT = "0x9Eb6E2025B64f340691e424b7fe7022fFDE12438";
const ACCOUNT_V3_IMPL = "0x55266d75D1a14E4572138116aF39863Ed6596E7F";
const TOOL_PASS_CONTRACT = "0xfc9ce3990f85fA1A3a0eE51a710642396a6Cad82";
const ERC6551_REGISTRY = "0x000000006551c19487814612e58FE06813775758";
const API_BASE = "https://api.normies.art";
const SALT = ethers.zeroPadValue("0x00", 32);

const ERC6551_REGISTRY_ABI = [
  "function createAccount(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId) external returns (address)",
];
const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];
const ERC721_BALANCE_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
];

function loadLatestCensus() {
  if (!fs.existsSync(CENSUS_DIR)) return null;
  const files = fs.readdirSync(CENSUS_DIR).filter(f => f.endsWith(".json")).sort();
  if (files.length === 0) return null;
  const latest = files[files.length - 1];
  return {
    agents: JSON.parse(fs.readFileSync(path.join(CENSUS_DIR, latest), "utf-8")).agents || [],
    filename: latest,
  };
}

function formatDate(unixTs) {
  return new Date(Number(unixTs) * 1000).toISOString().split("T")[0];
}

async function fetchJSON(url) {
  const resp = await fetch(url, {
    headers: { "User-Agent": "normies-tools/wallet-report" },
  });
  if (!resp.ok) return null;
  return resp.json();
}

async function fetchEthPrice() {
  try {
    const resp = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
      { headers: { "User-Agent": "normies-tools" } }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.ethereum?.usd || null;
  } catch {
    return null;
  }
}

async function checkNormieReadiness(tokenId, mainnetProvider, baseProvider, toolPassContract) {
  const tbaAddress = computeTBA(
    ACCOUNT_V3_IMPL, 1, NORMIES_CONTRACT, BigInt(tokenId), 0n
  );

  const normies = new ethers.Contract(NORMIES_CONTRACT, ERC721_ABI, mainnetProvider);

  const [owner, agentInfo, l1Code, baseCode, toolPassBal, l1Balance, baseBalance] =
    await Promise.all([
      normies.ownerOf(tokenId).catch(() => null),
      fetchJSON(`${API_BASE}/agents/info/${tokenId}`),
      mainnetProvider.getCode(tbaAddress),
      baseProvider.getCode(tbaAddress),
      toolPassContract.balanceOf(tbaAddress).catch(() => 0n),
      mainnetProvider.getBalance(tbaAddress),
      baseProvider.getBalance(tbaAddress),
    ]);

  const l1Deployed = l1Code !== "0x";
  const baseDeployed = baseCode !== "0x";
  const awakened = !!agentInfo?.agentId;
  const hasToolPass = toolPassBal > 0n;
  const funded = l1Balance > 0n || baseBalance > 0n;
  const crossChain = l1Deployed && baseDeployed;
  const hasPersona = !!agentInfo?.systemPrompt;

  const checks = { owner, awakened, l1Deployed, baseDeployed, hasToolPass, funded, crossChain, hasPersona };
  const score = [!!owner, awakened, l1Deployed && baseDeployed, hasToolPass, funded, crossChain, hasPersona]
    .filter(Boolean).length;

  const steps = [];
  if (!awakened) steps.push({ action: "awaken", cmd: `node awaken-batch.mjs ${tokenId} --send`, chain: "mainnet" });
  if (!l1Deployed) steps.push({ action: "deploy-l1-tba", cmd: `node tba-deployer.mjs ${tokenId} --chain mainnet --live`, chain: "mainnet" });
  if (!baseDeployed) steps.push({ action: "deploy-base-tba", cmd: `node tba-deployer.mjs ${tokenId} --chain base --live`, chain: "base" });
  if (!funded) steps.push({ action: "fund", cmd: `Send ETH to ${tbaAddress}`, chain: "base" });
  if (!hasToolPass) steps.push({ action: "bond-toolpass", cmd: `Transfer Tool Pass NFT to ${tbaAddress} on Base`, chain: "base" });

  return {
    tokenId,
    name: agentInfo?.name || null,
    type: agentInfo?.type || null,
    agentId: agentInfo?.agentId || null,
    tba: tbaAddress,
    score,
    total: 7,
    level: score === 7 ? "AUTONOMOUS" : score >= 5 ? "NEARLY READY" : score >= 3 ? "PARTIAL" : "EARLY",
    l1Eth: ethers.formatEther(l1Balance),
    baseEth: ethers.formatEther(baseBalance),
    checks,
    steps,
  };
}

async function estimateActivationCost(steps, gasPrices) {
  const GAS_ESTIMATES = {
    "awaken": { chain: "mainnet", gas: 180000n },
    "deploy-l1-tba": { chain: "mainnet", gas: 96000n },
    "deploy-base-tba": { chain: "base", gas: 96000n },
    "fund": { chain: "base", gas: 0n, fixed: 0.002 },
    "bond-toolpass": { chain: "base", gas: 65000n },
  };

  let totalEth = 0;
  const costed = [];
  for (const step of steps) {
    const est = GAS_ESTIMATES[step.action];
    if (!est) continue;
    let ethCost;
    if (est.fixed) {
      ethCost = est.fixed;
    } else {
      const gp = est.chain === "mainnet" ? gasPrices.mainnet.gasPrice : gasPrices.base.gasPrice;
      ethCost = parseFloat(ethers.formatEther(est.gas * gp));
    }
    const usdCost = gasPrices.ethPriceUsd ? ethCost * gasPrices.ethPriceUsd : null;
    totalEth += ethCost;
    costed.push({ ...step, ethCost, usdCost });
  }

  return {
    steps: costed,
    totalEth,
    totalUsd: gasPrices.ethPriceUsd ? totalEth * gasPrices.ethPriceUsd : null,
  };
}

function printReport(address, normies, censusInfo, costs) {
  const bar = "=".repeat(70);
  console.log(`\n${bar}`);
  console.log(`  WALLET REPORT — ${address}`);
  console.log(`${bar}\n`);

  if (censusInfo) {
    console.log(`  Census: ${censusInfo.filename} (${censusInfo.totalAgents} total agents)`);
  }
  console.log(`  Normies operated: ${normies.length}`);

  const avgScore = normies.reduce((s, n) => s + n.score, 0) / normies.length;
  const fullyReady = normies.filter(n => n.score === 7).length;
  console.log(`  Average readiness: ${avgScore.toFixed(1)}/7`);
  console.log(`  Fully autonomous: ${fullyReady}/${normies.length}`);
  console.log();

  // Table
  console.log("  Token  | Name                 | Score | Level          | L1 ETH     | Base ETH   ");
  console.log("  -------|----------------------|-------|----------------|------------|------------");
  for (const n of normies) {
    const name = (n.name || "?").padEnd(20).slice(0, 20);
    const level = n.level.padEnd(14).slice(0, 14);
    const l1 = parseFloat(n.l1Eth).toFixed(5).padStart(10);
    const base = parseFloat(n.baseEth).toFixed(5).padStart(10);
    console.log(`  #${String(n.tokenId).padEnd(5)}| ${name}| ${n.score}/7   | ${level}| ${l1} | ${base}`);
  }
  console.log();

  // Action plan
  const allSteps = normies.flatMap(n => n.steps.map(s => ({ tokenId: n.tokenId, name: n.name, ...s })));
  const hasErrors = normies.some(n => n.level === "ERROR");
  if (allSteps.length === 0 && !hasErrors) {
    console.log("  All Normies are fully autonomous. No actions needed.\n");
    return;
  }
  if (allSteps.length === 0 && hasErrors) {
    console.log("  Some Normies had errors — retry later.\n");
    return;
  }

  console.log(`  ACTION PLAN (${allSteps.length} steps across ${normies.filter(n => n.steps.length > 0).length} Normies):\n`);

  if (costs) {
    let stepNum = 0;
    for (const n of normies) {
      if (n.steps.length === 0) continue;
      const nCosts = costs.get(n.tokenId);
      if (!nCosts) continue;
      console.log(`  Normie #${n.tokenId} (${n.name || "?"}) — ${n.score}/7:`);
      for (const s of nCosts.steps) {
        stepNum++;
        const usd = s.usdCost !== null ? `$${s.usdCost.toFixed(2)}` : "?";
        console.log(`    ${stepNum}. [${s.chain}] ${s.action} — ${s.ethCost.toFixed(6)} ETH (~${usd})`);
        console.log(`       ${s.cmd}`);
      }
      console.log();
    }
    const totalUsd = Array.from(costs.values()).reduce((s, c) => s + (c.totalUsd || 0), 0);
    const totalEth = Array.from(costs.values()).reduce((s, c) => s + c.totalEth, 0);
    console.log(`  TOTAL ESTIMATED COST: ${totalEth.toFixed(6)} ETH (~$${totalUsd.toFixed(2)})\n`);
  } else {
    let stepNum = 0;
    for (const n of normies) {
      if (n.steps.length === 0) continue;
      console.log(`  Normie #${n.tokenId} (${n.name || "?"}) — ${n.score}/7:`);
      for (const s of n.steps) {
        stepNum++;
        console.log(`    ${stepNum}. [${s.chain}] ${s.action}`);
        console.log(`       ${s.cmd}`);
      }
      console.log();
    }
    console.log("  Use --deep for cost estimates.\n");
  }
}

async function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");
  const deepMode = args.includes("--deep");

  const address = args.find(a => a.startsWith("0x") && a.length >= 40);
  if (!address) {
    console.error("Usage: node wallet-report.mjs <wallet-address> [--json] [--deep]");
    console.error("\n  --json    Machine-readable output");
    console.error("  --deep    Include activation cost estimates (uses live gas prices)");
    process.exit(1);
  }

  const census = loadLatestCensus();
  if (!census) {
    console.error("No census data. Run: python3 src/agent-tools/census-snapshot.py");
    process.exit(1);
  }

  const fleet = census.agents.filter(
    a => a.registeredBy.toLowerCase() === address.toLowerCase()
  );

  if (fleet.length === 0) {
    console.error(`No agents found for operator ${address} in census (${census.agents.length} total).`);
    console.error("If this wallet recently awakened agents, run census-snapshot.py first.");
    process.exit(1);
  }

  loadEnv();
  const mainnetProvider = getProvider("mainnet");
  const baseProvider = getProvider("base");
  const toolPassContract = new ethers.Contract(TOOL_PASS_CONTRACT, ERC721_BALANCE_ABI, baseProvider);

  console.error(`Checking ${fleet.length} Normie(s) for ${address}...`);

  const results = [];
  for (const agent of fleet) {
    try {
      const result = await checkNormieReadiness(
        agent.tokenId, mainnetProvider, baseProvider, toolPassContract
      );
      results.push(result);
    } catch (err) {
      console.error(`  Error checking #${agent.tokenId}: ${err.message}`);
      results.push({
        tokenId: agent.tokenId,
        name: agent.name,
        score: 0, total: 7, level: "ERROR",
        l1Eth: "0", baseEth: "0",
        checks: {}, steps: [],
        error: err.message,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);

  let costs = null;
  if (deepMode) {
    try {
      const [mainnetFee, baseFee, ethPrice] = await Promise.all([
        mainnetProvider.getFeeData(),
        baseProvider.getFeeData(),
        fetchEthPrice(),
      ]);
      const gasPrices = {
        mainnet: { gasPrice: mainnetFee.gasPrice || mainnetFee.maxFeePerGas || 0n },
        base: { gasPrice: baseFee.gasPrice || baseFee.maxFeePerGas || 0n },
        ethPriceUsd: ethPrice,
      };
      costs = new Map();
      for (const r of results) {
        if (r.steps.length > 0) {
          costs.set(r.tokenId, await estimateActivationCost(r.steps, gasPrices));
        }
      }
    } catch (err) {
      console.error(`  Cost estimation failed: ${err.message}`);
    }
  }

  if (jsonMode) {
    const output = {
      operator: address,
      census: { file: census.filename, totalAgents: census.agents.length },
      fleetSize: results.length,
      averageReadiness: +(results.reduce((s, n) => s + n.score, 0) / results.length).toFixed(1),
      fullyAutonomous: results.filter(n => n.score === 7).length,
      normies: results,
    };
    if (costs) {
      output.activationCosts = Object.fromEntries(
        Array.from(costs.entries()).map(([k, v]) => [k, v])
      );
      output.totalCostEth = Array.from(costs.values()).reduce((s, c) => s + c.totalEth, 0);
      output.totalCostUsd = Array.from(costs.values()).reduce((s, c) => s + (c.totalUsd || 0), 0);
    }
    console.log(JSON.stringify(output, null, 2));
  } else {
    printReport(
      address, results,
      { filename: census.filename, totalAgents: census.agents.length },
      costs
    );
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
