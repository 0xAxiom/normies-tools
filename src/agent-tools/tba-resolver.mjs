#!/usr/bin/env node
/**
 * tba-resolver.mjs — Compute any Normie's ERC-6551 Token Bound Account address.
 *
 * ERC-6551 TBAs are deterministic CREATE2 — same address on every chain.
 * This tool computes the address and optionally checks ETH/token balances.
 *
 * Usage:
 *   node tba-resolver.mjs 7593
 *   node tba-resolver.mjs 7593 --check-balance
 *   node tba-resolver.mjs 7593 --chain base --check-balance
 *   node tba-resolver.mjs --batch 294,3837,7593,9524
 */

import { ethers } from "ethers";
import { CHAINS, loadEnv, getProvider } from "../../skills/awaken-normie/scripts/lib.mjs";

// ERC-6551 registry (canonical, same on every chain)
const ERC6551_REGISTRY = "0x000000006551c19487814612e58FE06813775758";
// AccountV3Upgradable implementation (Tokenbound, canonical CREATE2)
// Note: Normies uses the Upgradable variant, NOT plain AccountV3.
const ACCOUNT_V3_IMPL = "0x55266d75D1a14E4572138116aF39863Ed6596E7F";
// Normies contract on Ethereum
const NORMIES_CONTRACT = "0x9Eb6E2025B64f340691e424b7fe7022fFDE12438";
const NORMIES_CHAIN_ID = 1;
// Salt (default for Tokenbound SDK — no custom salt)
const SALT = 0n;

/**
 * Compute the ERC-6551 TBA address for a given NFT.
 * Mirrors the CREATE2 computation from the canonical registry.
 */
function computeTBA(implementation, chainId, tokenContract, tokenId, salt = 0n) {
  // The registry's account() function uses CREATE2 with:
  //   salt = keccak256(abi.encode(salt, chainId, tokenContract, tokenId))
  //   bytecode = creation code with implementation packed in
  //
  // But the canonical registry uses a different pattern:
  //   account = create2(salt, keccak256(bytecodeWithArgs))
  // where bytecodeWithArgs includes the implementation, salt, chainId, tokenContract, tokenId

  const abiCoder = ethers.AbiCoder.defaultAbiCoder();

  // ERC-6551 Registry createAccount/account bytecode pattern:
  // The init code is the ERC-1167 minimal proxy pointing at the implementation,
  // with appended data: salt + chainId + tokenContract + tokenId
  //
  // Proxy bytecode (ERC-1167 with extra data):
  const proxyBytecode = ethers.concat([
    "0x3d60ad80600a3d3981f3363d3d373d3d3d363d73",
    implementation,
    "0x5af43d82803e903d91602b57fd5bf3",
  ]);

  // Appended context: abi.encode(salt, chainId, tokenContract, tokenId)
  const context = abiCoder.encode(
    ["uint256", "uint256", "address", "uint256"],
    [salt, chainId, tokenContract, tokenId]
  );

  const fullBytecode = ethers.concat([proxyBytecode, context]);
  const bytecodeHash = ethers.keccak256(fullBytecode);

  // CREATE2: address = keccak256(0xff ++ registry ++ salt ++ bytecodeHash)[12:]
  const saltBytes = ethers.zeroPadValue(ethers.toBeHex(salt), 32);
  const addr = ethers.getCreate2Address(ERC6551_REGISTRY, saltBytes, bytecodeHash);

  return addr;
}

/**
 * Resolve a Normie's TBA and optionally check balances.
 */
async function resolveTBA(tokenId, { chain = "mainnet", checkBalance = false } = {}) {
  const tba = computeTBA(ACCOUNT_V3_IMPL, NORMIES_CHAIN_ID, NORMIES_CONTRACT, BigInt(tokenId), SALT);

  const result = {
    tokenId,
    normiesContract: NORMIES_CONTRACT,
    tbaAddress: tba,
    implementation: ACCOUNT_V3_IMPL,
    registry: ERC6551_REGISTRY,
    computedForChainId: NORMIES_CHAIN_ID,
    note: "ERC-6551 TBAs are deterministic CREATE2 — this address is the same on every chain.",
  };

  if (checkBalance) {
    loadEnv();
    const provider = getProvider(chain);
    const ethBalance = await provider.getBalance(tba);
    const code = await provider.getCode(tba);
    result.balances = {
      chain,
      chainId: CHAINS[chain]?.chainId,
      ethBalance: ethers.formatEther(ethBalance),
      ethBalanceWei: ethBalance.toString(),
      tbaDeployed: code !== "0x",
    };
  }

  return result;
}

// --- CLI ---
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help")) {
    console.log("Usage: node tba-resolver.mjs <tokenId> [--check-balance] [--chain mainnet|base]");
    console.log("       node tba-resolver.mjs --batch 294,3837,7593");
    process.exit(0);
  }

  const checkBalance = args.includes("--check-balance");
  const chainIdx = args.indexOf("--chain");
  const chain = chainIdx >= 0 ? args[chainIdx + 1] : "mainnet";
  const batchIdx = args.indexOf("--batch");

  let tokenIds;
  if (batchIdx >= 0) {
    tokenIds = args[batchIdx + 1].split(",").map(Number);
  } else {
    const id = parseInt(args.find(a => !a.startsWith("--")));
    if (isNaN(id)) { console.error("Invalid tokenId"); process.exit(1); }
    tokenIds = [id];
  }

  const results = [];
  for (const id of tokenIds) {
    try {
      const r = await resolveTBA(id, { chain, checkBalance });
      results.push(r);
    } catch (err) {
      results.push({ tokenId: id, error: err.message });
    }
  }

  console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
}

export { computeTBA, resolveTBA };

// Only run CLI when invoked directly
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ""));
if (isMain) main().catch(e => { console.error(e.message); process.exit(1); });
