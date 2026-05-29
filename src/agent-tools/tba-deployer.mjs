#!/usr/bin/env node
/**
 * tba-deployer.mjs — Deploy ERC-6551 TBA for any Normie on L1 and/or Base.
 *
 * Calls ERC6551Registry.createAccount() which is deterministic CREATE2 —
 * calling it when the TBA already exists is a no-op (returns existing address).
 * Prerequisite for cross-chain execution via OPStack bridge.
 *
 * Usage:
 *   node tba-deployer.mjs 7593                          # dry-run both chains
 *   node tba-deployer.mjs 7593 --chain mainnet          # dry-run L1 only
 *   node tba-deployer.mjs 7593 --chain base             # dry-run Base only
 *   node tba-deployer.mjs 7593 --live                   # deploy on both chains
 *   node tba-deployer.mjs 7593 --chain mainnet --live   # deploy on L1 only
 *   node tba-deployer.mjs --batch 294,7593 --chain base # dry-run batch on Base
 */

import { ethers } from "ethers";
import { computeTBA } from "./tba-resolver.mjs";
import { loadEnv, getProvider, getSigner } from "../../skills/awaken-normie/scripts/lib.mjs";

// --- Constants ---
const ERC6551_REGISTRY = "0x000000006551c19487814612e58FE06813775758";
const ACCOUNT_V3_IMPL = "0x55266d75D1a14E4572138116aF39863Ed6596E7F";
const NORMIES_CONTRACT = "0x9Eb6E2025B64f340691e424b7fe7022fFDE12438";
const NORMIES_CHAIN_ID = 1;
const SALT = ethers.zeroPadValue("0x00", 32);

const REGISTRY_ABI = [
  "function createAccount(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId) external returns (address)",
  "function account(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId) external view returns (address)",
];

/**
 * Check if TBA is already deployed on a given chain.
 */
async function checkDeployment(tokenId, chain) {
  const provider = getProvider(chain);
  const expectedAddr = computeTBA(ACCOUNT_V3_IMPL, NORMIES_CHAIN_ID, NORMIES_CONTRACT, BigInt(tokenId), 0n);
  const code = await provider.getCode(expectedAddr);
  return {
    chain,
    tokenId,
    tbaAddress: expectedAddr,
    deployed: code !== "0x",
    codeLength: code === "0x" ? 0 : (code.length - 2) / 2,
  };
}

/**
 * Deploy TBA on a given chain. Dry-run by default.
 */
async function deployTBA(tokenId, chain, { live = false } = {}) {
  loadEnv();
  const status = await checkDeployment(tokenId, chain);

  if (status.deployed) {
    return { ...status, action: "already-deployed", tx: null };
  }

  if (!live) {
    // Estimate gas for the deployment
    const provider = getProvider(chain);
    const registry = new ethers.Contract(ERC6551_REGISTRY, REGISTRY_ABI, provider);
    try {
      const gasEstimate = await provider.estimateGas({
        to: ERC6551_REGISTRY,
        data: registry.interface.encodeFunctionData("createAccount", [
          ACCOUNT_V3_IMPL, SALT, NORMIES_CHAIN_ID, NORMIES_CONTRACT, BigInt(tokenId),
        ]),
      });
      const feeData = await provider.getFeeData();
      const gasCostWei = gasEstimate * (feeData.gasPrice || feeData.maxFeePerGas || 0n);
      return {
        ...status,
        action: "dry-run",
        estimatedGas: gasEstimate.toString(),
        estimatedCostETH: ethers.formatEther(gasCostWei),
        tx: null,
      };
    } catch (err) {
      return {
        ...status,
        action: "dry-run",
        estimatedGas: "~100000",
        estimateError: err.message,
        tx: null,
      };
    }
  }

  // Live deployment
  const signer = getSigner(chain);
  const registry = new ethers.Contract(ERC6551_REGISTRY, REGISTRY_ABI, signer);

  console.error(`[${chain}] Deploying TBA for Normie #${tokenId}...`);
  const tx = await registry.createAccount(
    ACCOUNT_V3_IMPL, SALT, NORMIES_CHAIN_ID, NORMIES_CONTRACT, BigInt(tokenId)
  );
  console.error(`[${chain}] TX submitted: ${tx.hash}`);
  const receipt = await tx.wait();
  console.error(`[${chain}] Confirmed in block ${receipt.blockNumber}`);

  // Verify deployment
  const postStatus = await checkDeployment(tokenId, chain);

  return {
    ...postStatus,
    action: "deployed",
    tx: {
      hash: tx.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
    },
  };
}

// --- CLI ---
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help")) {
    console.log("Usage: node tba-deployer.mjs <tokenId> [--chain mainnet|base] [--live]");
    console.log("       node tba-deployer.mjs --batch 294,7593 [--chain base] [--live]");
    console.log("");
    console.log("Deploys ERC-6551 TBA for a Normie via createAccount().");
    console.log("Dry-run by default. Pass --live to broadcast transactions.");
    console.log("If no --chain specified, checks/deploys on both mainnet and Base.");
    process.exit(0);
  }

  loadEnv();
  const live = args.includes("--live");
  const chainIdx = args.indexOf("--chain");
  const targetChain = chainIdx >= 0 ? args[chainIdx + 1] : null;
  const chains = targetChain ? [targetChain] : ["mainnet", "base"];
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
    for (const chain of chains) {
      try {
        const r = await deployTBA(id, chain, { live });
        results.push(r);
      } catch (err) {
        results.push({ tokenId: id, chain, error: err.message });
      }
    }
  }

  console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
}

export { checkDeployment, deployTBA };

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ""));
if (isMain) main().catch(e => { console.error(e.message); process.exit(1); });
