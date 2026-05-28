#!/usr/bin/env node
/**
 * normie-lookup.mjs — Full identity resolver for any Normie NFT.
 *
 * Combines: NFT ownership, ERC-8004 agent binding, ERC-6551 TBA,
 * awakened status, and persona from normies.art API — all in one call.
 *
 * Usage:
 *   node normie-lookup.mjs 7593
 *   node normie-lookup.mjs 7593 --full     (includes persona + TBA balance)
 *   node normie-lookup.mjs 294 3837 7593   (batch)
 */

import { ethers } from "ethers";
import {
  CHAINS, ADAPTER_ABI, REGISTRY_ABI, ERC721_ABI,
  loadEnv, getProvider,
} from "../../skills/awaken-normie/scripts/lib.mjs";
import { computeTBA } from "./tba-resolver.mjs";

const NORMIES_CONTRACT = "0x9Eb6E2025B64f340691e424b7fe7022fFDE12438";
const API_BASE = "https://api.normies.art";

async function fetchJSON(url) {
  const resp = await fetch(url, {
    headers: { "User-Agent": "normies-tools/lookup" },
  });
  if (!resp.ok) return null;
  return resp.json();
}

/**
 * Look up a Normie by tokenId. Returns everything an agent needs.
 */
async function lookupNormie(tokenId, { full = false } = {}) {
  loadEnv();
  const provider = getProvider("mainnet");
  const normies = new ethers.Contract(NORMIES_CONTRACT, ERC721_ABI, provider);
  const adapter = new ethers.Contract(CHAINS.mainnet.adapter, ADAPTER_ABI, provider);

  // Parallel: owner, agent info, TBA computation
  const tbaAddress = computeTBA(
    "0x55266d75D1a14E4572138116aF39863Ed6596E7F", // AccountV3Upgradable
    1, NORMIES_CONTRACT, BigInt(tokenId), 0n
  );

  const [owner, agentInfo] = await Promise.all([
    normies.ownerOf(tokenId).catch(() => null),
    fetchJSON(`${API_BASE}/agents/info/${tokenId}`),
  ]);

  const result = {
    tokenId,
    contract: NORMIES_CONTRACT,
    chain: "ethereum",
    owner: owner || "unknown (burned or not minted)",
    tba: {
      address: tbaAddress,
      note: "Deterministic CREATE2 — same address on every chain",
    },
    awakened: !!agentInfo,
  };

  if (agentInfo) {
    result.agent = {
      name: agentInfo.name || null,
      type: agentInfo.type || null,
      tagline: agentInfo.tagline || null,
      agentId: agentInfo.agentId || null,
    };

    // Check adapter binding on-chain
    if (agentInfo.agentId) {
      try {
        const binding = await adapter.bindingOf(agentInfo.agentId);
        result.agent.binding = {
          standard: ["ERC721", "ERC1155", "ERC6909"][Number(binding[0])] || `unknown(${binding[0]})`,
          tokenContract: binding[1],
          tokenId: binding[2].toString(),
          adapter: CHAINS.mainnet.adapter,
        };
        // Check if current owner is the controller
        if (owner) {
          const isController = await adapter.isController(agentInfo.agentId, owner).catch(() => null);
          result.agent.ownerIsController = isController;
        }
      } catch {
        result.agent.binding = null;
      }
    }
  }

  // Full mode: persona + TBA balances on mainnet and Base
  if (full) {
    if (agentInfo) {
      result.persona = {
        backstory: agentInfo.backstory || null,
        personality: agentInfo.personality || null,
        greeting: agentInfo.greeting || null,
        communicationStyle: agentInfo.communicationStyle || null,
        traits: agentInfo.traits || null,
      };
    }

    // TBA balance on mainnet
    const mainnetBal = await provider.getBalance(tbaAddress).catch(() => 0n);
    const mainnetCode = await provider.getCode(tbaAddress).catch(() => "0x");
    result.tba.mainnet = {
      ethBalance: ethers.formatEther(mainnetBal),
      deployed: mainnetCode !== "0x",
    };

    // TBA balance on Base
    try {
      const baseProvider = getProvider("base");
      const baseBal = await baseProvider.getBalance(tbaAddress).catch(() => 0n);
      const baseCode = await baseProvider.getCode(tbaAddress).catch(() => "0x");
      result.tba.base = {
        ethBalance: ethers.formatEther(baseBal),
        deployed: baseCode !== "0x",
      };
    } catch {
      result.tba.base = { error: "BASE_RPC_URL not configured" };
    }
  }

  return result;
}

// --- CLI ---
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help")) {
    console.log("Usage: node normie-lookup.mjs <tokenId> [--full]");
    console.log("       node normie-lookup.mjs 294 3837 7593 [--full]");
    process.exit(0);
  }

  const full = args.includes("--full");
  const tokenIds = args.filter(a => !a.startsWith("--")).map(Number).filter(n => !isNaN(n));

  if (tokenIds.length === 0) { console.error("No valid tokenIds"); process.exit(1); }

  const results = [];
  for (const id of tokenIds) {
    try {
      results.push(await lookupNormie(id, { full }));
    } catch (err) {
      results.push({ tokenId: id, error: err.message });
    }
  }

  console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
}

export { lookupNormie };
main().catch(e => { console.error(e.message); process.exit(1); });
