#!/usr/bin/env node
/**
 * normie-dossier.mjs — Comprehensive identity dossier for any Normie.
 *
 * Single command, full picture: identity, autonomy readiness, asset holdings,
 * persona, pixel edit history, and ecosystem context from census data.
 *
 * Usage:
 *   node normie-dossier.mjs 7593
 *   node normie-dossier.mjs 7593 --json
 *   node normie-dossier.mjs --batch 294,3837,7593
 */

import { ethers } from "ethers";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { computeTBA } from "./tba-resolver.mjs";
import {
  CHAINS, ADAPTER_ABI, REGISTRY_ABI, ERC721_ABI,
  loadEnv, getProvider,
} from "../../skills/awaken-normie/scripts/lib.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const CENSUS_DIR = join(ROOT, "data", "census");
const CARDS_DIR = join(ROOT, "data", "agent-cards");
const TBA_CENSUS_DIR = join(ROOT, "data", "tba-census");

const NORMIES_CONTRACT = "0x9Eb6E2025B64f340691e424b7fe7022fFDE12438";
const ACCOUNT_V3_IMPL = "0x55266d75D1a14E4572138116aF39863Ed6596E7F";
const TOOL_PASS_CONTRACT = "0xfc9ce3990f85fA1A3a0eE51a710642396a6Cad82";
const API_BASE = "https://api.normies.art";

const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];
const ERC721_BALANCE_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
];

const KNOWN_TOKENS = [
  { symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6, chain: "mainnet" },
  { symbol: "WETH", address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18, chain: "mainnet" },
  { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, chain: "base" },
  { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18, chain: "base" },
  { symbol: "AXIOM", address: "0xf3Ce5d5C4dd53FdE578C45C0b83a4DC8a4f08517", decimals: 18, chain: "base" },
];

async function fetchJSON(url) {
  const resp = await fetch(url, {
    headers: { "User-Agent": "normies-tools/dossier" },
  });
  if (!resp.ok) return null;
  return resp.json();
}

function loadLatestCensus() {
  try {
    const files = readdirSync(CENSUS_DIR).filter(f => f.endsWith(".json")).sort();
    if (!files.length) return null;
    const latest = files[files.length - 1];
    return {
      date: latest.replace(".json", ""),
      data: JSON.parse(readFileSync(join(CENSUS_DIR, latest), "utf8")),
    };
  } catch { return null; }
}

function loadAgentCard(tokenId) {
  const cardPath = join(CARDS_DIR, `${tokenId}.json`);
  if (!existsSync(cardPath)) return null;
  try { return JSON.parse(readFileSync(cardPath, "utf8")); } catch { return null; }
}

function findInCensus(census, tokenId) {
  if (!census?.data?.agents) return null;
  const agent = census.data.agents.find(a => String(a.tokenId) === String(tokenId));
  if (agent) agent._operator = agent.registeredBy || agent.operator;
  return agent;
}

