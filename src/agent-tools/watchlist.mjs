#!/usr/bin/env node
/**
 * watchlist.mjs — Track a set of Normies and detect state changes.
 *
 * Maintains a watchlist of token IDs. On each run, snapshots their
 * on-chain + API state and diffs against the previous snapshot to
 * surface changes: ownership transfers, new awakenings, TBA deployments,
 * funding changes, Tool Pass bonds, and persona updates.
 *
 * Usage:
 *   node watchlist.mjs add 7593 294 3837       # add to watchlist
 *   node watchlist.mjs remove 294               # remove from watchlist
 *   node watchlist.mjs list                     # show current watchlist
 *   node watchlist.mjs check                    # check all for changes
 *   node watchlist.mjs check --json             # machine-readable output
 *   node watchlist.mjs check --since 2          # only show changes in last N snapshots
 */

import { ethers } from "ethers";
import { computeTBA } from "./tba-resolver.mjs";
import {
  CHAINS, ADAPTER_ABI, REGISTRY_ABI, ERC721_ABI,
  loadEnv, getProvider,
} from "../../skills/awaken-normie/scripts/lib.mjs";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "../../data/watchlist");
const WATCHLIST_FILE = join(DATA_DIR, "watchlist.json");
const SNAPSHOTS_DIR = join(DATA_DIR, "snapshots");

const NORMIES_CONTRACT = "0x9Eb6E2025B64f340691e424b7fe7022fFDE12438";
const ACCOUNT_V3_IMPL = "0x55266d75D1a14E4572138116aF39863Ed6596E7F";
const TOOL_PASS_CONTRACT = "0xfc9ce3990f85fA1A3a0eE51a710642396a6Cad82";
const API_BASE = "https://api.normies.art";

const ERC721_BALANCE_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
];

function ensureDirs() {
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(SNAPSHOTS_DIR, { recursive: true });
}

function loadWatchlist() {
  if (!existsSync(WATCHLIST_FILE)) return [];
  return JSON.parse(readFileSync(WATCHLIST_FILE, "utf-8"));
}

function saveWatchlist(ids) {
  ensureDirs();
  writeFileSync(WATCHLIST_FILE, JSON.stringify([...new Set(ids)].sort((a, b) => a - b), null, 2));
}

async function fetchJSON(url) {
  const resp = await fetch(url, {
    headers: { "User-Agent": "normies-tools/watchlist" },
  });
  if (!resp.ok) return null;
  return resp.json();
}

async function withRetry(fn, retries = 4) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      const delay = 3000 * Math.pow(2, i) + Math.random() * 2000;
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

async function snapshotOne(tokenId, mainnetProvider, baseProvider) {
  const tba = computeTBA(ACCOUNT_V3_IMPL, 1, NORMIES_CONTRACT, BigInt(tokenId), 0n);
  const normies = new ethers.Contract(NORMIES_CONTRACT, ERC721_BALANCE_ABI, mainnetProvider);
  const toolPass = new ethers.Contract(TOOL_PASS_CONTRACT, ERC721_BALANCE_ABI, baseProvider);

  const owner = await withRetry(() => normies.ownerOf(tokenId)).catch(() => null);
  const agentInfo = await fetchJSON(`${API_BASE}/agents/info/${tokenId}`);
  const l1Code = await withRetry(() => mainnetProvider.getCode(tba));
  const baseCode = await withRetry(() => baseProvider.getCode(tba));
  const l1Balance = await withRetry(() => mainnetProvider.getBalance(tba));
  const baseBalance = await withRetry(() => baseProvider.getBalance(tba));
  const toolPassBal = await withRetry(() => toolPass.balanceOf(tba)).catch(() => 0n);

  return {
    tokenId,
    tba,
    owner: owner || null,
    awakened: !!agentInfo?.agentId,
    agentId: agentInfo?.agentId || null,
    name: agentInfo?.name || null,
    type: agentInfo?.type || null,
    tbaDeployedL1: l1Code !== "0x",
    tbaDeployedBase: baseCode !== "0x",
    l1Eth: ethers.formatEther(l1Balance),
    baseEth: ethers.formatEther(baseBalance),
    toolPassCount: Number(toolPassBal),
    personaLength: agentInfo?.systemPrompt?.length || 0,
  };
}

