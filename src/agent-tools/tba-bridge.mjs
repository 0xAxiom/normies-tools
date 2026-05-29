#!/usr/bin/env node
/**
 * tba-bridge.mjs — L1→L2 cross-chain execution for Normie TBAs via OPStack bridge.
 *
 * Normie TBAs on Base can't call execute() because owner() reverts (Normies
 * contract is mainnet-only). But AccountV3 already supports OPStack cross-chain
 * execution: if `undoL1ToL2Alias(msg.sender) == address(this)`, the call is
 * authorized. This means the L1 TBA can send messages to the L2 TBA via the
 * native L1CrossDomainMessenger.
 *
 * Flow:
 *   1. Normie owner calls L1 TBA.execute() with:
 *      target = L1CrossDomainMessenger
 *      data = sendMessage(L2_TBA, L2_execute_calldata, gasLimit)
 *   2. OPStack bridge delivers the message on Base with aliased sender
 *   3. L2 TBA checks: undoL1ToL2Alias(msg.sender) == address(this) → TRUE
 *   4. L2 action executes
 *
 * Usage:
 *   # Encode a raw L2 call (dry-run, prints full TX chain)
 *   node tba-bridge.mjs 7593 --to 0xTargetOnBase --data 0xcalldata
 *
 *   # Encode an ERC-721 transfer on Base (Tool Pass bonding)
 *   node tba-bridge.mjs 7593 --transfer-nft 0xNFTContract --token-id 21 --recipient 0xTo
 *
 *   # Encode a Net Protocol post (botchan)
 *   node tba-bridge.mjs 7593 --botchan-post "Hello from Normie #7593"
 *
 *   # Check deployment prerequisites
 *   node tba-bridge.mjs 7593 --check
 *
 *   # Include gas estimation (requires L1 RPC)
 *   node tba-bridge.mjs 7593 --to 0xTarget --data 0x --estimate-gas
 */

import { ethers } from "ethers";
import { computeTBA } from "./tba-resolver.mjs";
import { loadEnv, getProvider } from "../../skills/awaken-normie/scripts/lib.mjs";

// --- Constants ---
const ACCOUNT_V3_IMPL = "0x55266d75D1a14E4572138116aF39863Ed6596E7F";
const NORMIES_CONTRACT = "0x9Eb6E2025B64f340691e424b7fe7022fFDE12438";
const NORMIES_CHAIN_ID = 1;
const ERC6551_REGISTRY = "0x000000006551c19487814612e58FE06813775758";

// Base OPStack bridge contracts
const L1_CROSS_DOMAIN_MESSENGER = "0x866E82a600A1414e583f7F13623F1aC5d58b0Afa";
const L2_CROSS_DOMAIN_MESSENGER = "0x4200000000000000000000000000000000000007";

// OPStack address alias offset
const L1_TO_L2_ALIAS_OFFSET = "0x1111000000000000000000000000000000001111";

// Default L2 gas limit for cross-chain messages
const DEFAULT_L2_GAS_LIMIT = 200_000;

// ABIs
const ACCOUNT_V3_ABI = [
  "function execute(address to, uint256 value, bytes calldata data, uint8 operation) external payable returns (bytes)",
  "function owner() view returns (address)",
  "function token() view returns (uint256 chainId, address tokenContract, uint256 tokenId)",
  "function state() view returns (uint256)",
];

const L1_MESSENGER_ABI = [
  "function sendMessage(address _target, bytes calldata _message, uint32 _minGasLimit) external payable",
];

const ERC721_ABI = [
  "function safeTransferFrom(address from, address to, uint256 tokenId)",
  "function transferFrom(address from, address to, uint256 tokenId)",
];

// Net Protocol ABI (botchan post)
const NET_PROTOCOL_ABI = [
  "function post(bytes32 channel, string calldata content) external",
];
const NET_GENERAL_CHANNEL = ethers.zeroPadValue("0x01", 32); // general channel


/**
 * Compute the L1→L2 aliased address for a given L1 sender.
 * On OPStack, when an L1 contract sends a message to L2, the msg.sender
 * on L2 is: l1Address + 0x1111000000000000000000000000000000001111
 */
