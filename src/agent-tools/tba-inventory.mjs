#!/usr/bin/env node
/**
 * tba-inventory.mjs — Asset inventory for any Normie's TBA across chains.
 *
 * Checks ETH balance, deployment status, and known token holdings on
 * mainnet and Base. Uses etherscan/basescan token-list APIs when available,
 * falls back to direct balance checks for well-known tokens.
 *
 * Usage:
 *   node tba-inventory.mjs 7593
 *   node tba-inventory.mjs 7593 --chain base
 *   node tba-inventory.mjs --batch 294,3837,7593
 *   node tba-inventory.mjs 7593 --json
 */

import { ethers } from "ethers";
import { computeTBA } from "./tba-resolver.mjs";
import { loadEnv, getProvider, CHAINS } from "../../skills/awaken-normie/scripts/lib.mjs";

const ACCOUNT_V3_IMPL = "0x55266d75D1a14E4572138116aF39863Ed6596E7F";
const NORMIES_CONTRACT = "0x9Eb6E2025B64f340691e424b7fe7022fFDE12438";
const NORMIES_CHAIN_ID = 1;

// Well-known tokens to check balances for (symbol, address, decimals, chain)
const KNOWN_TOKENS = [
  // Mainnet
  { symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6, chain: "mainnet" },
  { symbol: "WETH", address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18, chain: "mainnet" },
  // Base
  { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, chain: "base" },
  { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18, chain: "base" },
  { symbol: "AXIOM", address: "0xf3Ce5d5C4dd53FdE578C45C0b83a4DC8a4f08517", decimals: 18, chain: "base" },
];

// Well-known NFTs to check ownership for
const KNOWN_NFTS = [
  { name: "AXIOM Tool Pass", address: "0xfc9ce3990f85fA1A3a0eE51a710642396a6Cad82", chain: "base" },
  { name: "Normies", address: NORMIES_CONTRACT, chain: "mainnet" },
];

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

const ERC721_BALANCE_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function name() view returns (string)",
];

/**
 * Check ETH balance + deployment on a chain.
 */
async function checkChainETH(tbaAddress, chain) {
  const provider = getProvider(chain);
  const [balance, code] = await Promise.all([
    provider.getBalance(tbaAddress),
    provider.getCode(tbaAddress),
  ]);
  return {
    chain,
    chainId: CHAINS[chain]?.chainId,
    deployed: code !== "0x",
    ethBalance: ethers.formatEther(balance),
    ethBalanceWei: balance.toString(),
  };
}

/**
 * Check ERC-20 balances for known tokens on a chain.
 */
async function checkERC20s(tbaAddress, chain, provider) {
  const tokens = KNOWN_TOKENS.filter(t => t.chain === chain);
  const results = [];

  for (const token of tokens) {
    try {
      const contract = new ethers.Contract(token.address, ERC20_ABI, provider);
      const balance = await contract.balanceOf(tbaAddress);
      if (balance > 0n) {
        results.push({
          type: "ERC-20",
          symbol: token.symbol,
          address: token.address,
          balance: ethers.formatUnits(balance, token.decimals),
          balanceRaw: balance.toString(),
        });
      }
    } catch {
      // Token contract may not exist or revert — skip
    }
  }
  return results;
}

/**
 * Check ERC-721 balances for known NFT collections on a chain.
 */
async function checkERC721s(tbaAddress, chain, provider) {
  const nfts = KNOWN_NFTS.filter(n => n.chain === chain);
  const results = [];

  for (const nft of nfts) {
    try {
      const contract = new ethers.Contract(nft.address, ERC721_BALANCE_ABI, provider);
      const balance = await contract.balanceOf(tbaAddress);
      if (balance > 0n) {
        results.push({
          type: "ERC-721",
          name: nft.name,
          address: nft.address,
          count: Number(balance),
        });
      }
    } catch {
      // May not exist on chain — skip
    }
  }
  return results;
}

/**
 * Full inventory for one Normie's TBA on specified chains.
 */
async function inventory(tokenId, { chains = ["mainnet", "base"] } = {}) {
  loadEnv();

  const tbaAddress = computeTBA(ACCOUNT_V3_IMPL, NORMIES_CHAIN_ID, NORMIES_CONTRACT, BigInt(tokenId), 0n);

  const chainResults = {};

  for (const chain of chains) {
    try {
      const provider = getProvider(chain);
      const ethInfo = await checkChainETH(tbaAddress, chain);
      const erc20s = await checkERC20s(tbaAddress, chain, provider);
      const erc721s = await checkERC721s(tbaAddress, chain, provider);

      chainResults[chain] = {
        ...ethInfo,
        tokens: erc20s,
        nfts: erc721s,
        totalAssets: erc20s.length + erc721s.length + (ethInfo.ethBalanceWei !== "0" ? 1 : 0),
      };
    } catch (err) {
      chainResults[chain] = { chain, error: err.message };
    }
  }

  return {
    tokenId,
    tbaAddress,
    chains: chainResults,
  };
}

// --- CLI ---
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help")) {
    console.log("Usage: node tba-inventory.mjs <tokenId> [--chain mainnet|base] [--json]");
    console.log("       node tba-inventory.mjs --batch 294,3837,7593");
    process.exit(0);
  }

  const jsonMode = args.includes("--json");
  const chainIdx = args.indexOf("--chain");
  const chains = chainIdx >= 0 ? [args[chainIdx + 1]] : ["mainnet", "base"];
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
    const r = await inventory(id, { chains });
    results.push(r);

    if (!jsonMode) {
      printHuman(r);
    }
  }

  if (jsonMode) {
    console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
  }
}

function printHuman(inv) {
  console.log(`\nNormie #${inv.tokenId}`);
  console.log(`TBA: ${inv.tbaAddress}`);

  for (const [chain, data] of Object.entries(inv.chains)) {
    if (data.error) {
      console.log(`  ${chain}: error — ${data.error}`);
      continue;
    }

    const status = data.deployed ? "deployed" : "not deployed";
    console.log(`  ${chain} (${status}):`);

    if (data.ethBalanceWei !== "0") {
      console.log(`    ETH: ${data.ethBalance}`);
    }

    for (const t of data.tokens) {
      console.log(`    ${t.symbol}: ${t.balance}`);
    }

    for (const n of data.nfts) {
      console.log(`    ${n.name}: ${n.count} held`);
    }

    if (data.totalAssets === 0) {
      console.log(`    (empty)`);
    }
  }
}

export { inventory };

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ""));
if (isMain) main().catch(e => { console.error(e.message); process.exit(1); });
