#!/usr/bin/env node
/**
 * toolpass-bond.mjs — Verify and prepare Tool Pass bonding to a Normie's TBA.
 *
 * A Tool Pass NFT sent to a Normie's TBA on Base becomes permanently bound:
 * the TBA address is deterministic (CREATE2), but since the Normies contract
 * only exists on Ethereum, AccountV3's owner() reverts on Base — nobody can
 * call execute() to move the NFT out. The Tool Pass proves the Normie holds it
 * without any centralized registry.
 *
 * Usage:
 *   node toolpass-bond.mjs --verify 7593             # check current state
 *   node toolpass-bond.mjs --prepare 7593 --from 0x523E...  # dry-run transfer TX
 */

import { ethers } from "ethers";
import { computeTBA } from "./tba-resolver.mjs";

// --- Constants ---
const TOOL_PASS_CONTRACT = "0xfc9ce3990f85fA1A3a0eE51a710642396a6Cad82";
const NORMIES_CONTRACT = "0x9Eb6E2025B64f340691e424b7fe7022fFDE12438";
const ERC6551_REGISTRY = "0x000000006551c19487814612e58FE06813775758";
const ACCOUNT_V3_IMPL = "0x55266d75D1a14E4572138116aF39863Ed6596E7F";
const BASE_CHAIN_ID = 8453;
const NORMIES_CHAIN_ID = 1;

const ERC721_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function safeTransferFrom(address from, address to, uint256 tokenId)",
  "function transferFrom(address from, address to, uint256 tokenId)",
];

function getBaseProvider() {
  const rpc = process.env.BASE_RPC_URL || "https://mainnet.base.org";
  return new ethers.JsonRpcProvider(rpc);
}

/**
 * Verify the bonding state for a Normie's TBA on Base.
 */
async function verify(tokenId) {
  const provider = getBaseProvider();
  const tba = computeTBA(ACCOUNT_V3_IMPL, NORMIES_CHAIN_ID, NORMIES_CONTRACT, BigInt(tokenId), 0n);
  const toolPass = new ethers.Contract(TOOL_PASS_CONTRACT, ERC721_ABI, provider);

  console.log(`\n  Normie #${tokenId}`);
  console.log(`  TBA address: ${tba}`);
  console.log(`  Chain: Base (${BASE_CHAIN_ID})`);
  console.log();

  // Check TBA deployment
  const code = await provider.getCode(tba);
  const tbaDeployed = code !== "0x";
  console.log(`  TBA deployed on Base: ${tbaDeployed ? "YES" : "NO"}`);

  // Check Normies contract on Base
  const normiesCode = await provider.getCode(NORMIES_CONTRACT);
  const normiesOnBase = normiesCode !== "0x";
  console.log(`  Normies contract on Base: ${normiesOnBase ? "YES (unexpected!)" : "NO (expected — mainnet only)"}`);

  // Check Tool Pass balance at TBA
  const tbaBalance = await toolPass.balanceOf(tba);
  console.log(`  Tool Pass NFTs at TBA: ${tbaBalance.toString()}`);

  if (tbaBalance > 0n) {
    // List the token IDs
    const tokenIds = [];
    for (let i = 0; i < tbaBalance; i++) {
      const tid = await toolPass.tokenOfOwnerByIndex(tba, i);
      tokenIds.push(tid.toString());
    }
    console.log(`  Tool Pass token IDs: [${tokenIds.join(", ")}]`);
    console.log();
    console.log(`  STATUS: BONDED`);
    console.log(`  The Normie's TBA holds ${tbaBalance} Tool Pass NFT(s).`);
    if (!normiesOnBase) {
      console.log(`  Since Normies contract is not on Base, AccountV3.owner() would revert,`);
      console.log(`  making execute() impossible — the Tool Pass is permanently bound.`);
    }
  } else {
    console.log();
    console.log(`  STATUS: NOT BONDED`);
    console.log(`  No Tool Pass NFTs at this TBA address on Base.`);
  }

  // Check ERC-6551 registry on Base
  const registryCode = await provider.getCode(ERC6551_REGISTRY);
  console.log(`\n  ERC-6551 Registry on Base: ${registryCode !== "0x" ? "YES" : "NO"}`);

  // Summary
  const permanentBond = !normiesOnBase && !tbaDeployed;
  console.log(`\n  Permanent bond property: ${permanentBond ? "ACTIVE — owner() will revert, NFT irrecoverable" : "CONDITIONAL — check details above"}`);

  return {
    tokenId,
    tba,
    tbaDeployed,
    normiesOnBase,
    toolPassBalance: Number(tbaBalance),
    permanentBondActive: permanentBond,
  };
}