async function buildDossier(tokenId) {
  loadEnv();
  const mainnetProvider = getProvider("mainnet");
  const baseProvider = getProvider("base");

  const tbaAddress = computeTBA(
    ACCOUNT_V3_IMPL, 1, NORMIES_CONTRACT, BigInt(tokenId), 0n
  );

  const normies = new ethers.Contract(NORMIES_CONTRACT, ERC721_ABI, mainnetProvider);
  const adapter = new ethers.Contract(CHAINS.mainnet.adapter, ADAPTER_ABI, mainnetProvider);
  const toolPass = new ethers.Contract(TOOL_PASS_CONTRACT, ERC721_BALANCE_ABI, baseProvider);

  // Parallel: all RPC calls + API + local data
  const [
    owner,
    agentInfo,
    l1Code, baseCode,
    l1Balance, baseBalance,
    toolPassBalance,
    pixelVersions,
  ] = await Promise.all([
    normies.ownerOf(tokenId).catch(() => null),
    fetchJSON(`${API_BASE}/agents/info/${tokenId}`),
    mainnetProvider.getCode(tbaAddress),
    baseProvider.getCode(tbaAddress),
    mainnetProvider.getBalance(tbaAddress),
    baseProvider.getBalance(tbaAddress),
    toolPass.balanceOf(tbaAddress).catch(() => 0n),
    fetchJSON(`${API_BASE}/tokens/${tokenId}/versions`),
  ]);

  // ERC-20 token balances (parallel)
  const tokenBalances = await Promise.all(
    KNOWN_TOKENS.map(async (tok) => {
      const provider = tok.chain === "mainnet" ? mainnetProvider : baseProvider;
      const contract = new ethers.Contract(tok.address, ERC20_ABI, provider);
      const bal = await contract.balanceOf(tbaAddress).catch(() => 0n);
      return {
        symbol: tok.symbol,
        chain: tok.chain,
        balance: ethers.formatUnits(bal, tok.decimals),
        raw: bal.toString(),
      };
    })
  );

  // Agent binding
  let binding = null;
  if (agentInfo?.agentId) {
    try {
      const b = await adapter.bindingOf(agentInfo.agentId);
      binding = {
        standard: ["ERC721", "ERC1155", "ERC6909"][Number(b[0])] || `unknown(${b[0]})`,
        tokenContract: b[1],
        tokenId: b[2].toString(),
      };
    } catch {}
  }

  // Census context
  const census = loadLatestCensus();
  const censusEntry = findInCensus(census, tokenId);
  let censusContext = null;
  if (censusEntry) {
    const allAgents = census.data.agents;
    const op = censusEntry._operator;
    const operatorAgents = allAgents.filter(a => (a.registeredBy || a.operator) === op);
    const registeredDate = censusEntry.registeredAt
      ? new Date(Number(censusEntry.registeredAt) * 1000).toISOString().slice(0, 10)
      : null;
    censusContext = {
      censusDate: census.date,
      agentId: censusEntry.agentId,
      operator: op,
      registeredDate,
      operatorFleetSize: operatorAgents.length,
      operatorRank: null,
    };
    // Compute operator rank
    const opCounts = {};
    for (const a of allAgents) {
      opCounts[a.registeredBy || a.operator] = (opCounts[a.registeredBy || a.operator] || 0) + 1;
    }
    const sortedOps = Object.entries(opCounts).sort((a, b) => b[1] - a[1]);
    const rank = sortedOps.findIndex(([o]) => o === op);
    censusContext.operatorRank = rank >= 0 ? rank + 1 : null;
    censusContext.totalOperators = sortedOps.length;
    censusContext.totalAgents = allAgents.length;
  }

  // Agent card (locally cached persona data)
  const agentCard = loadAgentCard(tokenId);

  // Pixel edit count
  const pixelEdits = Array.isArray(pixelVersions) ? pixelVersions.length : 0;

  // TBA deployment
  const l1Deployed = l1Code !== "0x";
  const baseDeployed = baseCode !== "0x";

  // Readiness score (same 7 checks as readiness-check.mjs)
  let readinessScore = 0;
  const readinessChecks = [];

  const addCheck = (name, pass, detail) => {
    if (pass) readinessScore++;
    readinessChecks.push({ name, pass, detail });
  };

  addCheck("ownership", !!owner, owner || "not minted or burned");
  addCheck("awakened", !!agentInfo?.agentId, agentInfo?.agentId ? `agentId ${agentInfo.agentId}` : "not awakened");
  addCheck("tba_l1", l1Deployed, l1Deployed ? "deployed" : "not deployed");
  addCheck("tba_base", baseDeployed, baseDeployed ? "deployed" : "not deployed");
  addCheck("tool_pass", Number(toolPassBalance) > 0, `${Number(toolPassBalance)} Tool Pass NFTs`);
  addCheck("funded", l1Balance > 0n || baseBalance > 0n,
    `L1: ${ethers.formatEther(l1Balance)} ETH, Base: ${ethers.formatEther(baseBalance)} ETH`);
  addCheck("persona", !!(agentInfo?.systemPrompt || agentCard?.systemPrompt), "persona loaded");

  const levels = [
    "dormant", "identified", "awakened", "configured",
    "equipped", "funded", "operational", "fully autonomous",
  ];

  const dossier = {
    tokenId: Number(tokenId),
    identity: {
      name: agentInfo?.name || agentCard?.name || null,
      type: agentInfo?.type || agentCard?.type || null,
      tagline: agentInfo?.tagline || agentCard?.tagline || null,
      owner,
      agentId: agentInfo?.agentId || null,
      binding,
    },
    tba: {
      address: tbaAddress,
      l1Deployed,
      baseDeployed,
      balances: {
        l1ETH: ethers.formatEther(l1Balance),
        baseETH: ethers.formatEther(baseBalance),
      },
    },
    readiness: {
      score: readinessScore,
      maxScore: 7,
      level: levels[readinessScore],
      checks: readinessChecks,
    },
    assets: {
      toolPassCount: Number(toolPassBalance),
      tokens: tokenBalances.filter(t => t.raw !== "0"),
    },
    persona: {
      hasPersona: !!(agentInfo?.systemPrompt || agentCard?.systemPrompt),
      backstory: agentInfo?.backstory || agentCard?.backstory || null,
      personality: agentInfo?.personality || agentCard?.personality || null,
      systemPromptLength: (agentInfo?.systemPrompt || agentCard?.systemPrompt || "").length,
    },
    pixels: {
      editCount: pixelEdits,
      hasEdits: pixelEdits > 0,
    },
    census: censusContext,
  };

  return dossier;
}

