#!/usr/bin/env node
/**
 * activation-planner.mjs — Estimate costs and plan the full activation path
 * for any Normie to reach full on-chain autonomy.
 *
 * Uses live gas prices on mainnet + Base. Covers: awakening, TBA deployment,
 * Tool Pass bonding, funding, and cross-chain execution readiness.
 *
 * Usage:
 *   node activation-planner.mjs 7593
 *   node activation-planner.mjs 7593 --json
 *   node activation-planner.mjs --batch 294,3837,7593
 *   node activation-planner.mjs 7593 --min-base-eth 0.005
 */

import { ethers } from "ethers";
import { computeTBA } from "./tba-resolver.mjs";
import {
  CHAINS, ADAPTER_ABI, REGISTRY_ABI, ERC721_ABI,
  loadEnv, getProvider,
} from "../../skills/awaken-normie/scripts/lib.mjs";

const NORMIES_CONTRACT = "0x9Eb6E2025B64f340691e424b7fe7022fFDE12438";
const ACCOUNT_V3_IMPL = "0x55266d75D1a14E4572138116aF39863Ed6596E7F";
const TOOL_PASS_CONTRACT = "0xfc9ce3990f85fA1A3a0eE51a710642396a6Cad82";
const ERC6551_REGISTRY = "0x000000006551c19487814612e58FE06813775758";
const API_BASE = "https://api.normies.art";
const SALT = ethers.zeroPadValue("0x00", 32);

const ERC6551_REGISTRY_ABI = [
  "function createAccount(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId) external returns (address)",
];

const ERC721_BALANCE_ABI = [
  "function balanceOf(address) view returns (uint256)",
];

const DEFAULT_MIN_BASE_ETH = 0.002; // minimum ETH on Base for a few TXs

async function fetchJSON(url) {
  const resp = await fetch(url, {
    headers: { "User-Agent": "normies-tools/activation-planner" },
  });
  if (!resp.ok) return null;
  return resp.json();
}