function applyL1ToL2Alias(l1Address) {
  const l1Big = BigInt(l1Address);
  const offset = BigInt(L1_TO_L2_ALIAS_OFFSET);
  // Modular arithmetic on 160-bit address space
  const aliased = (l1Big + offset) % (2n ** 160n);
  return ethers.getAddress("0x" + aliased.toString(16).padStart(40, "0"));
}

/**
 * Reverse the L1→L2 alias to recover the original L1 address.
 */
function undoL1ToL2Alias(l2Sender) {
  const l2Big = BigInt(l2Sender);
  const offset = BigInt(L1_TO_L2_ALIAS_OFFSET);
  const original = (l2Big - offset + 2n ** 160n) % (2n ** 160n);
  return ethers.getAddress("0x" + original.toString(16).padStart(40, "0"));
}

/**
 * Encode the full L1→L2 bridge transaction chain for a Normie TBA.
 *
 * Returns the nested calldata:
 *   L1 TBA.execute(L1Messenger, 0, sendMessage(L2_TBA, execute(target, value, data, 0), gasLimit), 0)
 */
function encodeBridgeCall(tokenId, { to, value = 0n, data = "0x", l2GasLimit = DEFAULT_L2_GAS_LIMIT }) {
  const tba = computeTBA(ACCOUNT_V3_IMPL, NORMIES_CHAIN_ID, NORMIES_CONTRACT, BigInt(tokenId), 0n);
  const accountIface = new ethers.Interface(ACCOUNT_V3_ABI);
  const messengerIface = new ethers.Interface(L1_MESSENGER_ABI);

  // Step 1: The action the L2 TBA should execute
  const l2ExecuteData = accountIface.encodeFunctionData("execute", [
    to,
    value,
    data,
    0, // operation = CALL
  ]);

  // Step 2: Wrap in L1CrossDomainMessenger.sendMessage targeting the L2 TBA
  const sendMessageData = messengerIface.encodeFunctionData("sendMessage", [
    tba,            // _target: the L2 TBA (same address as L1 TBA)
    l2ExecuteData,  // _message: the execute() call
    l2GasLimit,     // _minGasLimit
  ]);

  // Step 3: The L1 TBA calls L1CrossDomainMessenger
  const l1ExecuteData = accountIface.encodeFunctionData("execute", [
    L1_CROSS_DOMAIN_MESSENGER,
    0,              // no ETH value
    sendMessageData,
    0,              // operation = CALL
  ]);

  return {
    tba,
    l1Transaction: {
      to: tba,
      data: l1ExecuteData,
      value: "0",
      description: "Call L1 TBA.execute() → L1CrossDomainMessenger.sendMessage() → L2 TBA.execute()",
    },
    l2Action: {
      target: to,
      value: value.toString(),
      data,
      gasLimit: l2GasLimit,
    },
    aliasVerification: {
      l1TBA: tba,
      l2AliasedSender: applyL1ToL2Alias(tba),
      undoneAlias: undoL1ToL2Alias(applyL1ToL2Alias(tba)),
      match: undoL1ToL2Alias(applyL1ToL2Alias(tba)).toLowerCase() === tba.toLowerCase(),
    },
    castCommand: `cast send ${tba} "execute(address,uint256,bytes,uint8)" ${L1_CROSS_DOMAIN_MESSENGER} 0 ${sendMessageData} 0 --rpc-url mainnet --private-key <NORMIE_OWNER_KEY>`,
  };
}

/**
 * Check prerequisites for bridge execution.
 */
