#!/usr/bin/env node
/**
 * readiness-check.mjs — Autonomy readiness report for any Normie.
 *
 * Checks every prerequisite for full on-chain agent operation:
 * awakening, TBA deployment, Tool Pass bonding, asset holdings,
 * and cross-chain execution readiness. One command, full picture.
 *
 * Usage:
 *   node readiness-check.mjs 7593
 *   node readiness-check.mjs 7593 --json
 *   node readiness-check.mjs --batch 294,3837,7593
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
const API_BASE = "https://api.normies.art";
const L1_CROSS_DOMAIN_MESSENGER = "0x25ace71c97B33Cc4729CF772ae268934F7ab5fA1";

const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];
const ERC721_BALANCE_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
];

async function fetchJSON(url) {
  const resp = await fetch(url, {
    headers: { "User-Agent": "normies-tools/readiness-check" },
  });
  if (!resp.ok) return null;
  return resp.json();
}

async function checkReadiness(tokenId) {
  loadEnv();
  const mainnetProvider = getProvider("mainnet");
  const baseProvider = getProvider("base");

  const tbaAddress = computeTBA(
    ACCOUNT_V3_IMPL, 1, NORMIES_CONTRACT, BigInt(tokenId), 0n
  );

  const normies = new ethers.Contract(NORMIES_CONTRACT, ERC721_ABI, mainnetProvider);
  const adapter = new ethers.Contract(CHAINS.mainnet.adapter, ADAPTER_ABI, mainnetProvider);
  const toolPass = new ethers.Contract(TOOL_PASS_CONTRACT, ERC721_BALANCE_ABI, baseProvider);

  const checks = {};

  // 1. NFT ownership
  const owner = await normies.ownerOf(tokenId).catch(() => null);
  checks.ownership = {
    pass: !!owner,
    owner: owner || "not minted or burned",
  };

  // 2. Awakened as ERC-8004 agent
  const agentInfo = await fetchJSON(`${API_BASE}/agents/info/${tokenId}`);
  checks.awakened = {
    pass: !!agentInfo?.agentId,
    agentId: agentInfo?.agentId || null,
    name: agentInfo?.name || null,
    type: agentInfo?.type || null,
  };

  // 3. TBA deployment — L1 and Base
  const [l1Code, baseCode] = await Promise.all([
    mainnetProvider.getCode(tbaAddress),
    baseProvider.getCode(tbaAddress),
  ]);
  checks.tbaDeployed = {
    l1: l1Code !== "0x",
    base: baseCode !== "0x",
    address: tbaAddress,
    pass: l1Code !== "0x" && baseCode !== "0x",
  };

  // 4. Tool Pass bonded on Base
  const toolPassBalance = await toolPass.balanceOf(tbaAddress).catch(() => 0n);
  let toolPassIds = [];
  if (toolPassBalance > 0n) {
    for (let i = 0; i < Number(toolPassBalance); i++) {
      const tid = await toolPass.tokenOfOwnerByIndex(tbaAddress, i).catch(() => null);
      if (tid !== null) toolPassIds.push(tid.toString());
    }
  }
  checks.toolPassBonded = {
    pass: toolPassBalance > 0n,
    count: Number(toolPassBalance),
    tokenIds: toolPassIds,
  };

  // 5. TBA asset holdings (ETH on both chains)
  const [l1Balance, baseBalance] = await Promise.all([
    mainnetProvider.getBalance(tbaAddress),
    baseProvider.getBalance(tbaAddress),
  ]);
  checks.funded = {
    l1Eth: ethers.formatEther(l1Balance),
    baseEth: ethers.formatEther(baseBalance),
    pass: l1Balance > 0n || baseBalance > 0n,
  };

  // 6. Cross-chain execution readiness
  //    Requires: L1 TBA deployed + Base TBA deployed + owner can call execute()
  const crossChainReady = checks.tbaDeployed.l1 && checks.tbaDeployed.base;
  checks.crossChainExecution = {
    pass: crossChainReady,
    method: "OPStack L1CrossDomainMessenger",
    requirements: [
      checks.tbaDeployed.l1 ? "[x] L1 TBA deployed" : "[ ] L1 TBA not deployed",
      checks.tbaDeployed.base ? "[x] Base TBA deployed" : "[ ] Base TBA not deployed",
      checks.ownership.pass ? "[x] Has owner (can call execute)" : "[ ] No owner",
    ],
  };

  // 7. Persona available
  checks.persona = {
    pass: !!agentInfo?.systemPrompt,
    promptLength: agentInfo?.systemPrompt?.length || 0,
  };

  // Score
  const allChecks = [
    checks.ownership.pass,
    checks.awakened.pass,
    checks.tbaDeployed.pass,
    checks.toolPassBonded.pass,
    checks.funded.pass,
    checks.crossChainExecution.pass,
    checks.persona.pass,
  ];
  const score = allChecks.filter(Boolean).length;
  const total = allChecks.length;

  return {
    tokenId,
    tbaAddress,
    score,
    total,
    level: score === total ? "FULLY AUTONOMOUS"
      : score >= 5 ? "NEARLY READY"
      : score >= 3 ? "PARTIALLY CONFIGURED"
      : "EARLY STAGE",
    checks,
    nextSteps: buildNextSteps(checks),
  };
}

function buildNextSteps(checks) {
  const steps = [];
  if (!checks.ownership.pass) {
    steps.push("This token is not owned — it may be burned or not yet minted.");
    return steps;
  }
  if (!checks.awakened.pass) {
    steps.push("Awaken as ERC-8004 agent: node skills/awaken-normie/scripts/awaken.mjs <tokenId> (dry-run), then submit printed to/calldata via Bankr");
  }
  if (!checks.tbaDeployed.l1) {
    steps.push("Deploy TBA on mainnet: node tba-deployer.mjs <tokenId> --chain mainnet --live");
  }
  if (!checks.tbaDeployed.base) {
    steps.push("Deploy TBA on Base: node tba-deployer.mjs <tokenId> --chain base --live");
  }
  if (!checks.funded.pass) {
    steps.push("Fund the TBA with ETH (needed for gas on L1 execute or Base operations)");
  }
  if (!checks.toolPassBonded.pass) {
    steps.push("Bond a Tool Pass NFT: transfer to TBA on Base (permanent, irreversible)");
  }
  if (!checks.persona.pass) {
    steps.push("Agent has no persona — awakening may have failed or API is down");
  }
  if (steps.length === 0) {
    steps.push("All prerequisites met. Ready for: normie-post.mjs (on-chain posting), tba-bridge.mjs (cross-chain execution)");
  }
  return steps;
}

function printReport(result) {
  const bar = "=".repeat(60);
  console.log(`\n${bar}`);
  console.log(`  NORMIE #${result.tokenId} — READINESS REPORT`);
  console.log(`${bar}\n`);

  console.log(`  TBA:    ${result.tbaAddress}`);
  console.log(`  Score:  ${result.score}/${result.total} — ${result.level}\n`);

  const c = result.checks;

  const line = (pass, label, detail) =>
    console.log(`  ${pass ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);

  line(c.ownership.pass, "NFT Ownership", c.ownership.owner);
  line(c.awakened.pass, "ERC-8004 Agent",
    c.awakened.pass ? `${c.awakened.name} (agentId ${c.awakened.agentId})` : "not awakened");
  line(c.tbaDeployed.l1, "TBA Deployed (L1)",
    c.tbaDeployed.l1 ? "live" : "not deployed (~96k gas)");
  line(c.tbaDeployed.base, "TBA Deployed (Base)",
    c.tbaDeployed.base ? "live" : "not deployed (~96k gas)");
  line(c.toolPassBonded.pass, "Tool Pass Bonded",
    c.toolPassBonded.pass ? `${c.toolPassBonded.count} NFT(s): [${c.toolPassBonded.tokenIds.join(", ")}]` : "none");
  line(c.funded.pass, "TBA Funded",
    `L1: ${c.funded.l1Eth} ETH, Base: ${c.funded.baseEth} ETH`);
  line(c.crossChainExecution.pass, "Cross-Chain Execution",
    c.crossChainExecution.pass ? "OPStack bridge ready" : "missing prerequisites");
  line(c.persona.pass, "Persona Active",
    c.persona.pass ? `${c.persona.promptLength} chars` : "no system prompt");

  if (result.nextSteps.length > 0) {
    console.log(`\n  NEXT STEPS:`);
    result.nextSteps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
  }
  console.log();
}

async function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");
  const batchIdx = args.indexOf("--batch");

  let tokenIds;
  if (batchIdx !== -1 && args[batchIdx + 1]) {
    tokenIds = args[batchIdx + 1].split(",").map(s => s.trim());
  } else {
    tokenIds = args.filter(a => !a.startsWith("--") && /^\d+$/.test(a));
  }

  if (tokenIds.length === 0) {
    console.error("Usage: node readiness-check.mjs <tokenId> [--json] [--batch 294,7593]");
    process.exit(1);
  }

  const results = [];
  for (const id of tokenIds) {
    try {
      const result = await checkReadiness(id);
      results.push(result);
      if (!jsonMode) printReport(result);
    } catch (err) {
      console.error(`Error checking Normie #${id}: ${err.message}`);
      results.push({ tokenId: id, error: err.message });
    }
  }

  if (jsonMode) {
    console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
