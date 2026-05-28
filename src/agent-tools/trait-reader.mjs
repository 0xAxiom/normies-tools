#!/usr/bin/env node
/**
 * trait-reader.mjs — Read ERC-7496 dynamic traits for any Normie NFT.
 *
 * Fetches both on-chain dynamic traits (ERC-7496) and the normies.art
 * API traits, then merges them. Useful for checking trait-gated access
 * (TraitGatedPredicate) and understanding what a Normie "is."
 *
 * Usage:
 *   node trait-reader.mjs 7593
 *   node trait-reader.mjs 7593 --raw           # raw bytes from getTraitValue
 *   node trait-reader.mjs 294 3837 7593        # batch
 *   node trait-reader.mjs 7593 --check-gate    # check TraitGatedPredicate access
 */

import { ethers } from "ethers";
import { loadEnv, getProvider } from "../../skills/awaken-normie/scripts/lib.mjs";

const NORMIES = "0x9Eb6E2025B64f340691e424b7fe7022fFDE12438";
const API_BASE = "https://api.normies.art";

// TraitGatedPredicate (deployed on Ethereum + Base)
const TRAIT_GATE = "0x10abF07CfA34Bf22372C57f27e8bd9C2DCF93fA1";

// ERC-7496 interface — getTraitValue(uint256 tokenId, bytes32 traitKey) → bytes32
const ERC7496_ABI = [
  "function getTraitValue(uint256 tokenId, bytes32 traitKey) view returns (bytes32)",
  "function getTraitValues(uint256 tokenId, bytes32[] traitKeys) view returns (bytes32[])",
];

// TraitGatedPredicate interface
const TRAIT_GATE_ABI = [
  "function checkAccess(address account) view returns (bool)",
];

// Known Normies trait keys (keccak256 of the trait name)
const KNOWN_TRAITS = {
  type: ethers.id("type"),
  background: ethers.id("background"),
  skin: ethers.id("skin"),
  outfit: ethers.id("outfit"),
  eyes: ethers.id("eyes"),
  mouth: ethers.id("mouth"),
  head: ethers.id("head"),
  accessory: ethers.id("accessory"),
  // Agent-related
  awakened: ethers.id("awakened"),
  agent_name: ethers.id("agent_name"),
};

function decodeTraitValue(hex) {
  if (!hex || hex === ethers.ZeroHash) return null;
  // Try UTF-8 decode (strip trailing nulls)
  try {
    const bytes = ethers.getBytes(hex);
    const str = new TextDecoder().decode(bytes).replace(/\0+$/, "");
    if (str && /^[\x20-\x7e]+$/.test(str)) return str;
  } catch {}
  // Return raw hex if not decodable
  return hex;
}

async function fetchAPITraits(tokenId) {
  try {
    const resp = await fetch(`${API_BASE}/agents/info/${tokenId}`, {
      headers: { "User-Agent": "normies-tools/trait-reader" },
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.traits || null;
  } catch { return null; }
}

async function readTraits(tokenId, { raw = false, checkGate = false } = {}) {
  loadEnv();
  const provider = getProvider("mainnet");

  const result = {
    tokenId,
    contract: NORMIES,
    chain: "ethereum",
    onchain: {},
    api: null,
  };

  // Read on-chain ERC-7496 traits
  const contract = new ethers.Contract(NORMIES, ERC7496_ABI, provider);
  const traitResults = {};

  for (const [name, key] of Object.entries(KNOWN_TRAITS)) {
    try {
      const val = await contract.getTraitValue(tokenId, key);
      traitResults[name] = raw ? val : decodeTraitValue(val);
    } catch {
      traitResults[name] = null;
    }
  }

  result.onchain = traitResults;

  // Fetch API traits for comparison
  result.api = await fetchAPITraits(tokenId);

  // Check TraitGatedPredicate access if requested
  if (checkGate) {
    try {
      const { computeTBA } = await import("./tba-resolver.mjs");
      const tba = computeTBA(
        "0x55266d75D1a14E4572138116aF39863Ed6596E7F",
        1, NORMIES, BigInt(tokenId), 0n
      );
      const gate = new ethers.Contract(TRAIT_GATE, TRAIT_GATE_ABI, provider);
      const hasAccess = await gate.checkAccess(tba);
      result.traitGate = {
        predicate: TRAIT_GATE,
        tba,
        hasAccess,
      };
    } catch (err) {
      result.traitGate = { error: err.message };
    }
  }

  return result;
}

// --- CLI ---
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help")) {
    console.log("Usage: node trait-reader.mjs <tokenId> [--raw] [--check-gate]");
    console.log("       node trait-reader.mjs 294 3837 7593");
    process.exit(0);
  }

  const raw = args.includes("--raw");
  const checkGate = args.includes("--check-gate");
  const tokenIds = args.filter(a => !a.startsWith("--")).map(Number).filter(n => !isNaN(n));

  if (tokenIds.length === 0) { console.error("No valid tokenIds"); process.exit(1); }

  const results = [];
  for (const id of tokenIds) {
    try {
      results.push(await readTraits(id, { raw, checkGate }));
    } catch (err) {
      results.push({ tokenId: id, error: err.message });
    }
  }

  console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
}

export { readTraits, KNOWN_TRAITS };
main().catch(e => { console.error(e.message); process.exit(1); });
