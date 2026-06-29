#!/usr/bin/env node
/**
 * normie-activate.mjs — Step-by-step activation orchestrator for any Normie.
 *
 * Chains all activation steps in order: readiness check → deploy TBAs →
 * fund → bond Tool Pass → final verification. Dry-run by default.
 *
 * Usage:
 *   node normie-activate.mjs 7593                     # dry-run: show what would happen
 *   node normie-activate.mjs 7593 --live              # execute all steps (CAUTION)
 *   node normie-activate.mjs 7593 --live --skip-bond  # execute, skip irreversible Tool Pass bond
 *   node normie-activate.mjs 7593 --step deploy-l1    # dry-run single step
 *   node normie-activate.mjs 7593 --step deploy-base --live  # execute single step
 *   node normie-activate.mjs --batch 294,7593         # dry-run batch
 *   node normie-activate.mjs 7593 --json              # machine-readable output
 */

import { ethers } from "ethers";
import { computeTBA } from "./tba-resolver.mjs";
import { checkDeployment, deployTBA } from "./tba-deployer.mjs";
import {
  CHAINS, ADAPTER_ABI, ERC721_ABI,
  loadEnv, getProvider, getSigner,
} from "../../skills/awaken-normie/scripts/lib.mjs";

const NORMIES_CONTRACT = "0x9Eb6E2025B64f340691e424b7fe7022fFDE12438";
const ACCOUNT_V3_IMPL = "0x55266d75D1a14E4572138116aF39863Ed6596E7F";
const TOOL_PASS_CONTRACT = "0xfc9ce3990f85fA1A3a0eE51a710642396a6Cad82";
const API_BASE = "https://api.normies.art";
const MIN_BASE_ETH = 0.002;

const ERC721_BALANCE_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function safeTransferFrom(address from, address to, uint256 tokenId) external",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
];

const STEPS = ["awaken", "deploy-l1", "deploy-base", "fund-base", "bond-toolpass"];

async function fetchJSON(url) {
  const resp = await fetch(url, {
    headers: { "User-Agent": "normies-tools/activate" },
  });
  if (!resp.ok) return null;
  return resp.json();
}

async function gatherState(tokenId) {
  loadEnv();
  const mainnetProvider = getProvider("mainnet");
  const baseProvider = getProvider("base");
  const tbaAddress = computeTBA(ACCOUNT_V3_IMPL, 1, NORMIES_CONTRACT, BigInt(tokenId), 0n);

  const normies = new ethers.Contract(NORMIES_CONTRACT, ERC721_ABI, mainnetProvider);
  const toolPass = new ethers.Contract(TOOL_PASS_CONTRACT, ERC721_BALANCE_ABI, baseProvider);

  const delay = ms => new Promise(r => setTimeout(r, ms));

  // Stagger RPC calls to avoid rate limits
  const [owner, agentInfo] = await Promise.all([
    normies.ownerOf(tokenId).catch(() => null),
    fetchJSON(`${API_BASE}/agents/info/${tokenId}`),
  ]);
  await delay(1000);
  const [l1Code, l1Balance] = await Promise.all([
    mainnetProvider.getCode(tbaAddress),
    mainnetProvider.getBalance(tbaAddress),
  ]);
  await delay(1000);
  const [baseCode, baseBalance, toolPassBal] = await Promise.all([
    baseProvider.getCode(tbaAddress),
    baseProvider.getBalance(tbaAddress),
    toolPass.balanceOf(tbaAddress).catch(() => 0n),
  ]);

  return {
    tokenId: Number(tokenId),
    tbaAddress,
    owner,
    name: agentInfo?.name || null,
    agentId: agentInfo?.agentId || null,
    awakened: !!agentInfo?.agentId,
    hasPersona: !!agentInfo?.systemPrompt,
    tbaL1Deployed: l1Code !== "0x",
    tbaBaseDeployed: baseCode !== "0x",
    l1Eth: l1Balance,
    baseEth: baseBalance,
    toolPassBonded: toolPassBal > 0n,
    toolPassCount: Number(toolPassBal),
  };
}

