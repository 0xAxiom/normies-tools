#!/usr/bin/env node
// Batch-awaken Normies as ERC-8004 agents via Adapter8004.
// Usage:
//   node awaken-batch.mjs 100,200,300             # dry-run these token IDs
//   node awaken-batch.mjs --range 100-110          # dry-run token IDs 100..110
//   node awaken-batch.mjs --wallet 0x...           # dry-run all Normies held by wallet
//   node awaken-batch.mjs 100,200 --send           # broadcast (sequential, mainnet)
//   node awaken-batch.mjs 100,200 --send --delay 5 # 5s between txs (default: 3)

import { ethers } from "ethers";
import {
  CHAINS, TOKEN_STANDARD, ADAPTER_ABI, REGISTRY_ABI, ERC721_ABI,
  getProvider, getSigner, loadEnv, normiesAgentURI,
} from "../../skills/awaken-normie/scripts/lib.mjs";

const NORMIES_API = "https://api.normies.art";

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) return null;
  return res.json();
}

async function indexerBinding(tokenId) {
  const j = await getJson(`${NORMIES_API}/agents/binding/${tokenId}`);
  return j?.binding ?? null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

loadEnv();

const args = process.argv.slice(2);
const send = args.includes("--send");
const delayIdx = args.indexOf("--delay");
const delaySec = delayIdx >= 0 ? Number(args[delayIdx + 1]) : 3;
const rangeIdx = args.indexOf("--range");
const walletIdx = args.indexOf("--wallet");
const chain = "mainnet"; // batch awaken is mainnet-only (Normies only exist there)

let tokenIds = [];

if (rangeIdx >= 0) {
  const [lo, hi] = args[rangeIdx + 1].split("-").map(Number);
  if (isNaN(lo) || isNaN(hi) || lo > hi) { console.error("Invalid --range (use start-end, e.g. 100-110)"); process.exit(2); }
  for (let i = lo; i <= hi; i++) tokenIds.push(i);
} else if (walletIdx >= 0) {
  const walletAddr = args[walletIdx + 1];
  if (!walletAddr) { console.error("--wallet requires an address"); process.exit(2); }
  console.log(`Fetching Normies held by ${walletAddr} from API...`);
  const j = await getJson(`${NORMIES_API}/wallet/${walletAddr}`);
  if (!j || !Array.isArray(j)) {
    console.error("Could not fetch wallet holdings from API. Provide token IDs manually.");
    process.exit(1);
  }
  tokenIds = j.map(Number);
  console.log(`Found ${tokenIds.length} Normie(s): ${tokenIds.join(", ")}`);
} else {
  const positional = args.filter(a => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--delay" && args[args.indexOf(a) - 1] !== "--wallet");
  if (positional.length === 0) {
    console.error("Usage: awaken-batch.mjs <id1,id2,...> | --range lo-hi | --wallet 0x...");
    process.exit(2);
  }
  tokenIds = positional.flatMap(a => a.split(",")).map(Number).filter(n => !isNaN(n));
}

if (tokenIds.length === 0) { console.error("No token IDs to process."); process.exit(2); }

console.log(`\n=== Batch Awaken: ${tokenIds.length} Normie(s) on ${chain} ===`);
console.log(`Mode: ${send ? "LIVE (will broadcast)" : "DRY-RUN"}`);
if (send) console.log(`Delay between txs: ${delaySec}s`);

const provider = getProvider(chain);
const c = CHAINS[chain];
const adapter = new ethers.Contract(c.adapter, ADAPTER_ABI, provider);
const nft = new ethers.Contract(c.normies, ERC721_ABI, provider);
const signer = send ? getSigner(chain) : null;

const results = [];

for (const tokenId of tokenIds) {
  const row = { tokenId, status: "pending", agentId: null, txHash: null, error: null };
  results.push(row);

  try {
    // 1. Check if already awakened
    const binding = await indexerBinding(tokenId);
    if (binding && binding.agentId) {
      row.status = "already-awakened";
      row.agentId = binding.agentId;
      console.log(`  #${tokenId}: already awakened (agentId=${binding.agentId}) — skipping`);
      continue;
    }

    // 2. Check ownership
    let holder;
    try {
      holder = await nft.ownerOf(tokenId);
    } catch {
      row.status = "not-found";
      row.error = "ownerOf reverted (token may not exist)";
      console.log(`  #${tokenId}: ownerOf reverted — skipping`);
      continue;
    }

    const signerAddr = signer?.address || (process.env.AXIOM_WALLET_ADDRESS || "unknown");
    if (holder.toLowerCase() !== signerAddr.toLowerCase()) {
      row.status = "not-owned";
      row.error = `held by ${holder}`;
      console.log(`  #${tokenId}: not owned by signer (holder=${holder}) — skipping`);
      continue;
    }

    // 3. Build calldata + estimate gas
    const agentURI = normiesAgentURI(tokenId);
    const data = adapter.interface.encodeFunctionData("register", [
      TOKEN_STANDARD.ERC721, c.normies, tokenId, agentURI,
    ]);

    let gas;
    try {
      gas = await provider.estimateGas({ to: c.adapter, data, from: signerAddr, value: 0n });
    } catch (e) {
      row.status = "estimate-failed";
      row.error = e.shortMessage || e.message;
      console.log(`  #${tokenId}: gas estimate failed — ${row.error}`);
      continue;
    }

    // 4. Static-call to predict agentId
    let predictedId;
    if (signer) {
      try {
        const adapterWrite = adapter.connect(signer);
        predictedId = await adapterWrite.register.staticCall(
          TOKEN_STANDARD.ERC721, c.normies, tokenId, agentURI
        );
      } catch {}
    }

    if (!send) {
      row.status = "dry-run-ok";
      row.agentId = predictedId?.toString() ?? null;
      console.log(`  #${tokenId}: dry-run OK — gas=${gas} ${predictedId ? `predictedAgentId=${predictedId}` : ""}`);
      continue;
    }

    // 5. Broadcast
    console.log(`  #${tokenId}: broadcasting...`);
    const adapterWrite = adapter.connect(signer);
    const tx = await adapterWrite.register(TOKEN_STANDARD.ERC721, c.normies, tokenId, agentURI, {
      gasLimit: (gas * 120n) / 100n,
    });
    console.log(`    tx: ${tx.hash}`);
    const rcpt = await tx.wait();
    row.txHash = tx.hash;

    // Extract agentId from logs
    for (const log of rcpt.logs) {
      try {
        const parsed = adapter.interface.parseLog(log);
        if (parsed?.name === "AgentBound") {
          row.agentId = parsed.args.agentId.toString();
        }
      } catch {}
    }
    row.status = "awakened";
    console.log(`    mined block=${rcpt.blockNumber} gasUsed=${rcpt.gasUsed} agentId=${row.agentId ?? "?"}`);

    // Delay before next tx
    if (tokenIds.indexOf(tokenId) < tokenIds.length - 1) {
      await sleep(delaySec * 1000);
    }
  } catch (e) {
    row.status = "error";
    row.error = e.shortMessage || e.message;
    console.log(`  #${tokenId}: ERROR — ${row.error}`);
  }
}

// Summary
console.log(`\n=== Summary ===`);
console.log(`${"TokenId".padEnd(10)} ${"Status".padEnd(20)} ${"AgentId".padEnd(10)} ${"TxHash".padEnd(20)} Error`);
console.log("-".repeat(80));
for (const r of results) {
  console.log(
    `${String(r.tokenId).padEnd(10)} ${r.status.padEnd(20)} ${(r.agentId ?? "-").toString().padEnd(10)} ${(r.txHash ? r.txHash.slice(0, 18) + "..." : "-").padEnd(20)} ${r.error ?? ""}`
  );
}

const awakened = results.filter(r => r.status === "awakened").length;
const skipped = results.filter(r => r.status === "already-awakened").length;
const dryOk = results.filter(r => r.status === "dry-run-ok").length;
const errors = results.filter(r => ["error", "estimate-failed", "not-found", "not-owned"].includes(r.status)).length;
console.log(`\nTotal: ${results.length} | Awakened: ${awakened} | Already-awakened: ${skipped} | Dry-run OK: ${dryOk} | Errors: ${errors}`);