async function getGasPrices() {
  loadEnv();
  const mainnetProvider = getProvider("mainnet");
  const baseProvider = getProvider("base");
  const [mainnetFee, baseFee, ethPrice] = await Promise.all([
    mainnetProvider.getFeeData(),
    baseProvider.getFeeData(),
    fetchEthPrice(),
  ]);
  return {
    mainnet: {
      gasPrice: mainnetFee.gasPrice || mainnetFee.maxFeePerGas || 0n,
      provider: mainnetProvider,
    },
    base: {
      gasPrice: baseFee.gasPrice || baseFee.maxFeePerGas || 0n,
      provider: baseProvider,
    },
    ethPriceUsd: ethPrice,
  };
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

async function planActivation(tokenId, gas, opts = {}) {
  const minBaseEth = opts.minBaseEth || DEFAULT_MIN_BASE_ETH;
  const tbaAddress = computeTBA(
    ACCOUNT_V3_IMPL, 1, NORMIES_CONTRACT, BigInt(tokenId), 0n
  );

  const normies = new ethers.Contract(NORMIES_CONTRACT, ERC721_ABI, gas.mainnet.provider);
  const adapter = new ethers.Contract(CHAINS.mainnet.adapter, ADAPTER_ABI, gas.mainnet.provider);
  const toolPass = new ethers.Contract(TOOL_PASS_CONTRACT, ERC721_BALANCE_ABI, gas.base.provider);

  const delay = ms => new Promise(r => setTimeout(r, ms));

  const owner = await normies.ownerOf(tokenId).catch(() => null);
  const agentInfo = await fetchJSON(`${API_BASE}/agents/info/${tokenId}`);
  await delay(1000);
  const l1Code = await gas.mainnet.provider.getCode(tbaAddress);
  const l1Balance = await gas.mainnet.provider.getBalance(tbaAddress);
  await delay(1000);
  const baseCode = await gas.base.provider.getCode(tbaAddress);
  const toolPassBal = await toolPass.balanceOf(tbaAddress).catch(() => 0n);
  const baseBalance = await gas.base.provider.getBalance(tbaAddress);

  const state = {
    owned: !!owner,
    owner,
    awakened: !!agentInfo?.agentId,
    agentId: agentInfo?.agentId || null,
    name: agentInfo?.name || null,
    tbaL1Deployed: l1Code !== "0x",
    tbaBaseDeployed: baseCode !== "0x",
    toolPassBonded: toolPassBal > 0n,
    l1Eth: l1Balance,
    baseEth: baseBalance,
    hasPersona: !!agentInfo?.systemPrompt,
  };

  const steps = [];
  let totalMainnetGas = 0n;
  let totalBaseGas = 0n;
  let totalEthNeeded = 0n; // additional ETH to send to TBA

  // Step 1: Awakening (if needed)
  if (!state.awakened && state.owned) {
    const awakenGas = 200000n; // Adapter8004 registerAgent ~150-200k
    steps.push({
      order: 1,
      action: "awaken",
      chain: "mainnet",
      description: "Register as ERC-8004 agent via Adapter8004",
      command: `node skills/awaken-normie/scripts/awaken.mjs ${tokenId}  # dry-run; submit printed to/calldata via Bankr`,
      estimatedGas: awakenGas.toString(),
      costEth: ethers.formatEther(awakenGas * gas.mainnet.gasPrice),
      status: "required",
    });
    totalMainnetGas += awakenGas;
  }

  // Step 2: Deploy L1 TBA
  if (!state.tbaL1Deployed) {
    let deployGas = 96000n;
    try {
      const registry = new ethers.Contract(ERC6551_REGISTRY, ERC6551_REGISTRY_ABI, gas.mainnet.provider);
      const est = await gas.mainnet.provider.estimateGas({
        to: ERC6551_REGISTRY,
        data: registry.interface.encodeFunctionData("createAccount", [
          ACCOUNT_V3_IMPL, SALT, 1n, NORMIES_CONTRACT, BigInt(tokenId),
        ]),
      });
      deployGas = est;
    } catch {}
    steps.push({
      order: 2,
      action: "deploy-tba-l1",
      chain: "mainnet",
      description: "Deploy ERC-6551 TBA on Ethereum mainnet",
      command: `node tba-deployer.mjs ${tokenId} --chain mainnet --live`,
      estimatedGas: deployGas.toString(),
      costEth: ethers.formatEther(deployGas * gas.mainnet.gasPrice),
      status: "required",
    });
    totalMainnetGas += deployGas;
  }

  // Step 3: Deploy Base TBA
  if (!state.tbaBaseDeployed) {
    let deployGas = 96000n;
    try {
      const registry = new ethers.Contract(ERC6551_REGISTRY, ERC6551_REGISTRY_ABI, gas.base.provider);
      const est = await gas.base.provider.estimateGas({
        to: ERC6551_REGISTRY,
        data: registry.interface.encodeFunctionData("createAccount", [
          ACCOUNT_V3_IMPL, SALT, 1n, NORMIES_CONTRACT, BigInt(tokenId),
        ]),
      });
      deployGas = est;
    } catch {}
    steps.push({
      order: 3,
      action: "deploy-tba-base",
      chain: "base",
      description: "Deploy ERC-6551 TBA on Base",
      command: `node tba-deployer.mjs ${tokenId} --chain base --live`,
      estimatedGas: deployGas.toString(),
      costEth: ethers.formatEther(deployGas * gas.base.gasPrice),
      status: "required",
    });
    totalBaseGas += deployGas;
  }

  // Step 4: Fund Base TBA
  const minBaseWei = ethers.parseEther(minBaseEth.toString());
  if (baseBalance < minBaseWei) {
    const deficit = minBaseWei - baseBalance;
    steps.push({
      order: 4,
      action: "fund-base-tba",
      chain: "base",
      description: `Send ETH to TBA on Base (minimum ${minBaseEth} ETH for gas)`,
      command: `cast send ${tbaAddress} --value ${ethers.formatEther(deficit)} --rpc-url base`,
      estimatedGas: "21000",
      costEth: ethers.formatEther(deficit + 21000n * gas.base.gasPrice),
      fundingEth: ethers.formatEther(deficit),
      status: "required",
    });
    totalEthNeeded += deficit;
    totalBaseGas += 21000n;
  }

  // Step 5: Bond Tool Pass
  if (!state.toolPassBonded) {
    const transferGas = 65000n; // ERC-721 safeTransferFrom
    steps.push({
      order: 5,
      action: "bond-toolpass",
      chain: "base",
      description: "Transfer Tool Pass NFT to TBA on Base (PERMANENT — irreversible)",
      command: `node toolpass-bond.mjs ${tokenId} --transfer`,
      estimatedGas: transferGas.toString(),
      costEth: ethers.formatEther(transferGas * gas.base.gasPrice),
      status: "requires-approval",
      warning: "Irreversible. Tool Pass permanently bound to Normie's TBA.",
    });
    totalBaseGas += transferGas;
  }

  // Cost summary
  const mainnetGasCost = totalMainnetGas * gas.mainnet.gasPrice;
  const baseGasCost = totalBaseGas * gas.base.gasPrice;
  const totalGasCost = mainnetGasCost + baseGasCost;
  const totalCost = totalGasCost + totalEthNeeded;

  const summary = {
    tokenId: Number(tokenId),
    name: state.name,
    tbaAddress,
    currentState: {
      owned: state.owned,
      owner: state.owner,
      awakened: state.awakened,
      agentId: state.agentId,
      tbaL1: state.tbaL1Deployed ? "deployed" : "undeployed",
      tbaBase: state.tbaBaseDeployed ? "deployed" : "undeployed",
      toolPass: state.toolPassBonded ? "bonded" : "not bonded",
      l1Eth: ethers.formatEther(state.l1Eth),
      baseEth: ethers.formatEther(state.baseEth),
      persona: state.hasPersona,
    },
    stepsRequired: steps.length,
    steps,
    costEstimate: {
      mainnetGas: {
        totalGas: totalMainnetGas.toString(),
        gasPrice: `${ethers.formatUnits(gas.mainnet.gasPrice, "gwei")} gwei`,
        costEth: ethers.formatEther(mainnetGasCost),
      },
      baseGas: {
        totalGas: totalBaseGas.toString(),
        gasPrice: `${ethers.formatUnits(gas.base.gasPrice, "gwei")} gwei`,
        costEth: ethers.formatEther(baseGasCost),
      },
      tbaFunding: ethers.formatEther(totalEthNeeded),
      totalEth: ethers.formatEther(totalCost),
      totalUsd: gas.ethPriceUsd
        ? `$${(parseFloat(ethers.formatEther(totalCost)) * gas.ethPriceUsd).toFixed(2)}`
        : null,
      ethPriceUsd: gas.ethPriceUsd,
    },
    readinessAfterActivation: state.owned
      ? (state.hasPersona ? "FULLY AUTONOMOUS" : "NEARLY READY (missing persona)")
      : "BLOCKED (not owned)",
  };

  return summary;
}

function printPlan(plan) {
  const bar = "=".repeat(64);
  console.log(`\n${bar}`);
  console.log(`  ACTIVATION PLAN — NORMIE #${plan.tokenId}${plan.name ? ` (${plan.name})` : ""}`);
  console.log(`${bar}\n`);

  console.log(`  TBA:     ${plan.tbaAddress}`);
  console.log(`  Status:  ${plan.stepsRequired === 0 ? "FULLY ACTIVATED" : `${plan.stepsRequired} steps remaining`}`);
  console.log();

  // Current state
  const s = plan.currentState;
  const icon = v => v ? "✅" : "❌";
  console.log("  CURRENT STATE:");
  console.log(`    ${icon(s.owned)} Owner: ${s.owner || "none"}`);
  console.log(`    ${icon(s.awakened)} Awakened: ${s.agentId ? `agent #${s.agentId}` : "no"}`);
  console.log(`    ${icon(s.tbaL1 === "deployed")} TBA L1: ${s.tbaL1}`);
  console.log(`    ${icon(s.tbaBase === "deployed")} TBA Base: ${s.tbaBase}`);
  console.log(`    ${icon(s.toolPass === "bonded")} Tool Pass: ${s.toolPass}`);
  console.log(`    ${icon(parseFloat(s.baseEth) > 0)} Base ETH: ${s.baseEth}`);
  console.log(`    ${icon(s.persona)} Persona: ${s.persona ? "active" : "none"}`);

  if (plan.steps.length > 0) {
    console.log(`\n  EXECUTION PLAN:`);
    for (const step of plan.steps) {
      const tag = step.status === "requires-approval" ? " [NEEDS APPROVAL]" : "";
      console.log(`\n    Step ${step.order}: ${step.description}${tag}`);
      console.log(`      Chain:    ${step.chain}`);
      console.log(`      Gas:      ${step.estimatedGas} (~${step.costEth} ETH)`);
      console.log(`      Command:  ${step.command}`);
      if (step.warning) console.log(`      WARNING:  ${step.warning}`);
      if (step.fundingEth) console.log(`      Funding:  ${step.fundingEth} ETH to TBA`);
    }

    console.log(`\n  COST ESTIMATE:`);
    const c = plan.costEstimate;
    if (BigInt(c.mainnetGas.totalGas) > 0n) {
      console.log(`    Mainnet:  ${c.mainnetGas.totalGas} gas @ ${c.mainnetGas.gasPrice} = ${c.mainnetGas.costEth} ETH`);
    }
    if (BigInt(c.baseGas.totalGas) > 0n) {
      console.log(`    Base:     ${c.baseGas.totalGas} gas @ ${c.baseGas.gasPrice} = ${c.baseGas.costEth} ETH`);
    }
    if (parseFloat(c.tbaFunding) > 0) {
      console.log(`    Funding:  ${c.tbaFunding} ETH (TBA Base operating balance)`);
    }
    console.log(`    ─────────────────────────────────`);
    console.log(`    TOTAL:    ${c.totalEth} ETH${c.totalUsd ? ` (~${c.totalUsd})` : ""}`);
    if (c.ethPriceUsd) console.log(`    ETH/USD:  $${c.ethPriceUsd}`);
  } else {
    console.log(`\n  All activation steps complete. Normie is fully autonomous.`);
  }

  console.log(`\n  POST-ACTIVATION: ${plan.readinessAfterActivation}`);
  console.log();
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help")) {
    console.log("Usage: node activation-planner.mjs <tokenId> [--json] [--batch 294,7593]");
    console.log("       node activation-planner.mjs 7593 --min-base-eth 0.005");
    console.log("");
    console.log("Estimates costs for full Normie autonomy activation.");
    console.log("Uses live gas prices. No on-chain writes.");
    process.exit(0);
  }

  loadEnv();
  const jsonMode = args.includes("--json");
  const batchIdx = args.indexOf("--batch");
  const minEthIdx = args.indexOf("--min-base-eth");
  const minBaseEth = minEthIdx >= 0 ? parseFloat(args[minEthIdx + 1]) : DEFAULT_MIN_BASE_ETH;

  let tokenIds;
  if (batchIdx !== -1 && args[batchIdx + 1]) {
    tokenIds = args[batchIdx + 1].split(",").map(s => s.trim());
  } else {
    tokenIds = args.filter(a => !a.startsWith("--") && /^\d+$/.test(a));
  }

  if (tokenIds.length === 0) {
    console.error("No tokenId provided.");
    process.exit(1);
  }

  const gas = await getGasPrices();

  if (!jsonMode) {
    console.log(`\n  Gas prices — Mainnet: ${ethers.formatUnits(gas.mainnet.gasPrice, "gwei")} gwei, Base: ${ethers.formatUnits(gas.base.gasPrice, "gwei")} gwei`);
    if (gas.ethPriceUsd) console.log(`  ETH price:  $${gas.ethPriceUsd}`);
  }

  const results = [];
  for (const id of tokenIds) {
    try {
      const plan = await planActivation(id, gas, { minBaseEth });
      results.push(plan);
      if (!jsonMode) printPlan(plan);
    } catch (err) {
      console.error(`Error planning Normie #${id}: ${err.message}`);
      results.push({ tokenId: Number(id), error: err.message });
    }
  }

  if (jsonMode) {
    console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
  }

  // Summary for batch mode
  if (!jsonMode && results.length > 1) {
    const valid = results.filter(r => !r.error);
    const totalSteps = valid.reduce((sum, r) => sum + r.stepsRequired, 0);
    const totalEth = valid.reduce(
      (sum, r) => sum + parseFloat(r.costEstimate.totalEth), 0
    );
    console.log(`  BATCH SUMMARY: ${valid.length} Normies, ${totalSteps} total steps, ${totalEth.toFixed(6)} ETH total`);
    if (gas.ethPriceUsd) {
      console.log(`  Estimated cost: ~$${(totalEth * gas.ethPriceUsd).toFixed(2)}`);
    }
    console.log();
  }
}

export { planActivation };

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ""));
if (isMain) main().catch(e => { console.error(e.message); process.exit(1); });
