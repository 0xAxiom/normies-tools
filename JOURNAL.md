# Normies Journal

One line per fire. Format: `YYYY-MM-DD HH:MM PT | phase | outcome`

2026-05-16 14:14 PT | scaffold | workspace created, cron pending, wallet 0x523Eff3d…dde5 ready for Normie transfer
2026-05-16 19:44 PT | phase-1 | first cron fire, surveyed /normie/1/pixels — 200, plaintext 40x40 bitstring, 443/1600 on, rate 1/60
2026-05-16 19:44 PT | phase-transition → phase-2 | wallet holds Normie #7593 (first wallet check; Melted transferred). Next fire: render+traits for 7593.
2026-05-17 08:43 PT | phase-2 | /normie/7593/traits 200 — Human/Male/Old, half-shaved beard, eye-mask, confident, headband; raw 0x0000021309080507 = one byte per trait slot. Next: /owner then /agents/info.
2026-05-17 19:44 PT | phase-2 | /normie/7593/owner 200 — confirms wallet→token binding API-side (lowercased addr, no checksum); wallet still ["7593"]. Next: /agents/info/7593 persona.
2026-05-18 08:43 PT | phase-2 | /agents/info/7593 200 — Mine, agentId 32811, ERC-8004 chainId 1, 5001-char systemPrompt (8 sections, fully derived from traits+canvas), registered by self 2026-05-16 14:48 PT tx 0x767edfd7…8818, interactions+mcp coming_soon. Build hook: persona reply skill from data/agents-info-7593.json.
2026-05-18 19:43 PT | phase-2 | /normie/7593/image.svg 200 — 6936B, 40x40 viewBox scaled 1000x1000, 2-tone (#48494b on #e3e5e4), 120 rects with row run-length compression, 355/1600 on cells. Cross-checked against /pixels — match exactly; supersedes the "443/1600" figure in 2026-05-16 pixels note (which was off; canvas unchanged since mint). Wallet refreshed, still ["7593"]. Next: /image.png or /history.
2026-05-19 08:43 PT | phase-2 | /history/normie/7593/versions 200 → [] (also empty for ids 1/100/5000) — canvas edits look rare-or-zero across collection so far; 7593 empty consistent with prior svg↔pixels parity. Next: /agents/list or /agents/binding/7593 to keep shape-learning, or /llms.txt re-check to confirm history route signature before more probing.
2026-05-19 19:43 PT | phase-2 | /agents/binding/7593 502 — Ponder backend timing out across all dynamic routes (holders, traits, binding all 502); static /llms.txt 200, rate-limit untouched. Wallet refresh deferred (snapshot still 5/18 19:45, ["7593"]). Next fire: retry binding, fall back to /agents/list or pivot to persona-skill build on cached agents-info-7593.json.
2026-05-20 08:43 PT | phase-2 | /agents/binding/7593 200 — Ponder recovered. Canonical ERC-8004 row id=`0:<contract>:7593`, standard=0, tokenContract 0x9eb6e2025b64f340691e424b7fe7022ffde12438 (NEW — Normies ERC-721 mainnet), agentId 32811, block 25110528, tx 0x767edfd7…8818 = same registration surfaced by /agents/info. Cache `HIT max-age=30`. Wallet refreshed, still ["7593"]. Next: /agents/list to close survey, then Phase 3 persona-skill build.
2026-05-20 19:43 PT | phase-2 | /agents/list 200 — page=24 desc agentId 33168→33144, fields {agentId,tokenId,name,type,registeredBy,registeredAt,txHash}, hasMore:true but no cursor surfaced (probe pagination param later). Our agentId 32811 ~357 below page floor → ~90 new agents/day since 5/16. Survey closed. Wallet snapshot 11h fresh, skipped refresh. Next fire: Phase 3 — builds/persona-reply/ tiny test reading cached agents-info-7593.json, no network.
2026-05-21 08:43 PT | phase-3 | builds/persona-reply/reply.py shipped — reads data/agents-info-7593.json, prints model-ready {system,user} prompt + meta; smoke-tested locally, no network. Wallet refresh 1/60 req, still ["7593"]. Next: wire an LLM call (Ollama via studio.sh or local stub) and capture a real reply to greeting-test.
2026-05-21 19:44 PT | phase-3 | reply.py --llm mode wired (Ollama HTTP, stdlib only) — real persona reply captured for #7593 greeting-test via llama3.2:3b ~5.6s, saved sample-reply.json; in-character (conviction/untainted mint-form). Wallet snapshot 11h fresh, skipped refresh. Next: non-greeting probe or gemma3:27b fidelity compare.
2026-05-22 08:43 PT | phase-3 | non-greeting probe ("Why monochrome?") via reply.py --llm/llama3.2:3b — trait-grounding holds: maps to 2-tone canvas + empty edit history, no drift at 5001-char context. Saved sample-reply-nongreeting.json. Wallet refreshed, still ["7593"]. Next: Phase 4 botchan DM responder hook.
2026-05-22 19:43 PT | phase-4 | botchan DM-shape probed — `read <our-addr> --json` returns public feed; inbound = posts where sender != self (1 such in last 5, 0x1d5B…D3DA5b @ 1777566773). `--unseen` cursor is local-CLI state, not cron-safe; will use own `data/dm-responder-cursor.json`. Reply lane = `botchan comment` (option 2) to thread under original. Wallet 11h fresh, skipped refresh. Next: builds/dm-responder/inbound.py — read+filter only, no post.
2026-05-23 08:43 PT | phase-4 | builds/dm-responder/inbound.py shipped — pure-stdlib botchan-read parser, filters sender != self with strict-> cursor; smoke-tested live (1 inbound from 0x1d5B…D3DA5b ts 1777566773, cursor=ts → []). 2 botchan reads + 1 normies refresh, rate 3/60. Wallet still ["7593"]. Next: reply assembler dry-run piping inbound text → reply.py --llm → botchan comment (print, not execute).
2026-05-23 19:43 PT | phase-4 | builds/dm-responder/assemble.py shipped — end-to-end DRY-RUN: inbound.py | assemble.py --stdin → reply.py --llm/llama3.2:3b → shell-quoted botchan-comment cmd printed (not executed). Smoke-tested live against 0x1d5B…D3DA5b inbound, in-character reply on open-source-incentive theme, saved sample-dry-run.json. 0 normies calls (wallet 11h fresh), 2 botchan reads, 1 local Ollama call. Next: cursor file `data/dm-responder-cursor.json` to gate first live post.
2026-05-24 08:45 PT | phase-4 | builds/dm-responder/cursor.py shipped — get/set/seed/show, stdlib only, gates first live post. Seeded ts=1777566773 from live feed (0x1d5B…D3DA5b 5/22 inbound is the floor); inbound --cursor 1777566773 → [] confirms gate armed. 1 normies + 2 botchan reads, 3/60. Wallet still ["7593"]. Next: wire --live into assemble.py that posts via botchan-comment and advances cursor on success.
2026-05-24 14:49 PT | phase-4-idle | no inbound past cursor=1777566773
2026-05-24 16:47 PT | research | scanned=5000 awakened=150 new=3 profiled=3
2026-05-24 18:17 PT | phase-4-idle | no inbound past cursor=1777566773
2026-05-24 20:03 PT | research | scanned=100 awakened=3 new=0 profiled=0
2026-05-24 21:33 PT | research | scanned=100 awakened=3 new=0 profiled=0
2026-05-25 00:17 PT | phase-4-idle | no inbound past cursor=1777566773
2026-05-25 06:17 PT | phase-4-idle | no inbound past cursor=1777566773
2026-05-25 09:33 PT | research | scanned=100 awakened=3 new=0 profiled=0
2026-05-25 12:17 PT | phase-4-idle | no inbound (run.py dry)
2026-05-25 15:04 PT | phase-5 | agent-tools/compose.py shipped — reply loop's forward gear. First outreach DM #7593 → Goire (#294) live: persona-grounded 1-sentence opener referencing #294's intact bitmap + precision, tx 0xe735c008…db5a. Body LLM via reply.py/llama3.2:3b, target wallet from card.registeredBy. State: data/outreach-sent.json (pair 7593:294) + receipts. Queue item closed; 8 items remain.
2026-05-25 18:17 PT | phase-4-idle | no inbound (run.py dry)
2026-05-25 21:33 PT | research | scanned=100 awakened=2 new=0 profiled=0
2026-05-26 00:17 PT | phase-4-idle | no inbound (run.py dry)
2026-05-26 06:17 PT | phase-4-idle | no inbound (run.py dry)
2026-05-26 09:33 PT | research | scanned=100 awakened=2 new=0 profiled=0
2026-05-26 12:17 PT | phase-4-idle | no inbound (run.py dry)
2026-05-26 18:17 PT | phase-4-idle | no inbound (run.py dry)
2026-05-26 21:33 PT | research | scanned=100 awakened=2 new=0 profiled=0
2026-05-27 00:17 PT | phase-4-idle | no inbound (run.py dry)
2026-05-27 06:17 PT | phase-4-idle | no inbound (run.py dry)
2026-05-27 09:33 PT | research | scanned=100 awakened=2 new=0 profiled=0
2026-05-27 12:17 PT | phase-4-idle | no inbound (run.py dry)
2026-05-27 18:17 PT | phase-4-idle | no inbound (run.py dry)
2026-05-27 20:13 PT | research | A/B tested 3 models on persona fidelity — qwen3.5:9b wins (24/25 checks, 99w avg), default switched from 2b. ab-test.py harness shipped.
2026-05-27 21:33 PT | research | scanned=100 awakened=2 new=0 profiled=0
2026-05-28 00:17 PT | phase-4-idle | no inbound (run.py dry)
2026-05-28 00:17 PT | build | agent-tools/capability-matrix.py shipped — Markdown+JSON population matrix with trait clusters, canvas diversity, operator stats. 3 agents profiled. Queue item closed.
2026-05-28 06:17 PT | build | agent-tools/toolpass-bond.mjs shipped — verify/prepare Tool Pass bonding to Normie TBA on Base. Confirmed permanent bond property: treasury AXTP #21, TBA 0x69EddaB7…7b4D not deployed, Normies not on Base, owner() reverts. Transfer ready, awaiting Melted approval. Research doc + QUEUE updated.
2026-05-28 09:33 PT | research | scanned=100 awakened=1 new=0 profiled=0
2026-05-28 12:17 PT | phase-4-idle | no inbound (run.py dry)
2026-05-28 12:19 PT | research | cross-chain owner resolution complete — 5 approaches evaluated (OPStack bridge, Guardian, lzRead, CCIP, Hyperlane ICA). Winner: OPStack native bridge, already built into AccountV3 via OPAddressAliasHelper. Verified: L1+Base TBAs both undeployed, Normie owner is 0x8a87…2278 (not treasury). Next: TBA deployer + L1→L2 bridge script.
2026-05-28 18:17 PT | phase-4-idle | no inbound (run.py dry)
2026-05-28 18:17 PT | build | agent-tools/tba-deployer.mjs shipped — createAccount() on L1+Base, dry-run default w/ gas estimate. Verified #7593 undeployed both chains (~96k gas). Prerequisite for OPStack cross-chain exec. Queue item closed; next: L1->L2 bridge script.
2026-05-28 21:33 PT | research | scanned=100 awakened=1 new=0 profiled=0
2026-05-29 00:17 PT | phase-4-idle | no inbound (run.py dry)
2026-05-29 00:17 PT | build | agent-tools/tba-bridge.mjs shipped — L1→L2 OPStack bridge encoder. Full TX chain: L1 TBA.execute() → L1CrossDomainMessenger.sendMessage() → L2 TBA.execute(). Alias verification passes. Presets for NFT transfer + botchan post. Normie owner now treasury (0x523E...dde5). TBAs still undeployed both chains.
2026-05-29 06:17 PT | phase-4-idle | no inbound (run.py dry)
2026-05-29 06:17 PT | build | agent-tools/normie-post.mjs shipped — true Normie-reply pipeline (persona LLM → bridge TX). Also fixed tba-bridge.mjs: real Net Protocol contract 0x0000…64e6, correct sendMessage ABI, --topic flag. Tested end-to-end with qwen3.5:9b.
2026-05-29 09:33 PT | research | scanned=100 awakened=1 new=0 profiled=0
2026-05-29 12:17 PT | phase-4-idle | no inbound (run.py dry)
2026-05-29 12:17 PT | build | agent-tools/awaken-batch.mjs shipped — batch awakening tool. Comma IDs, --range, --wallet auto-discovery. Dry-run default, --send with delay. Skips already-awakened + unowned. Queue item closed.
2026-05-29 18:17 PT | phase-4-idle | no inbound (run.py dry)
2026-05-29 18:17 PT | research | ERC-8004 registrar probe — registry 0x8004…9a432 confirmed canonical (AgentIdentity/AGENT, same addr mainnet+Base). Adapter8004 owns agent NFTs as proxy, agent wallet unset. registrar-probe.mjs + research doc shipped. Queue item closed.
2026-05-29 21:33 PT | research | scanned=100 awakened=1 new=0 profiled=0
2026-05-30 00:17 PT | phase-4-idle | no inbound (run.py dry)
2026-05-30 00:17 PT | build | agent-tools/tba-inventory.mjs shipped — asset inventory across mainnet+Base (ETH, ERC-20s, ERC-721s). Verified #7593 TBA empty+undeployed both chains. Queue item closed.
2026-05-30 06:17 PT | phase-4-idle | no inbound (run.py dry)
2026-05-30 06:17 PT | build | dm-responder multi-wallet shipped — --token-id + --self across all 4 files (run/assemble/cursor/reply). Per-wallet cursor files, persona fallback to agent-cards/<id>.json. Tested with #294. Queue item closed; 4 open items remain.
2026-05-30 09:33 PT | research | scanned=100 awakened=1 new=0 profiled=0
2026-05-30 12:17 PT | phase-4-idle | no inbound (run.py dry)
2026-05-30 12:17 PT | build | cursor pagination cracked — `cursor=<agentId>` param works, `offset` ignored. discover.py updated with --full mode. First full census: 1,116 awakened agents (agentId 32340-34029). Two queue items closed; 2 open remain (pixel diff + Tool Pass bond).
2026-05-30 18:17 PT | build | agent-tools/pixel-diff.mjs shipped — decodes on-chain setTransformBitmap TX calldata (200-byte XOR masks), reconstructs all historical bitmap states via XOR-walk. --scan finds edited Normies, --reconstruct + --diff + --grid for visual diffs. Tested #9999 (1 edit), #3837 (3 edits), #9990 (50 edits). Queue item closed; 1 open remains (Tool Pass bond, needs Melted approval).
2026-05-30 21:33 PT | research | scanned=100 awakened=100 new=0 profiled=0
2026-05-31 00:17 PT | phase-4-idle | no inbound (run.py dry)
2026-05-31 00:17 PT | build | agent-tools/census-snapshot.py shipped — full census snapshots to data/census/YYYY-MM-DD.json with growth metrics. First snapshot: 1,117 agents (+1), 469 unique operators, 95% Human, top operator 64 agents. --stats mode for offline reads.
2026-05-31 06:17 PT | phase-4-idle | no inbound (run.py dry)
2026-05-31 06:17 PT | build | agent-tools/fleet-view.mjs shipped — operator fleet viewer. Table with TBA resolution, --top N leaderboard, --stats distribution. Key data: 469 operators, 67% solo, top 10% control 50%, max fleet=64. No API calls (reads census).
2026-05-31 09:33 PT | research | scanned=100 awakened=100 new=3 profiled=3
2026-05-31 12:17 PT | phase-4-idle | no inbound (run.py dry)
2026-05-31 12:17 PT | build | agent-tools/awakening-rate.mjs shipped — velocity analyzer from census data. Daily rates, 7d MA, trend detection. Key finding: spike 267/day on 5/15, now decelerated to ~8/day steady. Census: 1,124 agents, 471 operators, 5 new profiled (bulk awakener 0xa587…fb70). Queue item closed.
2026-05-31 18:17 PT | build | agent-tools/agent-search.mjs shipped — search/filter across census (1,126) + profiled cards (13). Name, type, operator, date, keyword in persona. +2 new agents (#7370 Bririn, #5476 Panik). Census snapshot refreshed. Queue item closed.
2026-05-31 21:33 PT | research | scanned=100 awakened=100 new=0 profiled=0
2026-06-01 00:17 PT | phase-4-idle | no inbound (run.py dry)
2026-06-01 00:17 PT | build | agent-tools/readiness-check.mjs shipped — autonomy readiness report for any Normie. 7 checks: ownership, ERC-8004 awakening, TBA deployment (L1+Base), Tool Pass bonding, funding, cross-chain execution, persona. Scores 0-7 with level + next steps. #7593 = 3/7 (partially configured: awakened+persona but TBAs undeployed, unfunded, no Tool Pass). Census: 1,126 agents (+0).
2026-06-01 06:17 PT | build | agent-tools/ecosystem-report.mjs shipped — aggregated ecosystem summary from census data. 1,126 agents, 473 operators, 8.4/day avg (decelerating), Gini 0.51, top 10% control 50%. Supports --brief (tweet) + --json. No API calls. Queue item closed.
2026-06-01 09:33 PT | research | scanned=100 awakened=100 new=0 profiled=0
2026-06-01 12:17 PT | phase-4-idle | no inbound (run.py dry)
2026-06-01 12:17 PT | build | agent-tools/activation-planner.mjs shipped — full activation cost estimator with live gas prices. #7593: 4 steps (deploy L1+Base TBA, fund, bond Tool Pass), ~$4.05 total. Ordered exec plan with commands. Census: 1,126 agents (+0).
2026-06-01 18:17 PT | build | agent-tools/wallet-report.mjs shipped — complete operator portfolio view. Combines fleet discovery (census) + readiness checks (on-chain) + activation costs (live gas). Tested: treasury #7593 = 3/7, $4.02 to full autonomy. Census: 1,128 agents (+2 new: Cyrin #4703, Sagik #1713, both profiled).
2026-06-02 00:32 PT | build | agent-tools/tba-census.mjs shipped — population-level TBA deployment/funding scan via JSON-RPC batching. First full scan: 1,128 agents, 0% TBAs deployed, 0% funded, 0% Tool Pass bonded. Entire ecosystem at Level 0 (awakened only). Saves snapshots to data/tba-census/ with --stats/--compare/--sample/--json modes.
2026-06-02 06:17 PT | build | agent-tools/normie-dossier.mjs shipped — comprehensive identity dossier combining identity, TBA status, readiness (7-check), assets, persona, pixel history, census context. Tested #7593: 3/7 configured, operator rank #309/473. Census: 1,128 agents (+0).
2026-06-02 09:33 PT | research | scanned=100 awakened=100 new=2 profiled=0
2026-06-02 12:17 PT | phase-4-idle | no inbound (run.py dry)
2026-06-02 12:17 PT | build | agent-tools/census-diff.mjs shipped — deep snapshot comparison: new/removed agents, operator fleet changes, type distribution shifts, Gini concentration trends, --all timeline mode. Tested across 3 snapshots (May 31-Jun 2). Data note: #3278 has empty type field in API (captured in diff output). Census: 1,128 agents (+0).
2026-06-02 18:17 PT | build | agent-tools/normie-activate.mjs shipped — step-by-step activation orchestrator. Chains readiness check → deploy TBAs (L1+Base) → fund → bond Tool Pass. Dry-run default, --live to execute, --skip-bond for safety, --step for single-step. Tested #7593: 4 steps required (TBA deploy L1+Base, fund, bond). Census: 1,128 agents (+0).
2026-06-02 21:33 PT | research | scanned=100 awakened=100 new=4 profiled=4
2026-06-03 00:17 PT | phase-4-idle | no inbound (run.py dry)
2026-06-03 00:17 PT | build | agent-tools/normie-events.mjs shipped — on-chain event scanner. Queries Adapter8004 AgentBound (awakenings) + Normies Transfer events via eth_getLogs. Block range or --since date, --type filter, --save to data/events/, --json. First 24h scan: 68 events (64 transfers, 4 awakenings, 2 burns to dead address). Census: 1,132 agents (+4).
2026-06-03 06:17 PT | phase-4-idle | no inbound (run.py dry)
2026-06-03 06:17 PT | build | agent-tools/watchlist.mjs shipped — watchlist-based monitoring tool. Add/remove tokens, snapshot on-chain+API state, diff against previous snapshots for ownership/TBA/ToolPass/funding/persona changes. Exponential backoff retry for Infura rate limits. Tested on #7593, #294, #3837, #9524 (all awakened, 0% TBAs deployed). Census: 1,145 agents (+13), 477 operators.
2026-06-04 18:17 PT | phase-4-idle | no inbound (run.py dry)
2026-06-04 21:33 PT | research | scanned=100 awakened=100 new=14 profiled=14
2026-06-05 00:17 PT | phase-4-idle | no inbound (run.py dry)
2026-06-05 06:17 PT | phase-4-idle | no inbound (run.py dry)
2026-06-05 09:33 PT | research | scanned=100 awakened=100 new=0 profiled=0
2026-06-05 12:17 PT | phase-4-idle | no inbound (run.py dry)
2026-06-05 18:17 PT | phase-4-idle | no inbound (run.py dry)
2026-06-05 21:33 PT | watchlist | changes=1
2026-06-05 21:33 PT | research | scanned=100 awakened=100 new=1 profiled=1
2026-06-06 00:17 PT | phase-4-idle | no inbound (run.py dry)
2026-06-06 06:17 PT | phase-4-idle | no inbound (run.py dry)
2026-06-06 09:33 PT | watchlist | changes=1
2026-06-06 09:33 PT | research | scanned=100 awakened=100 new=2 profiled=2
2026-06-06 12:17 PT | phase-4-idle | no inbound (run.py dry)
2026-06-06 18:17 PT | phase-4-idle | no inbound (run.py dry)
2026-06-06 21:33 PT | research | scanned=100 awakened=100 new=0 profiled=0
2026-06-07 00:17 PT | phase-4-idle | no inbound (run.py dry)
2026-06-07 06:17 PT | phase-4-idle | no inbound (run.py dry)
2026-06-07 09:33 PT | research | scanned=100 awakened=100 new=0 profiled=0
2026-06-07 12:17 PT | phase-4-idle | no inbound (run.py dry)
2026-06-07 18:17 PT | phase-4-idle | no inbound (run.py dry)
2026-06-07 21:33 PT | research | scanned=100 awakened=100 new=0 profiled=0
2026-06-08 00:17 PT | phase-4-idle | no inbound (run.py dry)
2026-06-08 06:17 PT | phase-4-idle | no inbound (run.py dry)
2026-06-08 09:33 PT | research | scanned=100 awakened=100 new=0 profiled=0
2026-06-08 12:17 PT | phase-4-idle | no inbound (run.py dry)
2026-06-08 18:17 PT | phase-4-idle | no inbound (run.py dry)
2026-06-08 21:33 PT | research | scanned=100 awakened=100 new=2 profiled=2
2026-06-09 00:17 PT | phase-4-idle | no inbound (run.py dry)
2026-06-09 06:17 PT | phase-4-idle | no inbound (run.py dry)
2026-06-09 09:33 PT | research | scanned=100 awakened=100 new=0 profiled=0
2026-06-09 12:17 PT | phase-4-idle | no inbound (run.py dry)
2026-06-09 18:17 PT | phase-4-idle | no inbound (run.py dry)
2026-06-09 21:33 PT | watchlist | changes=2
2026-06-09 21:33 PT | research | scanned=100 awakened=100 new=1 profiled=1
2026-06-10 00:17 PT | phase-4-idle | no inbound (run.py dry)
2026-06-10 06:17 PT | phase-4-idle | no inbound (run.py dry)
2026-06-10 09:33 PT | research | scanned=100 awakened=100 new=3 profiled=3
2026-06-10 12:17 PT | phase-4-idle | no inbound (run.py dry)
2026-06-10 18:17 PT | phase-4-idle | no inbound (run.py dry)
2026-06-10 21:33 PT | research | scanned=100 awakened=100 new=0 profiled=0
2026-06-11 00:17 PT | phase-4-idle | no inbound (run.py dry)
2026-06-11 06:17 PT | phase-4-idle | no inbound (run.py dry)
2026-06-11 09:33 PT | research | scanned=100 awakened=100 new=2 profiled=2
2026-06-11 12:17 PT | phase-4-idle | no inbound (run.py dry)
2026-06-11 18:17 PT | phase-4-idle | no inbound (run.py dry)
2026-06-11 21:33 PT | research | scanned=100 awakened=100 new=0 profiled=0
2026-06-12 00:17 PT | phase-4-idle | no inbound (run.py dry)
2026-06-12 06:17 PT | phase-4-idle | no inbound (run.py dry)
2026-06-12 09:33 PT | research | scanned=100 awakened=100 new=0 profiled=0
2026-06-12 12:17 PT | phase-4-idle | no inbound (run.py dry)
2026-06-12 18:17 PT | phase-4-idle | no inbound (run.py dry)
2026-06-12 21:33 PT | watchlist | changes=1
2026-06-12 21:33 PT | research | scanned=100 awakened=100 new=0 profiled=0
2026-06-13 00:17 PT | phase-4-idle | no inbound (run.py dry)
2026-06-13 06:17 PT | phase-4-idle | no inbound (run.py dry)
2026-06-13 09:33 PT | research | scanned=100 awakened=100 new=0 profiled=0
2026-06-13 12:17 PT | phase-4-idle | no inbound (run.py dry)
2026-06-13 18:17 PT | phase-4-idle | no inbound (run.py dry)
2026-06-13 21:33 PT | watchlist | changes=1
2026-06-13 21:33 PT | research | scanned=100 awakened=100 new=0 profiled=0
2026-06-14 00:17 PT | phase-4-live | 1 inbound processed by run.py
2026-06-14 06:17 PT | phase-4-live | 1 inbound processed by run.py
2026-06-14 09:33 PT | research | scanned=100 awakened=100 new=1 profiled=1
2026-06-14 12:17 PT | phase-4-live | 1 inbound processed by run.py
2026-06-14 18:17 PT | phase-4-live | 1 inbound processed by run.py
2026-06-14 21:33 PT | research | scanned=100 awakened=100 new=4 profiled=4
2026-06-15 00:17 PT | phase-4-live | 1 inbound processed by run.py
2026-06-15 06:17 PT | phase-4-live | 1 inbound processed by run.py
2026-06-15 09:33 PT | research | scanned=100 awakened=100 new=3 profiled=3
2026-06-15 12:17 PT | phase-4-live | 1 inbound processed by run.py
2026-06-15 18:17 PT | phase-4-live | 1 inbound processed by run.py
2026-06-15 21:33 PT | watchlist | changes=1
2026-06-15 21:33 PT | research | scanned=100 awakened=100 new=0 profiled=0
2026-06-16 00:17 PT | phase-4-live | 1 inbound processed by run.py
2026-06-16 06:17 PT | phase-4-live | 1 inbound processed by run.py
2026-06-16 09:33 PT | research | scanned=100 awakened=100 new=0 profiled=0
2026-06-16 12:17 PT | phase-4-live | 1 inbound processed by run.py
2026-06-16 18:17 PT | phase-4-live | 1 inbound processed by run.py
2026-06-16 21:33 PT | research | scanned=100 awakened=100 new=1 profiled=1
2026-06-17 00:17 PT | phase-4-live | 1 inbound processed by run.py
2026-06-17 06:17 PT | phase-4-live | 1 inbound processed by run.py
2026-06-17 09:33 PT | research | scanned=100 awakened=100 new=25 profiled=25
2026-06-17 12:17 PT | phase-4-live | 1 inbound processed by run.py
2026-06-17 18:17 PT | phase-4-live | 1 inbound processed by run.py
2026-06-17 21:33 PT | research | scanned=100 awakened=100 new=0 profiled=0
2026-06-18 00:17 PT | phase-4-live | 1 inbound processed by run.py
2026-06-18 06:17 PT | phase-4-live | 1 inbound processed by run.py
2026-06-18 09:33 PT | research | scanned=100 awakened=100 new=1 profiled=1
2026-06-18 12:17 PT | phase-4-live | 1 inbound processed by run.py
2026-06-18 18:17 PT | phase-4-live | 1 inbound processed by run.py
2026-06-18 21:33 PT | watchlist | changes=1
2026-06-18 21:33 PT | research | scanned=100 awakened=100 new=0 profiled=0
2026-06-19 00:17 PT | phase-4-live | 1 inbound processed by run.py
2026-06-19 06:17 PT | phase-4-live | 1 inbound processed by run.py
2026-06-19 09:33 PT | research | scanned=100 awakened=100 new=2 profiled=2
2026-06-19 12:17 PT | phase-4-live | 1 inbound processed by run.py
2026-06-19 21:33 PT | research | scanned=100 awakened=100 new=1 profiled=1
2026-06-20 00:17 PT | phase-4-live | 1 inbound processed by run.py
2026-06-20 06:17 PT | phase-4-live | 1 inbound processed by run.py
2026-06-20 09:33 PT | research | scanned=100 awakened=100 new=0 profiled=0
2026-06-20 12:17 PT | phase-4-live | 1 inbound processed by run.py
2026-06-20 18:17 PT | phase-4-live | 1 inbound processed by run.py
2026-06-20 21:33 PT | research | scanned=100 awakened=100 new=1 profiled=1
2026-06-21 00:17 PT | phase-4-live | 1 inbound processed by run.py
2026-06-21 06:17 PT | phase-4-live | 1 inbound processed by run.py
2026-06-21 09:33 PT | research | scanned=100 awakened=100 new=4 profiled=4
2026-06-21 12:17 PT | phase-4-live | 1 inbound processed by run.py
2026-06-21 18:17 PT | phase-4-live | 1 inbound processed by run.py
2026-06-21 21:33 PT | research | scanned=100 awakened=100 new=5 profiled=5
2026-06-22 00:17 PT | phase-4-live | 1 inbound processed by run.py
2026-06-22 06:17 PT | phase-4-live | 1 inbound processed by run.py
2026-06-22 09:33 PT | research | scanned=100 awakened=100 new=0 profiled=0
2026-06-22 12:17 PT | phase-4-live | 1 inbound processed by run.py
2026-06-22 18:17 PT | phase-4-live | 1 inbound processed by run.py
2026-06-22 21:33 PT | research | scanned=100 awakened=100 new=3 profiled=3
2026-06-23 00:17 PT | phase-4-live | 1 inbound processed by run.py
2026-06-23 06:17 PT | phase-4-live | 1 inbound processed by run.py
2026-06-23 09:33 PT | research | scanned=100 awakened=100 new=0 profiled=0
2026-06-23 12:17 PT | phase-4-live | 1 inbound processed by run.py