/**
 * Prepare (but do NOT execute) a transfer TX to bond a Tool Pass to a Normie's TBA.
 */
async function prepare(tokenId, fromAddress) {
  const provider = getBaseProvider();
  const tba = computeTBA(ACCOUNT_V3_IMPL, NORMIES_CHAIN_ID, NORMIES_CONTRACT, BigInt(tokenId), 0n);
  const toolPass = new ethers.Contract(TOOL_PASS_CONTRACT, ERC721_ABI, provider);

  // Find Tool Pass token IDs owned by fromAddress
  const balance = await toolPass.balanceOf(fromAddress);
  if (balance === 0n) {
    console.error(`\n  ERROR: ${fromAddress} holds no Tool Pass NFTs.`);
    process.exit(1);
  }

  const ownedTokenIds = [];
  for (let i = 0; i < balance; i++) {
    const tid = await toolPass.tokenOfOwnerByIndex(fromAddress, i);
    ownedTokenIds.push(tid);
  }

  const selectedTokenId = ownedTokenIds[0]; // use first one

  console.log(`\n  DRY-RUN: Tool Pass bonding transaction`);
  console.log(`  ========================================`);
  console.log(`  From: ${fromAddress}`);
  console.log(`  To (Normie #${tokenId} TBA): ${tba}`);
  console.log(`  Tool Pass contract: ${TOOL_PASS_CONTRACT}`);
  console.log(`  Tool Pass token ID: ${selectedTokenId.toString()}`);
  console.log(`  Available Tool Passes: [${ownedTokenIds.map(t => t.toString()).join(", ")}]`);
  console.log();

  // Encode the transferFrom calldata
  const iface = new ethers.Interface(ERC721_ABI);
  const calldata = iface.encodeFunctionData("transferFrom", [fromAddress, tba, selectedTokenId]);

  console.log(`  Transaction details:`);
  console.log(`    to: ${TOOL_PASS_CONTRACT}`);
  console.log(`    data: ${calldata}`);
  console.log(`    value: 0`);
  console.log(`    chain: Base (${BASE_CHAIN_ID})`);
  console.log();
  console.log(`  NOTE: Using transferFrom (not safeTransferFrom) because the TBA`);
  console.log(`  is not deployed on Base. safeTransferFrom would also work since`);
  console.log(`  ERC-721 only calls onERC721Received when recipient has code.`);
  console.log();
  console.log(`  WARNING: This transfer is IRREVERSIBLE.`);
  console.log(`  The Tool Pass cannot be recovered from the TBA on Base`);
  console.log(`  because AccountV3.owner() reverts (Normies contract not on Base).`);
  console.log();
  console.log(`  To execute, use cast or viem with your wallet:`);
  console.log(`    cast send ${TOOL_PASS_CONTRACT} "transferFrom(address,address,uint256)" ${fromAddress} ${tba} ${selectedTokenId} --rpc-url base --private-key <KEY>`);

  return {
    from: fromAddress,
    to: tba,
    toolPassTokenId: Number(selectedTokenId),
    contract: TOOL_PASS_CONTRACT,
    calldata,
    chain: "base",
    chainId: BASE_CHAIN_ID,
    irreversible: true,
  };
}

// --- CLI ---
async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.length === 0) {
    console.log("Usage:");
    console.log("  node toolpass-bond.mjs --verify <tokenId>                    Check bonding state");
    console.log("  node toolpass-bond.mjs --prepare <tokenId> --from <address>  Dry-run transfer TX");
    process.exit(0);
  }

  if (args.includes("--verify")) {
    const idx = args.indexOf("--verify");
    const tokenId = parseInt(args[idx + 1]);
    if (isNaN(tokenId)) { console.error("Invalid tokenId"); process.exit(1); }
    const result = await verify(tokenId);
    console.log(`\n  JSON:`);
    console.log(JSON.stringify(result, null, 2));
  } else if (args.includes("--prepare")) {
    const idx = args.indexOf("--prepare");
    const tokenId = parseInt(args[idx + 1]);
    const fromIdx = args.indexOf("--from");
    if (isNaN(tokenId) || fromIdx < 0) {
      console.error("Usage: --prepare <tokenId> --from <address>");
      process.exit(1);
    }
    const from = args[fromIdx + 1];
    const result = await prepare(tokenId, from);
    console.log(`\n  JSON:`);
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