function buildSteps(state) {
  const steps = [];

  if (!state.awakened && state.owner) {
    steps.push({
      id: "awaken",
      action: "Register as ERC-8004 agent via Adapter8004",
      chain: "mainnet",
      command: `node skills/awaken-normie/scripts/awaken.mjs ${state.tokenId}  # dry-run; submit printed to/calldata via Bankr`,
      reversible: true,
    });
  }

  if (!state.tbaL1Deployed) {
    steps.push({
      id: "deploy-l1",
      action: "Deploy ERC-6551 TBA on Ethereum mainnet",
      chain: "mainnet",
      command: `node tba-deployer.mjs ${state.tokenId} --chain mainnet --live`,
      reversible: true,
    });
  }

  if (!state.tbaBaseDeployed) {
    steps.push({
      id: "deploy-base",
      action: "Deploy ERC-6551 TBA on Base",
      chain: "base",
      command: `node tba-deployer.mjs ${state.tokenId} --chain base --live`,
      reversible: true,
    });
  }

  const minBaseWei = ethers.parseEther(MIN_BASE_ETH.toString());
  if (state.baseEth < minBaseWei) {
    const deficit = minBaseWei - state.baseEth;
    steps.push({
      id: "fund-base",
      action: `Send ${ethers.formatEther(deficit)} ETH to TBA on Base`,
      chain: "base",
      command: `cast send ${state.tbaAddress} --value ${ethers.formatEther(deficit)} --rpc-url base`,
      reversible: true,
      fundingWei: deficit,
    });
  }

  if (!state.toolPassBonded) {
    steps.push({
      id: "bond-toolpass",
      action: "Transfer Tool Pass NFT to TBA on Base (PERMANENT)",
      chain: "base",
      command: `node toolpass-bond.mjs ${state.tokenId} --transfer`,
      reversible: false,
      warning: "IRREVERSIBLE — Tool Pass permanently bound to Normie's TBA. Cannot be retrieved.",
    });
  }

  return steps;
}

async function executeStep(step, state, opts) {
  const result = { stepId: step.id, status: "pending" };

  switch (step.id) {
    case "deploy-l1": {
      const r = await deployTBA(state.tokenId, "mainnet", { live: true });
      result.status = r.action === "deployed" ? "success" : r.action;
      result.tx = r.tx;
      result.tbaAddress = r.tbaAddress;
      break;
    }
    case "deploy-base": {
      const r = await deployTBA(state.tokenId, "base", { live: true });
      result.status = r.action === "deployed" ? "success" : r.action;
      result.tx = r.tx;
      result.tbaAddress = r.tbaAddress;
      break;
    }
    case "fund-base": {
      const signer = getSigner("base");
      const tx = await signer.sendTransaction({
        to: state.tbaAddress,
        value: step.fundingWei,
      });
      console.error(`[base] Funding TX submitted: ${tx.hash}`);
      const receipt = await tx.wait();
      console.error(`[base] Confirmed in block ${receipt.blockNumber}`);
      result.status = "success";
      result.tx = { hash: tx.hash, blockNumber: receipt.blockNumber };
      break;
    }
    case "bond-toolpass": {
      if (opts.skipBond) {
        result.status = "skipped";
        result.reason = "--skip-bond flag set";
        break;
      }
      const signer = getSigner("base");
      const toolPass = new ethers.Contract(TOOL_PASS_CONTRACT, ERC721_BALANCE_ABI, signer);
      const signerAddr = await signer.getAddress();
      const signerBal = await toolPass.balanceOf(signerAddr);
      if (signerBal === 0n) {
        result.status = "blocked";
        result.reason = "Signer wallet holds no Tool Pass NFTs";
        break;
      }
      const toolPassId = await toolPass.tokenOfOwnerByIndex(signerAddr, 0);
      console.error(`[base] Bonding Tool Pass #${toolPassId} to TBA ${state.tbaAddress}...`);
      const tx = await toolPass.safeTransferFrom(signerAddr, state.tbaAddress, toolPassId);
      console.error(`[base] Bond TX submitted: ${tx.hash}`);
      const receipt = await tx.wait();
      console.error(`[base] Confirmed in block ${receipt.blockNumber} — PERMANENTLY BONDED`);
      result.status = "success";
      result.tx = { hash: tx.hash, blockNumber: receipt.blockNumber };
      result.toolPassId = Number(toolPassId);
      break;
    }
    case "awaken": {
      result.status = "skipped";
      result.reason = "Awakening requires Adapter8004 interaction — use awaken-batch.mjs directly";
      break;
    }
    default:
      result.status = "unknown-step";
  }

  return result;
}