function diffSnapshots(prev, curr) {
  const changes = [];

  if (prev.owner !== curr.owner) {
    changes.push({
      field: "owner",
      from: prev.owner,
      to: curr.owner,
      label: curr.owner === null ? "BURNED or ERROR" : "TRANSFERRED",
    });
  }

  if (!prev.awakened && curr.awakened) {
    changes.push({
      field: "awakened",
      from: false,
      to: true,
      label: `AWAKENED as ${curr.name} (agent #${curr.agentId})`,
    });
  }

  if (!prev.tbaDeployedL1 && curr.tbaDeployedL1) {
    changes.push({ field: "tbaDeployedL1", from: false, to: true, label: "TBA DEPLOYED on L1" });
  }
  if (!prev.tbaDeployedBase && curr.tbaDeployedBase) {
    changes.push({ field: "tbaDeployedBase", from: false, to: true, label: "TBA DEPLOYED on Base" });
  }

  if (prev.l1Eth !== curr.l1Eth) {
    changes.push({
      field: "l1Eth",
      from: prev.l1Eth,
      to: curr.l1Eth,
      label: `L1 ETH: ${prev.l1Eth} → ${curr.l1Eth}`,
    });
  }
  if (prev.baseEth !== curr.baseEth) {
    changes.push({
      field: "baseEth",
      from: prev.baseEth,
      to: curr.baseEth,
      label: `Base ETH: ${prev.baseEth} → ${curr.baseEth}`,
    });
  }

  if (prev.toolPassCount !== curr.toolPassCount) {
    changes.push({
      field: "toolPassCount",
      from: prev.toolPassCount,
      to: curr.toolPassCount,
      label: `Tool Pass: ${prev.toolPassCount} → ${curr.toolPassCount}`,
    });
  }

  if (prev.personaLength === 0 && curr.personaLength > 0) {
    changes.push({
      field: "persona",
      from: 0,
      to: curr.personaLength,
      label: `PERSONA LOADED (${curr.personaLength} chars)`,
    });
  }

  return changes;
}

function getLatestSnapshot() {
  if (!existsSync(SNAPSHOTS_DIR)) return null;
  const files = readdirSync(SNAPSHOTS_DIR).filter(f => f.endsWith(".json")).sort();
  if (files.length === 0) return null;
  return JSON.parse(readFileSync(join(SNAPSHOTS_DIR, files[files.length - 1]), "utf-8"));
}

function getRecentSnapshots(n) {
  if (!existsSync(SNAPSHOTS_DIR)) return [];
  const files = readdirSync(SNAPSHOTS_DIR).filter(f => f.endsWith(".json")).sort();
  return files.slice(-n).map(f => JSON.parse(readFileSync(join(SNAPSHOTS_DIR, f), "utf-8")));
}

function saveSnapshot(data) {
  ensureDirs();
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const path = join(SNAPSHOTS_DIR, `${ts}.json`);
  writeFileSync(path, JSON.stringify(data, null, 2));
  return path;
}

async function cmdAdd(ids) {
  const current = loadWatchlist();
  const added = ids.filter(id => !current.includes(id));
  saveWatchlist([...current, ...ids]);
  console.log(`Added ${added.length} token(s) to watchlist: ${added.join(", ") || "(all already present)"}`);
  console.log(`Watchlist now: ${loadWatchlist().length} token(s)`);
}

async function cmdRemove(ids) {
  const current = loadWatchlist();
  const filtered = current.filter(id => !ids.includes(id));
  saveWatchlist(filtered);
  console.log(`Removed ${current.length - filtered.length} token(s). Watchlist now: ${filtered.length}`);
}

async function cmdList() {
  const ids = loadWatchlist();
  if (ids.length === 0) {
    console.log("Watchlist is empty. Add tokens: node watchlist.mjs add 7593 294");
    return;
  }
  console.log(`Watchlist (${ids.length} tokens):`);
  const lastSnap = getLatestSnapshot();
  for (const id of ids) {
    const prev = lastSnap?.agents?.find(a => a.tokenId === id);
    const status = prev
      ? `${prev.name || "unnamed"} | owner ${prev.owner?.slice(0, 10)}… | ${prev.awakened ? "awakened" : "dormant"} | TBA: L1=${prev.tbaDeployedL1 ? "✓" : "✗"} Base=${prev.tbaDeployedBase ? "✓" : "✗"}`
      : "(no snapshot yet)";
    console.log(`  #${id} — ${status}`);
  }
}