async function checkPrereqs(tokenId) {
  loadEnv();

  const tba = computeTBA(ACCOUNT_V3_IMPL, NORMIES_CHAIN_ID, NORMIES_CONTRACT, BigInt(tokenId), 0n);

  const results = {
    tokenId,
    tba,
    checks: {},
  };

  // Check L1 TBA deployment
  try {
    const l1Provider = getProvider("mainnet");
    const l1Code = await l1Provider.getCode(tba);
    results.checks.l1TbaDeployed = l1Code !== "0x";
  } catch (e) {
    results.checks.l1TbaDeployed = `ERROR: ${e.message}`;
  }

  // Check L2 TBA deployment
  try {
    const l2Provider = getProvider("base");
    const l2Code = await l2Provider.getCode(tba);
    results.checks.l2TbaDeployed = l2Code !== "0x";
  } catch (e) {
    results.checks.l2TbaDeployed = `ERROR: ${e.message}`;
  }

  // Check Normie owner on L1
  try {
    const l1Provider = getProvider("mainnet");
    const normies = new ethers.Contract(
      NORMIES_CONTRACT,
      ["function ownerOf(uint256) view returns (address)"],
      l1Provider
    );
    results.checks.normieOwner = await normies.ownerOf(BigInt(tokenId));
  } catch (e) {
    results.checks.normieOwner = `ERROR: ${e.message}`;
  }

  // Check L1 TBA owner (should match Normie owner if deployed)
  if (results.checks.l1TbaDeployed === true) {
    try {
      const l1Provider = getProvider("mainnet");
      const account = new ethers.Contract(tba, ACCOUNT_V3_ABI, l1Provider);
      results.checks.l1TbaOwner = await account.owner();
    } catch (e) {
      results.checks.l1TbaOwner = `ERROR: ${e.message}`;
    }
  } else {
    results.checks.l1TbaOwner = "N/A (TBA not deployed on L1)";
  }

  // Alias verification
  results.checks.aliasVerification = {
    l1TBA: tba,
    l2AliasedSender: applyL1ToL2Alias(tba),
    note: "On Base, msg.sender will be the aliased address. AccountV3 undoes this and checks == address(this).",
  };

  // Summary
  const l1OK = results.checks.l1TbaDeployed === true;
  const l2OK = results.checks.l2TbaDeployed === true;

  if (l1OK && l2OK) {
    results.status = "READY";
    results.message = "Both TBAs deployed. Bridge execution is possible.";
  } else {
    results.status = "NOT READY";
    const missing = [];
    if (!l1OK) missing.push("L1 TBA");
    if (!l2OK) missing.push("L2 TBA");
    results.message = `Deploy ${missing.join(" and ")} first using tba-deployer.mjs`;
  }

  return results;
}

/**
 * Estimate L1 gas for the bridge transaction.
 */
async function estimateGas(tokenId, { to, value = 0n, data = "0x", l2GasLimit = DEFAULT_L2_GAS_LIMIT }) {
  loadEnv();
  const encoded = encodeBridgeCall(tokenId, { to, value, data, l2GasLimit });
  const l1Provider = getProvider("mainnet");

  try {
    const gasEstimate = await l1Provider.estimateGas({
      to: encoded.l1Transaction.to,
      data: encoded.l1Transaction.data,
      value: 0n,
    });
    const feeData = await l1Provider.getFeeData();
    const gasPrice = feeData.gasPrice || feeData.maxFeePerGas || 0n;
    const costWei = gasEstimate * gasPrice;

    return {
      gasEstimate: gasEstimate.toString(),
      gasPrice: gasPrice.toString(),
      estimatedCostETH: ethers.formatEther(costWei),
      estimatedCostGwei: ethers.formatUnits(costWei, "gwei"),
    };
  } catch (e) {
    return {
      error: e.message,
      note: "Gas estimation failed — TBAs may not be deployed or Normie owner mismatch",
    };
  }
}


// --- Preset encoders for common L2 actions ---

/**
 * Encode an ERC-721 NFT transfer on L2 (e.g. Tool Pass bonding).
 * The L2 TBA calls transferFrom on behalf of itself.
 * Note: For transfers TO the TBA, the sender (treasury) does it directly.
 * This encodes the TBA sending an NFT it holds to someone else.
 */
function encodeNFTTransfer(nftContract, tokenIdNFT, recipient) {
  const iface = new ethers.Interface(ERC721_ABI);
  return iface.encodeFunctionData("transferFrom", [
    ethers.ZeroAddress, // placeholder — TBA address filled by execute context
    recipient,
    BigInt(tokenIdNFT),
  ]);
}

/**
 * Encode a Net Protocol post (botchan) from the L2 TBA.
 */