function printReport(state, steps, results, opts) {
  const bar = "═".repeat(64);
  const mode = opts.live ? "LIVE EXECUTION" : "DRY RUN";
  console.log(`\n${bar}`);
  console.log(`  NORMIE ACTIVATION — #${state.tokenId}${state.name ? ` (${state.name})` : ""} [${mode}]`);
  console.log(`${bar}\n`);

  console.log(`  TBA:      ${state.tbaAddress}`);
  console.log(`  Owner:    ${state.owner || "unknown"}`);
  console.log(`  Agent:    ${state.agentId ? `#${state.agentId}` : "not awakened"}`);
  console.log(`  Persona:  ${state.hasPersona ? "active" : "none"}`);
  console.log();

  const icon = v => v === true ? "✅" : v === false ? "❌" : "⏭️";
  console.log("  PRE-FLIGHT STATE:");
  console.log(`    ${icon(!!state.owner)}  Owned`);
  console.log(`    ${icon(state.awakened)}  Awakened`);
  console.log(`    ${icon(state.tbaL1Deployed)}  TBA L1`);
  console.log(`    ${icon(state.tbaBaseDeployed)}  TBA Base`);
  console.log(`    ${icon(state.baseEth >= ethers.parseEther(MIN_BASE_ETH.toString()))}  Funded (${ethers.formatEther(state.baseEth)} ETH on Base)`);
  console.log(`    ${icon(state.toolPassBonded)}  Tool Pass bonded`);

  if (steps.length === 0) {
    console.log(`\n  ✅ ALL CHECKS PASS — Normie #${state.tokenId} is fully activated.`);
    console.log();
    return;
  }

  console.log(`\n  ${steps.length} STEP${steps.length > 1 ? "S" : ""} ${opts.live ? "EXECUTED" : "REQUIRED"}:\n`);

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const result = results?.[i];
    const statusTag = result
      ? result.status === "success" ? " ✅"
        : result.status === "skipped" ? ` ⏭️ (${result.reason})`
        : result.status === "blocked" ? ` 🚫 (${result.reason})`
        : ` [${result.status}]`
      : "";

    console.log(`    ${i + 1}. ${step.action}${statusTag}`);
    console.log(`       Chain:   ${step.chain}`);
    if (!opts.live) {
      console.log(`       Run:     ${step.command}`);
    }
    if (result?.tx) {
      console.log(`       TX:      ${result.tx.hash}`);
      console.log(`       Block:   ${result.tx.blockNumber}`);
    }
    if (step.warning) {
      console.log(`       ⚠️  ${step.warning}`);
    }
    console.log();
  }

  if (!opts.live) {
    const hasIrreversible = steps.some(s => !s.reversible);
    console.log(`  To execute: node normie-activate.mjs ${state.tokenId} --live${hasIrreversible ? " --skip-bond" : ""}`);
    if (hasIrreversible) {
      console.log(`  To include Tool Pass bond: node normie-activate.mjs ${state.tokenId} --live`);
    }
    console.log();
  }
}

