#!/usr/bin/env node
/**
 * normie-post.mjs — True Normie-reply pipeline.
 *
 * Generates a persona-grounded reply via local LLM, then encodes it as
 * an L1→L2 bridge transaction so the Normie's own TBA posts on-chain
 * via Net Protocol (botchan). No more treasury-impersonation.
 *
 * Pipeline: prompt → reply.py --llm → tba-bridge encoder → cast command
 *
 * Usage:
 *   # Generate a persona reply and encode as bridge TX (general feed)
 *   node normie-post.mjs 7593 "Why do you exist?"
 *
 *   # Post to a specific feed
 *   node normie-post.mjs 7593 "GM agents" --topic ai-agents
 *
 *   # Reply to a DM (post to sender's address feed)
 *   node normie-post.mjs 7593 "Thanks for the message" --topic 0x1d5B...D3DA5b
 *
 *   # Skip LLM — use a pre-written message
 *   node normie-post.mjs 7593 --raw "Hello from Normie #7593"
 *
 *   # Check bridge prerequisites first
 *   node normie-post.mjs 7593 --check
 *
 * Output: JSON with persona reply + full bridge TX + cast command.
 * Dry-run only — the Normie owner must sign and broadcast.
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { encodeBridgeCall, checkPrereqs } from "./tba-bridge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPLY_PY = path.resolve(__dirname, "..", "persona-reply", "reply.py");

// Net Protocol contract on Base
const NET_PROTOCOL_ADDRESS = "0x00000000B24D62781dB359b07880a105cD0b64e6";
const NET_PROTOCOL_ABI_FRAGMENT = [
  "function sendMessage(string text, string topic, bytes data) external",
];

import { ethers } from "ethers";

function encodeBotchanPost(content, topic = "general") {
  const iface = new ethers.Interface(NET_PROTOCOL_ABI_FRAGMENT);
  return iface.encodeFunctionData("sendMessage", [content, topic, "0x"]);
}

/**
 * Call reply.py --llm with the given prompt. Returns parsed JSON output.
 */
function generateReply(prompt) {
  const stdout = execFileSync("python3", [REPLY_PY, "--llm", prompt], {
    encoding: "utf-8",
    timeout: 200_000,
  });
  return JSON.parse(stdout.trim());
}


async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help")) {
    console.log(`Usage:
  node normie-post.mjs <tokenId> "prompt for persona reply" [--topic <feed>]
  node normie-post.mjs <tokenId> --raw "pre-written message" [--topic <feed>]
  node normie-post.mjs <tokenId> --check

Options:
  --topic <feed>    Net Protocol topic/feed name (default: "general")
  --raw <message>   Skip LLM, use this exact message
  --check           Check bridge deployment prerequisites
  --json            Output only JSON (suppress stderr)`);
    process.exit(0);
  }

  const tokenId = parseInt(args.find(a => !a.startsWith("-")));
  if (isNaN(tokenId)) {
    console.error("Invalid tokenId.");
    process.exit(1);
  }

  const quiet = args.includes("--json");
  const log = quiet ? () => {} : (...a) => console.error("[normie-post]", ...a);

  // --check mode
  if (args.includes("--check")) {
    const result = await checkPrereqs(tokenId);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Parse topic
  const topicIdx = args.indexOf("--topic");
  const topic = topicIdx >= 0 ? args[topicIdx + 1] : "general";

  // Determine message content
  let messageText;
  let persona = null;

  if (args.includes("--raw")) {
    const rawIdx = args.indexOf("--raw");
    messageText = args[rawIdx + 1];
    if (!messageText) { console.error("--raw requires a message"); process.exit(1); }
    log(`Using raw message: "${messageText}"`);
  } else {
    // Find prompt (first non-flag, non-tokenId argument)
    const flagArgs = new Set(["--topic", "--raw", "--check", "--json", "--help"]);
    const prompt = args.find((a, i) => {
      if (a.startsWith("-")) return false;
      if (parseInt(a) === tokenId && i === args.indexOf(a)) return false;
      // Skip values that follow flag args
      if (i > 0 && flagArgs.has(args[i - 1])) return false;
      return true;
    }) || "Introduce yourself in one sentence.";

    log(`Generating persona reply for #${tokenId}: "${prompt}"`);
    persona = generateReply(prompt);
    messageText = persona.reply;
    log(`Reply (${messageText.length} chars): "${messageText.substring(0, 80)}${messageText.length > 80 ? "..." : ""}"`);
  }

  // Encode as bridge TX
  const data = encodeBotchanPost(messageText, topic);
  const bridgeResult = encodeBridgeCall(tokenId, {
    to: NET_PROTOCOL_ADDRESS,
    data,
  });

  const output = {
    tokenId,
    topic,
    message: messageText,
    persona: persona ? {
      name: persona.meta.name,
      model: persona.model,
      question: persona.question,
    } : null,
    bridge: {
      tba: bridgeResult.tba,
      l1Transaction: bridgeResult.l1Transaction,
      l2Action: {
        contract: NET_PROTOCOL_ADDRESS,
        function: "sendMessage(string,string,bytes)",
        args: { text: messageText, topic, data: "0x" },
      },
      aliasMatch: bridgeResult.aliasVerification.match,
      castCommand: bridgeResult.castCommand,
    },
    note: "DRY-RUN: Normie owner must sign the L1 transaction. TBAs must be deployed first (see tba-deployer.mjs).",
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch(e => { console.error(e.message); process.exit(1); });
