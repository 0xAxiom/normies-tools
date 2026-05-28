#!/usr/bin/env node
/**
 * binding-watch.mjs — Monitor Normie agent binding changes.
 *
 * Polls Adapter8004 for the known awakened set, detects:
 *   - New awakenings (tokenId appeared in agent registry)
 *   - Operator changes (NFT transferred, controller shifted)
 *   - Unbindings (agent revoked)
 *
 * Usage:
 *   node binding-watch.mjs                   # check all known agents
 *   node binding-watch.mjs --token-ids 7593,294
 *   node binding-watch.mjs --diff            # only show changes since last run
 *   node binding-watch.mjs --json            # machine-readable output
 */

import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  CHAINS, ADAPTER_ABI, ERC721_ABI,
  loadEnv, getProvider,
} from "../../skills/awaken-normie/scripts/lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const KNOWN_PATH = path.join(ROOT, "data", "agents-known.json");
const STATE_PATH = path.join(ROOT, "data", "binding-state.json");
const NORMIES = "0x9Eb6E2025B64f340691e424b7fe7022fFDE12438";
const API_BASE = "https://api.normies.art";

function loadKnownAgents() {
  if (!fs.existsSync(KNOWN_PATH)) return [];
  const data = JSON.parse(fs.readFileSync(KNOWN_PATH, "utf8"));
  // Handle both array and object-with-agents format
  return Array.isArray(data) ? data : (data.agents || []);
}

function loadPreviousState() {
  if (!fs.existsSync(STATE_PATH)) return {};
  return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
}

async function fetchAgentInfo(tokenId) {
  try {
    const resp = await fetch(`${API_BASE}/agents/info/${tokenId}`, {
      headers: { "User-Agent": "normies-tools/binding-watch" },
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch { return null; }
}

async function checkBinding(tokenId, provider, adapter, normies) {
  const info = await fetchAgentInfo(tokenId);
  if (!info || !info.agentId) {
    return { tokenId, awakened: false, agentId: null };
  }

  const result = {
    tokenId,
    awakened: true,
    agentId: info.agentId,
    name: info.name || null,
    type: info.type || null,
  };

  // Get current NFT owner
  try {
    result.owner = await normies.ownerOf(tokenId);
  } catch {
    result.owner = null;
  }

  // Get adapter binding
  try {
    const binding = await adapter.bindingOf(info.agentId);
    result.binding = {
      standard: ["ERC721", "ERC1155", "ERC6909"][Number(binding[0])] || `unknown(${binding[0]})`,
      tokenContract: binding[1],
      tokenId: binding[2].toString(),
    };
  } catch {
    result.binding = null;
  }

  // Check controller status
  if (result.owner && info.agentId) {
    try {
      result.ownerIsController = await adapter.isController(info.agentId, result.owner);
    } catch {
      result.ownerIsController = null;
    }
  }

  return result;
}

function diffStates(previous, current) {
  const changes = [];

  for (const [tokenId, cur] of Object.entries(current)) {
    const prev = previous[tokenId];

    if (!prev) {
      changes.push({ type: "new_awakening", tokenId: Number(tokenId), agent: cur });
      continue;
    }

    if (prev.owner !== cur.owner && cur.owner) {
      changes.push({
        type: "owner_change",
        tokenId: Number(tokenId),
        name: cur.name,
        from: prev.owner,
        to: cur.owner,
      });
    }

    if (prev.awakened && !cur.awakened) {
      changes.push({
        type: "unbound",
        tokenId: Number(tokenId),
        name: prev.name,
      });
    }

    if (prev.ownerIsController !== cur.ownerIsController) {
      changes.push({
        type: "controller_change",
        tokenId: Number(tokenId),
        name: cur.name,
        wasController: prev.ownerIsController,
        isController: cur.ownerIsController,
      });
    }
  }

  return changes;
}

async function main() {
  const args = process.argv.slice(2);
  const diffOnly = args.includes("--diff");
  const jsonOut = args.includes("--json");
  const tokenIdIdx = args.indexOf("--token-ids");

  loadEnv();
  const provider = getProvider("mainnet");
  const adapter = new ethers.Contract(CHAINS.mainnet.adapter, ADAPTER_ABI, provider);
  const normies = new ethers.Contract(NORMIES, ERC721_ABI, provider);

  let tokenIds;
  if (tokenIdIdx >= 0) {
    tokenIds = args[tokenIdIdx + 1].split(",").map(Number);
  } else {
    const known = loadKnownAgents();
    tokenIds = known.map(a => typeof a === "number" ? a : a.tokenId).filter(Boolean);
    if (tokenIds.length === 0) {
      console.error("No known agents found. Run discover.py first, or pass --token-ids.");
      process.exit(1);
    }
  }

  const previousState = loadPreviousState();
  const currentState = {};

  for (const id of tokenIds) {
    try {
      const result = await checkBinding(id, provider, adapter, normies);
      currentState[id] = result;
    } catch (err) {
      currentState[id] = { tokenId: id, error: err.message };
    }
  }

  const changes = diffStates(previousState, currentState);
  saveState(currentState);

  if (jsonOut) {
    console.log(JSON.stringify({
      checked: tokenIds.length,
      changes: changes.length,
      ...(diffOnly ? { changes } : { state: currentState, changes }),
      checkedAt: new Date().toISOString(),
    }, null, 2));
    return;
  }

  // Human-readable output
  console.log(`Checked ${tokenIds.length} agents, ${changes.length} change(s) detected.\n`);

  if (changes.length === 0 && diffOnly) {
    console.log("No changes since last check.");
    return;
  }

  if (changes.length > 0) {
    console.log("Changes:");
    for (const c of changes) {
      switch (c.type) {
        case "new_awakening":
          console.log(`  + NEW: #${c.tokenId} awakened as ${c.agent.name || "unnamed"} (agentId ${c.agent.agentId})`);
          break;
        case "owner_change":
          console.log(`  ~ TRANSFER: #${c.tokenId} (${c.name}) moved from ${c.from} → ${c.to}`);
          break;
        case "unbound":
          console.log(`  - UNBOUND: #${c.tokenId} (${c.name}) is no longer awakened`);
          break;
        case "controller_change":
          console.log(`  ~ CONTROLLER: #${c.tokenId} (${c.name}) controller status ${c.wasController} → ${c.isController}`);
          break;
      }
    }
  }

  if (!diffOnly) {
    console.log("\nCurrent state:");
    for (const [id, s] of Object.entries(currentState)) {
      if (s.error) {
        console.log(`  #${id}: ERROR — ${s.error}`);
      } else if (!s.awakened) {
        console.log(`  #${id}: not awakened`);
      } else {
        console.log(`  #${id}: ${s.name || "unnamed"} (agent ${s.agentId}) | owner: ${s.owner?.slice(0, 10)}… | controller: ${s.ownerIsController}`);
      }
    }
  }
}

export { checkBinding, diffStates };
main().catch(e => { console.error(e.message); process.exit(1); });