async function activate(tokenId, opts = {}) {
  const state = await gatherState(tokenId);

  if (!state.owner) {
    return { tokenId: Number(tokenId), error: "Token has no owner or does not exist" };
  }

  const allSteps = buildSteps(state);
  const steps = opts.targetStep
    ? allSteps.filter(s => s.id === opts.targetStep)
    : allSteps;

  let results = null;

  if (opts.live) {
    results = [];
    for (const step of steps) {
      try {
        const r = await executeStep(step, state, opts);
        results.push(r);
        if (r.status === "blocked") {
          console.error(`Step ${step.id} blocked: ${r.reason}. Stopping.`);
          break;
        }
      } catch (err) {
        results.push({ stepId: step.id, status: "error", error: err.message });
        console.error(`Step ${step.id} failed: ${err.message}. Stopping.`);
        break;
      }
    }
  }

  return { state, steps, results, opts };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help")) {
    console.log("Usage: node normie-activate.mjs <tokenId> [options]");
    console.log("");
    console.log("Options:");
    console.log("  --live         Execute activation steps (default: dry-run)");
    console.log("  --skip-bond    Skip irreversible Tool Pass bonding step");
    console.log("  --step <id>    Execute only a specific step:");
    console.log("                 awaken, deploy-l1, deploy-base, fund-base, bond-toolpass");
    console.log("  --batch <ids>  Comma-separated token IDs");
    console.log("  --json         Machine-readable JSON output");
    console.log("");
    console.log("Dry-run shows what would happen. --live executes on-chain.");
    console.log("Tool Pass bonding is IRREVERSIBLE — use --skip-bond to exclude it.");
    process.exit(0);
  }

  loadEnv();
  const live = args.includes("--live");
  const skipBond = args.includes("--skip-bond");
  const jsonMode = args.includes("--json");
  const stepIdx = args.indexOf("--step");
  const targetStep = stepIdx >= 0 ? args[stepIdx + 1] : null;
  const batchIdx = args.indexOf("--batch");

  if (targetStep && !STEPS.includes(targetStep)) {
    console.error(`Unknown step: ${targetStep}. Valid: ${STEPS.join(", ")}`);
    process.exit(1);
  }

  let tokenIds;
  if (batchIdx >= 0) {
    tokenIds = args[batchIdx + 1].split(",").map(s => s.trim());
  } else {
    tokenIds = args.filter(a => !a.startsWith("--") && /^\d+$/.test(a));
  }

  if (tokenIds.length === 0) {
    console.error("No tokenId provided.");
    process.exit(1);
  }

  const allResults = [];
  for (const id of tokenIds) {
    try {
      const r = await activate(id, { live, skipBond, targetStep });
      allResults.push(r);
      if (!jsonMode && r.state) {
        printReport(r.state, r.steps, r.results, { live });
      }
    } catch (err) {
      const errResult = { tokenId: Number(id), error: err.message };
      allResults.push(errResult);
      if (!jsonMode) console.error(`Error activating Normie #${id}: ${err.message}`);
    }
  }

  if (jsonMode) {
    const output = allResults.map(r => {
      if (r.error) return { tokenId: r.tokenId, error: r.error };
      return {
        tokenId: r.state.tokenId,
        name: r.state.name,
        tbaAddress: r.state.tbaAddress,
        preFlightState: {
          owned: !!r.state.owner,
          awakened: r.state.awakened,
          tbaL1: r.state.tbaL1Deployed,
          tbaBase: r.state.tbaBaseDeployed,
          funded: r.state.baseEth >= ethers.parseEther(MIN_BASE_ETH.toString()),
          baseEth: ethers.formatEther(r.state.baseEth),
          toolPassBonded: r.state.toolPassBonded,
        },
        stepsRequired: r.steps.length,
        steps: r.steps.map((s, i) => ({
          id: s.id,
          action: s.action,
          chain: s.chain,
          reversible: s.reversible,
          ...(r.results?.[i] ? { result: r.results[i] } : {}),
        })),
        mode: r.opts.live ? "live" : "dry-run",
      };
    });
    console.log(JSON.stringify(output.length === 1 ? output[0] : output, null, 2));
  }

  if (!jsonMode && allResults.length > 1) {
    const valid = allResults.filter(r => r.state);
    const totalSteps = valid.reduce((s, r) => s + r.steps.length, 0);
    console.log(`  BATCH: ${valid.length} Normies, ${totalSteps} total steps remaining`);
    console.log();
  }
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ""));
if (isMain) main().catch(e => { console.error(e.message); process.exit(1); });