function encodeBotchanPost(content, channel = NET_GENERAL_CHANNEL) {
  const iface = new ethers.Interface(NET_PROTOCOL_ABI);
  return iface.encodeFunctionData("post", [channel, content]);
}


// --- CLI ---
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help")) {
    console.log(`Usage:
  node tba-bridge.mjs <tokenId> --check
    Check deployment prerequisites for bridge execution.

  node tba-bridge.mjs <tokenId> --to <address> --data <hex> [--value <wei>] [--l2-gas <limit>]
    Encode a raw L2 action as a full L1→L2 bridge TX chain.

  node tba-bridge.mjs <tokenId> --transfer-nft <contract> --nft-token-id <id> --recipient <addr>
    Encode an ERC-721 transfer from the L2 TBA.

  node tba-bridge.mjs <tokenId> --botchan-post "message text"
    Encode a Net Protocol post from the L2 TBA.

  Add --estimate-gas to any encode command to estimate L1 gas cost.

The output is a dry-run: full calldata + cast command. No transactions are sent.
The Normie owner must sign and broadcast the L1 transaction.`);
    process.exit(0);
  }

  loadEnv();

  // Parse tokenId
  const tokenId = parseInt(args.find(a => !a.startsWith("--")));
  if (isNaN(tokenId)) {
    console.error("Invalid tokenId. Usage: node tba-bridge.mjs <tokenId> --check");
    process.exit(1);
  }

  // --check mode
  if (args.includes("--check")) {
    const result = await checkPrereqs(tokenId);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Determine L2 action
  let to, data, value = 0n;
  const l2GasIdx = args.indexOf("--l2-gas");
  const l2GasLimit = l2GasIdx >= 0 ? parseInt(args[l2GasIdx + 1]) : DEFAULT_L2_GAS_LIMIT;

  if (args.includes("--botchan-post")) {
    const idx = args.indexOf("--botchan-post");
    const message = args[idx + 1];
    if (!message) { console.error("--botchan-post requires a message"); process.exit(1); }
    // Net Protocol contract on Base
    to = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"; // placeholder — need actual Net Protocol contract
    data = encodeBotchanPost(message);
    console.error(`[bridge] Encoding botchan post: "${message}"`);
    console.error(`[bridge] NOTE: Update NET_PROTOCOL_CONTRACT address before use.`);
  } else if (args.includes("--transfer-nft")) {
    const nftIdx = args.indexOf("--transfer-nft");
    const nftContract = args[nftIdx + 1];
    const nftTokenIdx = args.indexOf("--nft-token-id");
    const recipientIdx = args.indexOf("--recipient");
    if (!nftContract || nftTokenIdx < 0 || recipientIdx < 0) {
      console.error("--transfer-nft requires --nft-token-id and --recipient");
      process.exit(1);
    }
    const nftTokenId = parseInt(args[nftTokenIdx + 1]);
    const recipient = args[recipientIdx + 1];
    to = nftContract;
    data = encodeNFTTransfer(nftContract, nftTokenId, recipient);
    console.error(`[bridge] Encoding NFT transfer: ${nftContract} #${nftTokenId} → ${recipient}`);
  } else if (args.includes("--to")) {
    const toIdx = args.indexOf("--to");
    to = args[toIdx + 1];
    const dataIdx = args.indexOf("--data");
    data = dataIdx >= 0 ? args[dataIdx + 1] : "0x";
    const valueIdx = args.indexOf("--value");
    value = valueIdx >= 0 ? BigInt(args[valueIdx + 1]) : 0n;
  } else {
    console.error("Specify --check, --to, --transfer-nft, or --botchan-post");
    process.exit(1);
  }

  // Encode the bridge call
  const result = encodeBridgeCall(tokenId, { to, value, data, l2GasLimit });

  // Optional gas estimation
  if (args.includes("--estimate-gas")) {
    result.gasEstimate = await estimateGas(tokenId, { to, value, data, l2GasLimit });
  }

  console.log(JSON.stringify(result, null, 2));
}

export { encodeBridgeCall, checkPrereqs, applyL1ToL2Alias, undoL1ToL2Alias };

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ""));
if (isMain) main().catch(e => { console.error(e.message); process.exit(1); });
