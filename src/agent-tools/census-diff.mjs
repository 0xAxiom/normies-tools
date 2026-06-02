#!/usr/bin/env node
/**
 * census-diff.mjs — Deep comparison between two census snapshots.
 *
 * Shows new awakenings, departed agents, operator fleet changes,
 * type distribution shift, velocity delta, and concentration trends.
 * No API calls — reads from data/census/ snapshots.
 *
 * Usage:
 *   node census-diff.mjs                           # latest vs previous
 *   node census-diff.mjs 2026-05-31 2026-06-02     # specific dates
 *   node census-diff.mjs --json                    # machine-readable
 *   node census-diff.mjs --all                     # diff across all snapshots
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const CENSUS_DIR = join(ROOT, "data", "census");

function loadSnapshot(date) {
  const file = join(CENSUS_DIR, `${date}.json`);
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    console.error(`No census snapshot for ${date}. Available:`);
    listSnapshots();
    process.exit(1);
  }
}

function listSnapshots() {
  try {
    const files = readdirSync(CENSUS_DIR).filter(f => f.endsWith(".json")).sort();
    files.forEach(f => console.error(`  ${f.replace(".json", "")}`));
    return files.map(f => f.replace(".json", ""));
  } catch {
    console.error("  (no census directory)");
    return [];
  }
}

function agentKey(a) {
  return `${a.tokenId}:${a.agentId}`;
}

function operatorFleet(agents) {
  const fleet = new Map();
  for (const a of agents) {
    const op = a.registeredBy.toLowerCase();
    if (!fleet.has(op)) fleet.set(op, []);
    fleet.get(op).push(a);
  }
  return fleet;
}

function typeDistribution(agents) {
  const dist = {};
  for (const a of agents) {
    dist[a.type] = (dist[a.type] || 0) + 1;
  }
  return dist;
}

function gini(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((s, v) => s + v, 0);
  if (sum === 0) return 0;
  let cumSum = 0;
  let giniSum = 0;
  for (let i = 0; i < n; i++) {
    cumSum += sorted[i];
    giniSum += (2 * (i + 1) - n - 1) * sorted[i];
  }
  return giniSum / (n * sum);
}

function diffSnapshots(oldSnap, newSnap) {
  const oldSet = new Map(oldSnap.agents.map(a => [agentKey(a), a]));
  const newSet = new Map(newSnap.agents.map(a => [agentKey(a), a]));

  const added = [];
  const removed = [];

  for (const [key, agent] of newSet) {
    if (!oldSet.has(key)) added.push(agent);
  }
  for (const [key, agent] of oldSet) {
    if (!newSet.has(key)) removed.push(agent);
  }

  added.sort((a, b) => Number(b.registeredAt) - Number(a.registeredAt));

  const oldFleet = operatorFleet(oldSnap.agents);
  const newFleet = operatorFleet(newSnap.agents);

  const operatorChanges = [];
  const allOperators = new Set([...oldFleet.keys(), ...newFleet.keys()]);

  for (const op of allOperators) {
    const oldCount = oldFleet.get(op)?.length || 0;
    const newCount = newFleet.get(op)?.length || 0;
    const delta = newCount - oldCount;
    if (delta !== 0) {
      operatorChanges.push({
        operator: op,
        oldCount,
        newCount,
        delta,
        newAgents: delta > 0
          ? (newFleet.get(op) || []).filter(a => !oldSet.has(agentKey(a)))
          : [],
      });
    }
  }
  operatorChanges.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const oldTypes = typeDistribution(oldSnap.agents);
  const newTypes = typeDistribution(newSnap.agents);
  const allTypes = new Set([...Object.keys(oldTypes), ...Object.keys(newTypes)]);
  const typeChanges = {};
  for (const t of allTypes) {
    const old = oldTypes[t] || 0;
    const cur = newTypes[t] || 0;
    if (old !== cur) typeChanges[t] = { old, new: cur, delta: cur - old };
  }

  const oldGini = gini([...oldFleet.values()].map(v => v.length));
  const newGini = gini([...newFleet.values()].map(v => v.length));

  const oldTop10Pct = Math.ceil(oldFleet.size * 0.1);
  const newTop10Pct = Math.ceil(newFleet.size * 0.1);
  const oldTop10Control = [...oldFleet.values()]
    .map(v => v.length)
    .sort((a, b) => b - a)
    .slice(0, oldTop10Pct)
    .reduce((s, v) => s + v, 0);
  const newTop10Control = [...newFleet.values()]
    .map(v => v.length)
    .sort((a, b) => b - a)
    .slice(0, newTop10Pct)
    .reduce((s, v) => s + v, 0);

  return {
    period: {
      from: oldSnap.snapshotDate,
      to: newSnap.snapshotDate,
    },
    population: {
      old: oldSnap.stats.total,
      new: newSnap.stats.total,
      netGrowth: newSnap.stats.total - oldSnap.stats.total,
      added: added.length,
      removed: removed.length,
    },
    operators: {
      old: oldFleet.size,
      new: newFleet.size,
      netGrowth: newFleet.size - oldFleet.size,
    },
    concentration: {
      gini: { old: oldGini, new: newGini, delta: newGini - oldGini },
      top10PctControl: {
        old: oldSnap.stats.total ? oldTop10Control / oldSnap.stats.total : 0,
        new: newSnap.stats.total ? newTop10Control / newSnap.stats.total : 0,
      },
    },
    typeChanges,
    addedAgents: added,
    removedAgents: removed,
    operatorChanges: operatorChanges.slice(0, 20),
  };
}

function printDiff(diff) {
  const { period, population, operators, concentration, typeChanges, addedAgents, removedAgents, operatorChanges } = diff;

  console.log(`\n═══ Census Diff: ${period.from} → ${period.to} ═══\n`);

  const sign = n => (n > 0 ? `+${n}` : `${n}`);

  console.log("Population");
  console.log(`  Agents:    ${population.old} → ${population.new} (${sign(population.netGrowth)})`);
  console.log(`  Added:     ${population.added}`);
  console.log(`  Removed:   ${population.removed}`);
  console.log(`  Operators: ${operators.old} → ${operators.new} (${sign(operators.netGrowth)})`);

  console.log("\nConcentration");
  console.log(`  Gini:           ${concentration.gini.old.toFixed(3)} → ${concentration.gini.new.toFixed(3)} (${sign(concentration.gini.delta.toFixed(3))})`);
  console.log(`  Top 10% share:  ${(concentration.top10PctControl.old * 100).toFixed(1)}% → ${(concentration.top10PctControl.new * 100).toFixed(1)}%`);

  if (Object.keys(typeChanges).length) {
    console.log("\nType Distribution Changes");
    for (const [type, { old, new: cur, delta }] of Object.entries(typeChanges)) {
      console.log(`  ${type}: ${old} → ${cur} (${sign(delta)})`);
    }
  } else {
    console.log("\nType Distribution: unchanged");
  }

  if (addedAgents.length) {
    console.log(`\nNew Agents (${addedAgents.length})`);
    for (const a of addedAgents.slice(0, 20)) {
      const date = new Date(Number(a.registeredAt) * 1000).toISOString().slice(0, 10);
      console.log(`  #${a.tokenId} ${a.name} (${a.type}) — agent ${a.agentId}, ${date}, by ${a.registeredBy.slice(0, 10)}...`);
    }
    if (addedAgents.length > 20) console.log(`  ... and ${addedAgents.length - 20} more`);
  }

  if (removedAgents.length) {
    console.log(`\nRemoved Agents (${removedAgents.length})`);
    for (const a of removedAgents.slice(0, 10)) {
      console.log(`  #${a.tokenId} ${a.name} (${a.type}) — agent ${a.agentId}, by ${a.registeredBy.slice(0, 10)}...`);
    }
  }

  if (operatorChanges.length) {
    console.log(`\nOperator Fleet Changes (top ${Math.min(operatorChanges.length, 10)})`);
    for (const op of operatorChanges.slice(0, 10)) {
      const dir = op.delta > 0 ? "▲" : "▼";
      console.log(`  ${op.operator.slice(0, 10)}... ${op.oldCount} → ${op.newCount} (${dir}${Math.abs(op.delta)})`);
      for (const a of op.newAgents.slice(0, 3)) {
        console.log(`    + #${a.tokenId} ${a.name} (${a.type})`);
      }
    }
  }

  if (population.netGrowth === 0 && operators.netGrowth === 0) {
    console.log("\n→ No changes between snapshots.");
  }

  console.log();
}

function printAllDiffs(snapshots) {
  console.log(`\n═══ Census Timeline: ${snapshots.length} snapshots ═══\n`);
  console.log("Date        | Agents | Δ   | Operators | Δ   | Gini");
  console.log("------------|--------|-----|-----------|-----|------");

  for (let i = 0; i < snapshots.length; i++) {
    const snap = snapshots[i];
    const fleet = operatorFleet(snap.data.agents);
    const g = gini([...fleet.values()].map(v => v.length));
    const total = snap.data.stats.total;
    const ops = fleet.size;

    if (i === 0) {
      console.log(`${snap.date} | ${String(total).padStart(6)} |     | ${String(ops).padStart(9)} |     | ${g.toFixed(3)}`);
    } else {
      const prev = snapshots[i - 1].data;
      const prevFleet = operatorFleet(prev.agents);
      const dt = total - prev.stats.total;
      const dOps = ops - prevFleet.size;
      const sign = n => (n > 0 ? `+${n}` : n === 0 ? " 0" : `${n}`);
      console.log(`${snap.date} | ${String(total).padStart(6)} | ${sign(dt).padStart(3)} | ${String(ops).padStart(9)} | ${sign(dOps).padStart(3)} | ${g.toFixed(3)}`);
    }
  }

  if (snapshots.length >= 2) {
    const first = snapshots[0].data;
    const last = snapshots[snapshots.length - 1].data;
    const days = snapshots.length - 1;
    const totalGrowth = last.stats.total - first.stats.total;
    const avgDaily = days > 0 ? (totalGrowth / days).toFixed(1) : "0";
    console.log(`\nSummary: ${totalGrowth} new agents over ${days} day(s) (avg ${avgDaily}/day)`);
  }
  console.log();
}

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const allMode = args.includes("--all");
const dates = args.filter(a => /^\d{4}-\d{2}-\d{2}$/.test(a));

const available = readdirSync(CENSUS_DIR).filter(f => f.endsWith(".json")).sort();
if (available.length < 2 && !allMode) {
  console.error("Need at least 2 census snapshots for comparison.");
  console.error("Run census-snapshot.py on different days first.");
  process.exit(1);
}

if (allMode) {
  const snapshots = available.map(f => ({
    date: f.replace(".json", ""),
    data: JSON.parse(readFileSync(join(CENSUS_DIR, f), "utf8")),
  }));

  if (jsonMode) {
    const diffs = [];
    for (let i = 1; i < snapshots.length; i++) {
      diffs.push(diffSnapshots(snapshots[i - 1].data, snapshots[i].data));
    }
    console.log(JSON.stringify({ timeline: snapshots.map(s => s.date), diffs }, null, 2));
  } else {
    printAllDiffs(snapshots);
    if (snapshots.length >= 2) {
      const full = diffSnapshots(snapshots[0].data, snapshots[snapshots.length - 1].data);
      console.log("─── Full Period Detail ───");
      printDiff(full);
    }
  }
} else {
  let dateA, dateB;
  if (dates.length >= 2) {
    [dateA, dateB] = dates.sort();
  } else {
    dateB = available[available.length - 1].replace(".json", "");
    dateA = available[available.length - 2].replace(".json", "");
  }

  const snapA = loadSnapshot(dateA);
  const snapB = loadSnapshot(dateB);
  const diff = diffSnapshots(snapA, snapB);

  if (jsonMode) {
    console.log(JSON.stringify(diff, null, 2));
  } else {
    printDiff(diff);
  }
}
