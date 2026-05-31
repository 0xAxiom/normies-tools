#!/usr/bin/env node
/**
 * awakening-rate.mjs — Analyze awakening velocity from census data.
 *
 * Reads the latest census snapshot and computes daily awakening rates,
 * busiest days, operator activity trends, and 7-day moving averages.
 * No API calls — works entirely from local census data.
 *
 * Usage:
 *   node awakening-rate.mjs              # full report
 *   node awakening-rate.mjs --json       # machine-readable
 *   node awakening-rate.mjs --days 14    # last N days only
 *   node awakening-rate.mjs --operators  # top operators by recent activity
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const CENSUS_DIR = join(ROOT, "data", "census");

function loadLatestCensus() {
  let files;
  try {
    files = readdirSync(CENSUS_DIR).filter(f => f.endsWith(".json")).sort();
  } catch {
    console.error("No census directory found. Run census-snapshot.py first.");
    process.exit(1);
  }
  if (files.length === 0) {
    console.error("No census snapshots found. Run census-snapshot.py first.");
    process.exit(1);
  }
  const latest = files[files.length - 1];
  const data = JSON.parse(readFileSync(join(CENSUS_DIR, latest), "utf8"));
  return { file: latest, data };
}

function dayKey(ts) {
  const d = new Date(Number(ts) * 1000);
  return d.toISOString().slice(0, 10);
}

function analyze(agents, { days = null } = {}) {
  // Group by registration day
  const byDay = new Map();
  const byOperatorRecent = new Map();

  const now = Date.now() / 1000;
  const cutoff = days ? now - days * 86400 : 0;

  for (const a of agents) {
    const ts = Number(a.registeredAt);
    if (!ts) continue;
    const day = dayKey(ts);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(a);

    // Track recent operator activity (last 14 days regardless of --days filter)
    if (ts > now - 14 * 86400) {
      const op = a.registeredBy || "unknown";
      byOperatorRecent.set(op, (byOperatorRecent.get(op) || 0) + 1);
    }
  }

  // Sort days chronologically
  const sortedDays = [...byDay.keys()].sort();

  // Apply day cutoff for display
  const cutoffDate = days ? dayKey(cutoff) : sortedDays[0];
  const displayDays = sortedDays.filter(d => d >= cutoffDate);

  // Daily counts
  const dailyCounts = displayDays.map(d => ({
    date: d,
    count: byDay.get(d)?.length || 0,
  }));

  // 7-day moving average
  const movingAvg = [];
  for (let i = 0; i < displayDays.length; i++) {
    const window = displayDays.slice(Math.max(0, i - 6), i + 1);
    const sum = window.reduce((s, d) => s + (byDay.get(d)?.length || 0), 0);
    movingAvg.push({
      date: displayDays[i],
      avg7d: Math.round((sum / window.length) * 100) / 100,
    });
  }

  // Busiest days (all time)
  const busiestAll = [...byDay.entries()]
    .map(([date, agents]) => ({ date, count: agents.length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Total and rate
  const firstTs = Math.min(...agents.map(a => Number(a.registeredAt)).filter(Boolean));
  const totalDaysSpan = Math.max(1, Math.round((now - firstTs) / 86400));
  const overallRate = Math.round((agents.length / totalDaysSpan) * 100) / 100;

  // Recent rate (last 7 days)
  const recent7 = sortedDays.filter(d => d >= dayKey(now - 7 * 86400));
  const recent7Count = recent7.reduce((s, d) => s + (byDay.get(d)?.length || 0), 0);
  const recent7Rate = Math.round((recent7Count / Math.max(1, recent7.length)) * 100) / 100;

  // Top recent operators
  const topOperators = [...byOperatorRecent.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([addr, count]) => ({ address: addr, recentCount: count }));

  return {
    totalAgents: agents.length,
    dateRange: { first: sortedDays[0], last: sortedDays[sortedDays.length - 1] },
    totalDaysSpan,
    overallRate,
    recent7Days: { count: recent7Count, avgPerDay: recent7Rate },
    busiestDays: busiestAll,
    topRecentOperators: topOperators,
    dailyCounts,
    movingAvg,
  };
}

function printHuman(result) {
  console.log("\n=== Normies Awakening Rate ===\n");
  console.log(`Total awakened: ${result.totalAgents}`);
  console.log(`Date range: ${result.dateRange.first} to ${result.dateRange.last} (${result.totalDaysSpan} days)`);
  console.log(`Overall rate: ${result.overallRate} agents/day`);
  console.log(`Last 7 days: ${result.recent7Days.count} agents (${result.recent7Days.avgPerDay}/day)\n`);

  console.log("Top 5 busiest days:");
  for (const d of result.busiestDays) {
    console.log(`  ${d.date}: ${d.count} agents`);
  }

  console.log("\nTop recent operators (14d):");
  for (const op of result.topRecentOperators.slice(0, 5)) {
    console.log(`  ${op.address.slice(0, 10)}...${op.address.slice(-4)}: ${op.recentCount} agents`);
  }

  // Sparkline of last 14 daily counts
  const last14 = result.dailyCounts.slice(-14);
  if (last14.length > 1) {
    const maxC = Math.max(...last14.map(d => d.count), 1);
    const bars = "▁▂▃▄▅▆▇█";
    const spark = last14.map(d => bars[Math.min(Math.floor((d.count / maxC) * 7), 7)]).join("");
    console.log(`\nLast 14 days: ${spark}`);
    console.log(`  (${last14.map(d => d.count).join(", ")})`);
  }

  // Trend indicator
  if (result.movingAvg.length >= 14) {
    const recent = result.movingAvg[result.movingAvg.length - 1].avg7d;
    const prior = result.movingAvg[result.movingAvg.length - 8]?.avg7d || recent;
    const diff = recent - prior;
    const arrow = diff > 0.5 ? "accelerating" : diff < -0.5 ? "decelerating" : "steady";
    console.log(`\n7d MA trend: ${prior.toFixed(1)} -> ${recent.toFixed(1)} (${arrow})`);
  }
}

// --- CLI ---
function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("Usage: node awakening-rate.mjs [--json] [--days N] [--operators]");
    process.exit(0);
  }

  const jsonMode = args.includes("--json");
  const daysIdx = args.indexOf("--days");
  const days = daysIdx >= 0 ? parseInt(args[daysIdx + 1]) : null;

  const { file, data } = loadLatestCensus();
  const agents = data.agents || [];

  if (agents.length === 0) {
    console.error("Census snapshot has no agents.");
    process.exit(1);
  }

  console.error(`[census: ${file}, ${agents.length} agents]`);

  const result = analyze(agents, { days });

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHuman(result);
  }
}

main();
