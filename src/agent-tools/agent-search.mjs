#!/usr/bin/env node
/**
 * agent-search.mjs — Search and filter awakened Normie agents.
 *
 * Searches across census data (1000+ agents) and enriched agent cards
 * (profiled subset with persona, traits, backstory). Supports filtering
 * by name, type, operator, date range, and keyword search in system prompts.
 *
 * Usage:
 *   node agent-search.mjs "Mine"                       # search by name
 *   node agent-search.mjs --type Robot                  # filter by type
 *   node agent-search.mjs --operator 0x523E...dde5      # filter by operator
 *   node agent-search.mjs --since 2026-05-20            # awakened after date
 *   node agent-search.mjs --until 2026-05-25            # awakened before date
 *   node agent-search.mjs --keyword "conviction"        # search in persona/backstory
 *   node agent-search.mjs --type Human --since 2026-05-28 --json
 *   node agent-search.mjs --profiled                    # only agents with full cards
 *   node agent-search.mjs --stats                       # type distribution summary
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CENSUS_DIR = path.join(__dirname, "../../data/census");
const CARDS_DIR = path.join(__dirname, "../../data/agent-cards");

function loadLatestCensus() {
  if (!fs.existsSync(CENSUS_DIR)) return [];
  const files = fs.readdirSync(CENSUS_DIR).filter(f => f.endsWith(".json")).sort();
  if (files.length === 0) return [];
  const data = JSON.parse(fs.readFileSync(path.join(CENSUS_DIR, files[files.length - 1]), "utf-8"));
  return data.agents || [];
}

function loadAgentCards() {
  if (!fs.existsSync(CARDS_DIR)) return {};
  const cards = {};
  for (const f of fs.readdirSync(CARDS_DIR).filter(f => f.endsWith(".json"))) {
    const tokenId = f.replace(".json", "");
    try {
      cards[tokenId] = JSON.parse(fs.readFileSync(path.join(CARDS_DIR, f), "utf-8"));
    } catch {}
  }
  return cards;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { query: null, type: null, operator: null, since: null, until: null, keyword: null, profiled: false, json: false, stats: false, limit: 50 };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--type" && args[i + 1]) { opts.type = args[++i]; }
    else if (a === "--operator" && args[i + 1]) { opts.operator = args[++i].toLowerCase(); }
    else if (a === "--since" && args[i + 1]) { opts.since = new Date(args[++i]).getTime() / 1000; }
    else if (a === "--until" && args[i + 1]) { opts.until = new Date(args[++i]).getTime() / 1000; }
    else if (a === "--keyword" && args[i + 1]) { opts.keyword = args[++i].toLowerCase(); }
    else if (a === "--profiled") { opts.profiled = true; }
    else if (a === "--json") { opts.json = true; }
    else if (a === "--stats") { opts.stats = true; }
    else if (a === "--limit" && args[i + 1]) { opts.limit = parseInt(args[++i], 10); }
    else if (!a.startsWith("--")) { opts.query = a; }
  }
  return opts;
}

function matchAgent(agent, card, opts) {
  // Name search (fuzzy — case-insensitive substring)
  if (opts.query) {
    const q = opts.query.toLowerCase();
    const nameMatch = agent.name && agent.name.toLowerCase().includes(q);
    const idMatch = agent.tokenId === q || agent.agentId === q;
    if (!nameMatch && !idMatch) return false;
  }

  // Type filter
  if (opts.type && agent.type && agent.type.toLowerCase() !== opts.type.toLowerCase()) return false;

  // Operator filter
  if (opts.operator && agent.registeredBy && agent.registeredBy.toLowerCase() !== opts.operator) return false;

  // Date filters
  const ts = parseInt(agent.registeredAt, 10);
  if (opts.since && ts < opts.since) return false;
  if (opts.until && ts > opts.until) return false;

  // Profiled-only filter
  if (opts.profiled && !card) return false;

  // Keyword search in persona content
  if (opts.keyword && card) {
    const searchable = [
      card.systemPrompt || "",
      card.backstory || "",
      card.tagline || "",
      card.greeting || "",
      card.communicationStyle || "",
      ...(card.personalityTraits || []),
      ...(card.quirks || []),
    ].join(" ").toLowerCase();
    if (!searchable.includes(opts.keyword)) return false;
  } else if (opts.keyword && !card) {
    return false; // keyword search requires a profiled card
  }

  return true;
}

function formatDate(ts) {
  return new Date(parseInt(ts, 10) * 1000).toISOString().slice(0, 10);
}

function printStats(agents, cards) {
  const types = {};
  let profiled = 0;
  for (const a of agents) {
    types[a.type] = (types[a.type] || 0) + 1;
    if (cards[a.tokenId]) profiled++;
  }

  console.log(`\n  Census: ${agents.length} awakened agents`);
  console.log(`  Profiled: ${profiled} with full agent cards\n`);
  console.log("  Type Distribution:");
  for (const [type, count] of Object.entries(types).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / agents.length) * 100).toFixed(1);
    const bar = "#".repeat(Math.ceil(count / agents.length * 40));
    console.log(`    ${type.padEnd(10)} ${String(count).padStart(5)}  ${pct.padStart(5)}%  ${bar}`);
  }
  console.log();
}

function main() {
  const opts = parseArgs();
  const agents = loadLatestCensus();
  const cards = loadAgentCards();

  if (agents.length === 0) {
    console.error("No census data found. Run census-snapshot.py first.");
    process.exit(1);
  }

  if (opts.stats) {
    printStats(agents, cards);
    return;
  }

  // Filter
  const results = [];
  for (const agent of agents) {
    const card = cards[agent.tokenId] || null;
    if (matchAgent(agent, card, opts)) {
      results.push({ ...agent, _hasCard: !!card, _card: card });
    }
  }

  // Sort by registeredAt desc (newest first)
  results.sort((a, b) => parseInt(b.registeredAt, 10) - parseInt(a.registeredAt, 10));

  const limited = results.slice(0, opts.limit);

  if (opts.json) {
    const output = limited.map(r => {
      const o = { tokenId: r.tokenId, agentId: r.agentId, name: r.name, type: r.type, operator: r.registeredBy, registered: formatDate(r.registeredAt), profiled: r._hasCard };
      if (r._card) {
        o.tagline = r._card.tagline;
        o.traits = r._card.personalityTraits;
      }
      return o;
    });
    console.log(JSON.stringify({ total: results.length, shown: limited.length, results: output }, null, 2));
    return;
  }

  // Table output
  console.log(`\n  Found ${results.length} agents${results.length > opts.limit ? ` (showing ${opts.limit})` : ""}\n`);

  if (limited.length === 0) {
    console.log("  No matches.\n");
    return;
  }

  // Header
  console.log("  " + "Token".padEnd(7) + "Agent".padEnd(7) + "Name".padEnd(14) + "Type".padEnd(10) + "Registered".padEnd(13) + "Card".padEnd(6) + "Operator");
  console.log("  " + "-".repeat(80));

  for (const r of limited) {
    const card = r._hasCard ? "yes" : "";
    const op = r.registeredBy ? r.registeredBy.slice(0, 6) + "..." + r.registeredBy.slice(-4) : "";
    console.log("  " +
      String(r.tokenId).padEnd(7) +
      String(r.agentId).padEnd(7) +
      (r.name || "?").slice(0, 12).padEnd(14) +
      (r.type || "?").padEnd(10) +
      formatDate(r.registeredAt).padEnd(13) +
      card.padEnd(6) +
      op
    );
  }

  // If there are profiled matches, show taglines
  const profiledResults = limited.filter(r => r._card && r._card.tagline);
  if (profiledResults.length > 0) {
    console.log("\n  Taglines:");
    for (const r of profiledResults) {
      console.log(`    #${r.tokenId} ${r.name}: "${r._card.tagline}"`);
    }
  }

  console.log();
}

main();