async function cmdCheck(opts) {
  const ids = loadWatchlist();
  if (ids.length === 0) {
    console.log("Watchlist is empty. Add tokens first: node watchlist.mjs add 7593 294");
    return;
  }

  loadEnv();
  const mainnetProvider = getProvider("mainnet");
  const baseProvider = getProvider("base");

  console.log(`Checking ${ids.length} watched Normie(s)...\n`);

  const agents = [];
  for (const id of ids) {
    try {
      const snap = await snapshotOne(id, mainnetProvider, baseProvider);
      agents.push(snap);
      if (!opts.json) {
        const tag = snap.awakened ? snap.name : "dormant";
        process.stdout.write(`  #${id} (${tag}) `);
      }
    } catch (err) {
      console.error(`  #${id} ERROR: ${err.message}`);
      continue;
    }
    await new Promise(r => setTimeout(r, 5000));
  }

  const prevSnap = getLatestSnapshot();
  const snapshotPath = saveSnapshot({
    timestamp: new Date().toISOString(),
    count: agents.length,
    agents,
  });

  // Diff against previous
  const allChanges = [];
  if (prevSnap) {
    for (const curr of agents) {
      const prev = prevSnap.agents.find(a => a.tokenId === curr.tokenId);
      if (!prev) {
        allChanges.push({
          tokenId: curr.tokenId,
          name: curr.name,
          changes: [{ field: "new", label: "NEW — first snapshot for this token" }],
        });
        continue;
      }
      const changes = diffSnapshots(prev, curr);
      if (changes.length > 0) {
        allChanges.push({ tokenId: curr.tokenId, name: curr.name || prev.name, changes });
      }
    }
  }

  if (opts.json) {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      watched: ids.length,
      snapshotted: agents.length,
      changesDetected: allChanges.length,
      changes: allChanges,
      agents,
    }, null, 2));
    return;
  }

  console.log();

  if (!prevSnap) {
    console.log("\nFirst snapshot saved — no previous data to diff against.");
    console.log(`Run again later to detect changes.`);
  } else if (allChanges.length === 0) {
    console.log("No changes detected since last check.");
  } else {
    console.log(`\n${"=".repeat(50)}`);
    console.log(`CHANGES DETECTED: ${allChanges.length} token(s)\n`);
    for (const entry of allChanges) {
      console.log(`  #${entry.tokenId} ${entry.name || ""}:`);
      for (const c of entry.changes) {
        console.log(`    → ${c.label}`);
      }
      console.log();
    }
  }

  // Summary table
  console.log(`${"=".repeat(50)}`);
  console.log("WATCHLIST STATUS\n");
  console.log("  Token  | Name        | Owner       | Awake | TBA L1 | TBA Base | ToolPass | ETH (L1)    | ETH (Base)");
  console.log("  " + "-".repeat(105));
  for (const a of agents) {
    const ownerShort = a.owner ? `${a.owner.slice(0, 6)}…${a.owner.slice(-4)}` : "none";
    const name = (a.name || "—").padEnd(11).slice(0, 11);
    console.log(
      `  #${String(a.tokenId).padEnd(5)} | ${name} | ${ownerShort.padEnd(11)} | ` +
      `${a.awakened ? " yes " : "  no "} | ` +
      `${a.tbaDeployedL1 ? "  yes " : "   no "} | ` +
      `${a.tbaDeployedBase ? "   yes  " : "    no  "} | ` +
      `${String(a.toolPassCount).padStart(4).padEnd(8)} | ` +
      `${a.l1Eth.slice(0, 11).padEnd(11)} | ${a.baseEth.slice(0, 11)}`
    );
  }

  console.log(`\nSnapshot saved: ${snapshotPath}`);

  // Historical changes view
  if (opts.since && opts.since > 1) {
    const snaps = getRecentSnapshots(opts.since);
    if (snaps.length >= 2) {
      console.log(`\nHistory (last ${snaps.length} snapshots):`);
      for (let i = 1; i < snaps.length; i++) {
        const prev = snaps[i - 1];
        const curr = snaps[i];
        let changeCount = 0;
        for (const ca of curr.agents) {
          const pa = prev.agents.find(a => a.tokenId === ca.tokenId);
          if (pa) changeCount += diffSnapshots(pa, ca).length;
          else changeCount++;
        }
        console.log(`  ${prev.timestamp.slice(0, 16)} → ${curr.timestamp.slice(0, 16)}: ${changeCount} change(s)`);
      }
    }
  }
}

// CLI
const args = process.argv.slice(2);
const command = args[0];
const jsonFlag = args.includes("--json");
const sinceIdx = args.indexOf("--since");
const sinceVal = sinceIdx >= 0 ? parseInt(args[sinceIdx + 1]) || 5 : 0;

switch (command) {
  case "add": {
    const ids = args.slice(1).filter(a => !a.startsWith("-")).map(Number).filter(n => n > 0);
    if (ids.length === 0) { console.log("Usage: node watchlist.mjs add <tokenId> [tokenId...]"); break; }
    await cmdAdd(ids);
    break;
  }
  case "remove":
  case "rm": {
    const ids = args.slice(1).filter(a => !a.startsWith("-")).map(Number).filter(n => n > 0);
    if (ids.length === 0) { console.log("Usage: node watchlist.mjs remove <tokenId> [tokenId...]"); break; }
    await cmdRemove(ids);
    break;
  }
  case "list":
  case "ls":
    await cmdList();
    break;
  case "check":
  case "scan":
    await cmdCheck({ json: jsonFlag, since: sinceVal });
    break;
  default:
    console.log(`normies-tools watchlist — track Normies and detect state changes

Commands:
  add <id> [id...]      Add token IDs to watchlist
  remove <id> [id...]   Remove token IDs from watchlist
  list                  Show current watchlist with last known state
  check                 Snapshot all watched Normies and diff against previous
    --json              Machine-readable output
    --since N           Show change history across last N snapshots`);
}