function renderDossier(d) {
  const lines = [];
  const bar = "═".repeat(52);
  lines.push(`╔${bar}╗`);
  lines.push(`║  NORMIE #${d.tokenId} — ${d.identity.name || "Unknown"}`.padEnd(53) + "║");
  lines.push(`╚${bar}╝`);
  lines.push("");

  // Identity
  lines.push("▸ IDENTITY");
  lines.push(`  Type:     ${d.identity.type || "—"}`);
  lines.push(`  Tagline:  ${d.identity.tagline || "—"}`);
  lines.push(`  Owner:    ${d.identity.owner || "—"}`);
  lines.push(`  Agent ID: ${d.identity.agentId || "not awakened"}`);
  if (d.identity.binding) {
    lines.push(`  Binding:  ${d.identity.binding.standard} ${d.identity.binding.tokenContract}#${d.identity.binding.tokenId}`);
  }
  lines.push("");

  // TBA
  lines.push("▸ TOKEN BOUND ACCOUNT");
  lines.push(`  Address:  ${d.tba.address}`);
  lines.push(`  L1:       ${d.tba.l1Deployed ? "✓ deployed" : "✗ not deployed"}  (${d.tba.balances.l1ETH} ETH)`);
  lines.push(`  Base:     ${d.tba.baseDeployed ? "✓ deployed" : "✗ not deployed"}  (${d.tba.balances.baseETH} ETH)`);
  lines.push("");

  // Readiness
  const filled = "█".repeat(d.readiness.score);
  const empty = "░".repeat(d.readiness.maxScore - d.readiness.score);
  lines.push("▸ AUTONOMY READINESS");
  lines.push(`  Score:    [${filled}${empty}] ${d.readiness.score}/${d.readiness.maxScore} — ${d.readiness.level}`);
  for (const c of d.readiness.checks) {
    lines.push(`  ${c.pass ? "✓" : "✗"} ${c.name}: ${c.detail}`);
  }
  lines.push("");

  // Assets
  lines.push("▸ ASSETS");
  lines.push(`  Tool Pass: ${d.assets.toolPassCount > 0 ? `${d.assets.toolPassCount} NFT(s)` : "none"}`);
  if (d.assets.tokens.length > 0) {
    for (const t of d.assets.tokens) {
      lines.push(`  ${t.symbol} (${t.chain}): ${t.balance}`);
    }
  } else {
    lines.push("  No ERC-20 holdings detected");
  }
  lines.push("");

  // Persona
  lines.push("▸ PERSONA");
  if (d.persona.hasPersona) {
    lines.push(`  System prompt: ${d.persona.systemPromptLength} chars`);
    if (d.persona.backstory) {
      const truncated = d.persona.backstory.length > 200
        ? d.persona.backstory.slice(0, 200) + "…"
        : d.persona.backstory;
      lines.push(`  Backstory: ${truncated}`);
    }
    if (d.persona.personality) {
      lines.push(`  Personality: ${d.persona.personality}`);
    }
  } else {
    lines.push("  No persona loaded");
  }
  lines.push("");

  // Pixels
  lines.push("▸ PIXEL HISTORY");
  lines.push(`  Edits: ${d.pixels.editCount}${d.pixels.hasEdits ? " (run pixel-diff.mjs for details)" : ""}`);
  lines.push("");

  // Census context
  if (d.census) {
    lines.push("▸ ECOSYSTEM CONTEXT");
    lines.push(`  Census date:   ${d.census.censusDate}`);
    lines.push(`  Operator:      ${d.census.operator}`);
    if (d.census.registeredDate) {
      lines.push(`  Registered:    ${d.census.registeredDate}`);
    }
    lines.push(`  Operator fleet: ${d.census.operatorFleetSize} agent(s) (rank #${d.census.operatorRank} of ${d.census.totalOperators})`);
    lines.push(`  Total agents:  ${d.census.totalAgents}`);
  }

  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");
  const batchIdx = args.indexOf("--batch");

  const filteredArgs = args.filter(a => a !== "--json" && a !== "--batch");

  let tokenIds = [];
  if (batchIdx !== -1 && args[batchIdx + 1]) {
    tokenIds = args[batchIdx + 1].split(",").map(s => s.trim());
  } else {
    tokenIds = filteredArgs.filter(a => /^\d+$/.test(a));
  }

  if (!tokenIds.length) {
    console.error("Usage: node normie-dossier.mjs <tokenId> [--json] [--batch id1,id2,...]");
    process.exit(1);
  }

  const results = [];
  for (const tokenId of tokenIds) {
    try {
      const dossier = await buildDossier(tokenId);
      results.push(dossier);
      if (!jsonMode) {
        console.log(renderDossier(dossier));
        if (tokenIds.length > 1) console.log("");
      }
    } catch (err) {
      console.error(`Error for #${tokenId}: ${err.message}`);
      results.push({ tokenId: Number(tokenId), error: err.message });
    }
  }

  if (jsonMode) {
    console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
  }
}

main();
