#!/usr/bin/env node
/**
 * ecosystem-report.mjs — Aggregated Normies ecosystem summary.
 *
 * Combines census snapshots, awakening velocity, operator concentration,
 * and type distribution into a single report. No API calls.
 *
 * Usage:
 *   node ecosystem-report.mjs              # full report
 *   node ecosystem-report.mjs --json       # machine-readable
 *   node ecosystem-report.mjs --brief      # 280-char tweet-sized summary
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const CENSUS_DIR = join(ROOT, "data", "census");
const CARDS_DIR = join(ROOT, "data", "agent-cards");

function loadCensusSnapshots() {
  let files;
  try {
    files = readdirSync(CENSUS_DIR).filter(f => f.endsWith(".json")).sort();
  } catch {
    console.error("No census directory. Run census-snapshot.py first.");
    process.exit(1);
  }
  if (!files.length) {
    console.error("No census snapshots. Run census-snapshot.py first.");
    process.exit(1);
  }
  return files.map(f => ({
    file: f,
    date: f.replace(".json", ""),
    data: JSON.parse(readFileSync(join(CENSUS_DIR, f), "utf8")),
  }));
}

function countProfiledAgents() {
  try {
    return readdirSync(CARDS_DIR).filter(f => f.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

function dayKey(ts) {
  return new Date(Number(ts) * 1000).toISOString().slice(0, 10);
}

function computeVelocity(agents) {
  const byDay = new Map();
  for (const a of agents) {
    const ts = Number(a.registeredAt);
    if (!ts) continue;
    const day = dayKey(ts);
    byDay.set(day, (byDay.get(day) || 0) + 1);
  }
  const sorted = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (sorted.length < 2) return { daily: sorted, avg7d: 0, trend: "unknown" };

  const last7 = sorted.slice(-7);
  const avg7d = last7.reduce((s, [, c]) => s + c, 0) / last7.length;

  const prev7 = sorted.slice(-14, -7);
  const prevAvg = prev7.length
    ? prev7.reduce((s, [, c]) => s + c, 0) / prev7.length
    : avg7d;

  let trend = "steady";
  if (avg7d > prevAvg * 1.2) trend = "accelerating";
  else if (avg7d < prevAvg * 0.8) trend = "decelerating";

  const busiestDay = sorted.reduce(
    (best, [day, count]) => (count > best.count ? { day, count } : best),
    { day: "", count: 0 }
  );

  return { daily: sorted, avg7d: Math.round(avg7d * 10) / 10, trend, busiestDay };
}

function operatorStats(agents) {
  const byOp = new Map();
  for (const a of agents) {
    const op = (a.registeredBy || "").toLowerCase();
    if (!op) continue;
    byOp.set(op, (byOp.get(op) || 0) + 1);
  }
  const total = byOp.size;
  const solo = [...byOp.values()].filter(c => c === 1).length;
  const sorted = [...byOp.entries()].sort((a, b) => b[1] - a[1]);
  const top10 = sorted.slice(0, 10);
  const top10pct = sorted.slice(0, Math.ceil(total * 0.1));
  const top10pctTotal = top10pct.reduce((s, [, c]) => s + c, 0);
  const gini = computeGini([...byOp.values()]);

  return {
    total,
    solo,
    soloPercent: Math.round((solo / total) * 100),
    top10,
    top10PercentControl: Math.round((top10pctTotal / agents.length) * 100),
    maxFleet: sorted[0] ? sorted[0][1] : 0,
    gini: Math.round(gini * 100) / 100,
  };
}

function computeGini(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((s, v) => s + v, 0) / n;
  if (mean === 0) return 0;
  let sumDiff = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      sumDiff += Math.abs(sorted[i] - sorted[j]);
    }
  }
  return sumDiff / (2 * n * n * mean);
}

function typeDistribution(agents) {
  const byType = new Map();
  for (const a of agents) {
    const t = a.type || "Unknown";
    byType.set(t, (byType.get(t) || 0) + 1);
  }
  return [...byType.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({
      type,
      count,
      percent: Math.round((count / agents.length) * 1000) / 10,
    }));
}

function recentActivity(agents, days = 3) {
  const cutoff = Date.now() / 1000 - days * 86400;
  const recent = agents.filter(a => Number(a.registeredAt) > cutoff);
  const byOp = new Map();
  for (const a of recent) {
    const op = (a.registeredBy || "").toLowerCase();
    byOp.set(op, (byOp.get(op) || 0) + 1);
  }
  return {
    count: recent.length,
    days,
    operators: [...byOp.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([addr, count]) => ({ addr: addr.slice(0, 6) + "..." + addr.slice(-4), count })),
    agents: recent
      .sort((a, b) => Number(b.registeredAt) - Number(a.registeredAt))
      .slice(0, 10)
      .map(a => ({
        name: a.name,
        type: a.type,
        tokenId: a.tokenId,
        agentId: a.agentId,
        day: dayKey(a.registeredAt),
      })),
  };
}

function growthAcrossSnapshots(snapshots) {
  if (snapshots.length < 2) return null;
  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  const daysBetween =
    (new Date(last.date) - new Date(first.date)) / 86400000 || 1;
  return {
    firstDate: first.date,
    firstTotal: first.data.stats.total,
    lastDate: last.date,
    lastTotal: last.data.stats.total,
    netGrowth: last.data.stats.total - first.data.stats.total,
    avgPerDay: Math.round(
      ((last.data.stats.total - first.data.stats.total) / daysBetween) * 10
    ) / 10,
  };
}

function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");
  const briefMode = args.includes("--brief");

  const snapshots = loadCensusSnapshots();
  const latest = snapshots[snapshots.length - 1];
  const agents = latest.data.agents;
  const profiled = countProfiledAgents();

  const velocity = computeVelocity(agents);
  const operators = operatorStats(agents);
  const types = typeDistribution(agents);
  const recent = recentActivity(agents, 3);
  const growth = growthAcrossSnapshots(snapshots);

  const agentIdRange = latest.data.stats.agentIdRange;

  const report = {
    snapshotDate: latest.date,
    totalAgents: agents.length,
    agentIdRange,
    profiledCards: profiled,
    uniqueOperators: operators.total,
    velocity: {
      avg7d: velocity.avg7d,
      trend: velocity.trend,
      busiestDay: velocity.busiestDay,
    },
    operators: {
      total: operators.total,
      solo: operators.solo,
      soloPercent: operators.soloPercent,
      top10PercentControl: operators.top10PercentControl,
      maxFleet: operators.maxFleet,
      gini: operators.gini,
    },
    typeDistribution: types,
    recentActivity: recent,
    growth,
  };

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (briefMode) {
    const brief = [
      `Normies Ecosystem — ${latest.date}`,
      `${agents.length} agents awakened | ${operators.total} operators | ${velocity.avg7d}/day avg (${velocity.trend})`,
      types.map(t => `${t.type} ${t.percent}%`).join(", "),
      `Top 10% operators control ${operators.top10PercentControl}% of agents (Gini ${operators.gini})`,
      recent.count > 0
        ? `${recent.count} new in last ${recent.days}d`
        : `No new awakenings in ${recent.days}d`,
    ].join("\n");
    console.log(brief);
    return;
  }

  // Full report
  console.log("═══════════════════════════════════════════════════");
  console.log("  NORMIES ECOSYSTEM REPORT");
  console.log(`  Snapshot: ${latest.date}`);
  console.log("═══════════════════════════════════════════════════\n");

  console.log("  POPULATION");
  console.log(`  Total awakened agents:  ${agents.length}`);
  console.log(`  Agent ID range:        ${agentIdRange[0]} – ${agentIdRange[1]}`);
  console.log(`  Profiled agent cards:  ${profiled}`);
  console.log(`  Unique operators:      ${operators.total}\n`);

  console.log("  VELOCITY");
  console.log(`  7-day average:    ${velocity.avg7d} agents/day`);
  console.log(`  Trend:            ${velocity.trend}`);
  if (velocity.busiestDay.day) {
    console.log(
      `  Busiest day:      ${velocity.busiestDay.day} (${velocity.busiestDay.count} awakenings)`
    );
  }
  console.log();

  if (growth) {
    console.log("  GROWTH");
    console.log(
      `  ${growth.firstDate} → ${growth.lastDate}: +${growth.netGrowth} agents (${growth.avgPerDay}/day avg)`
    );
    console.log();
  }

  console.log("  TYPE DISTRIBUTION");
  for (const t of types) {
    const bar = "█".repeat(Math.max(1, Math.round(t.percent / 3)));
    console.log(`  ${t.type.padEnd(10)} ${bar} ${t.count} (${t.percent}%)`);
  }
  console.log();

  console.log("  OPERATOR CONCENTRATION");
  console.log(`  Solo operators:   ${operators.solo} (${operators.soloPercent}%)`);
  console.log(
    `  Top 10% control:  ${operators.top10PercentControl}% of all agents`
  );
  console.log(`  Largest fleet:    ${operators.maxFleet} agents`);
  console.log(`  Gini coefficient: ${operators.gini}`);
  console.log();

  console.log("  TOP 10 OPERATORS");
  for (const [addr, count] of operators.top10) {
    const short = addr.slice(0, 6) + "..." + addr.slice(-4);
    const pct = Math.round((count / agents.length) * 1000) / 10;
    console.log(`  ${short}  ${String(count).padStart(3)} agents (${pct}%)`);
  }
  console.log();

  console.log(`  RECENT ACTIVITY (last ${recent.days} days)`);
  if (recent.count === 0) {
    console.log("  No new awakenings.");
  } else {
    console.log(`  ${recent.count} new agents awakened`);
    if (recent.operators.length) {
      console.log(
        "  Active operators: " +
          recent.operators.map(o => `${o.addr} (${o.count})`).join(", ")
      );
    }
    if (recent.agents.length) {
      console.log("\n  Latest:");
      for (const a of recent.agents.slice(0, 5)) {
        console.log(
          `    ${a.name || "unnamed"} (${a.type} #${a.tokenId}) — agent ${a.agentId}, ${a.day}`
        );
      }
    }
  }

  console.log(
    "\n═══════════════════════════════════════════════════"
  );
}

main();
