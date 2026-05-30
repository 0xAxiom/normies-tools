#!/usr/bin/env node
// registrar-probe.mjs — Confirm which ERC-8004 registrar is canonical on mainnet,
// cross-check against Adapter8004 deployment, and inspect agent #32811 binding.
//
// Usage: node src/agent-tools/registrar-probe.mjs [--agent-id 32811]

import { ethers } from "ethers";
import {
  CHAINS, ADAPTER_ABI, REGISTRY_ABI,
  loadEnv, getProvider,
} from "../../skills/awaken-normie/scripts/lib.mjs";

loadEnv();

const args = process.argv.slice(2);
const agentIdIdx = args.indexOf("--agent-id");
const agentId = agentIdIdx >= 0 ? Number(args[agentIdIdx + 1]) : 32811;

async function main() {
  const provider = getProvider("mainnet");
  const adapter = new ethers.Contract(CHAINS.mainnet.adapter, ADAPTER_ABI, provider);

  console.log("=== ERC-8004 Registrar Probe ===\n");
  console.log(`Adapter8004: ${CHAINS.mainnet.adapter}`);
  console.log(`Hardcoded registry: ${CHAINS.mainnet.registry}`);

  // 1. Query identityRegistry() from Adapter8004
  let onchainRegistry;
  try {
    onchainRegistry = await adapter.identityRegistry();
    console.log(`On-chain identityRegistry(): ${onchainRegistry}`);
  } catch (err) {
    console.log(`identityRegistry() call failed: ${err.message}`);
    onchainRegistry = null;
  }

  const match = onchainRegistry && onchainRegistry.toLowerCase() === CHAINS.mainnet.registry.toLowerCase();
  console.log(`\nRegistry match: ${match ? "YES" : "NO — MISMATCH"}`);
  if (onchainRegistry && !match) {
    console.log(`  hardcoded: ${CHAINS.mainnet.registry}`);
    console.log(`  on-chain:  ${onchainRegistry}`);
  }

  // 2. Query registry contract metadata
  const registryAddr = onchainRegistry || CHAINS.mainnet.registry;
  const registry = new ethers.Contract(registryAddr, REGISTRY_ABI, provider);

  console.log(`\n--- Registry contract: ${registryAddr} ---`);
  const [name, symbol] = await Promise.all([
    registry.name().catch(() => "(reverted)"),
    registry.symbol().catch(() => "(reverted)"),
  ]);
  console.log(`Name: ${name}`);
  console.log(`Symbol: ${symbol}`);

  // 3. Inspect our agent
  console.log(`\n--- Agent #${agentId} ---`);

  const [registryOwner, registryTokenURI, adapterTokenURI, binding, wallet] = await Promise.all([
    registry.ownerOf(agentId).catch(e => `(reverted: ${e.reason || e.message})`),
    registry.tokenURI(agentId).catch(e => `(reverted: ${e.reason || e.message})`),
    adapter.tokenURI(agentId).catch(e => `(reverted: ${e.reason || e.message})`),
    adapter.bindingOf(agentId).catch(e => null),
    adapter.getAgentWallet(agentId).catch(e => `(reverted: ${e.reason || e.message})`),
  ]);

  console.log(`Registry ownerOf: ${registryOwner}`);
  console.log(`Registry tokenURI: ${registryTokenURI}`);
  console.log(`Adapter tokenURI: ${adapterTokenURI}`);
  console.log(`Adapter getAgentWallet: ${wallet}`);

  if (binding) {
    const stdNames = ["ERC721", "ERC1155", "ERC6909"];
    console.log(`Binding: ${stdNames[Number(binding[0])] || binding[0]} | contract: ${binding[1]} | tokenId: ${binding[2].toString()}`);
  } else {
    console.log("Binding: (call reverted)");
  }

  // 4. Check registrationHash
  try {
    const hash = await adapter.registrationHash(CHAINS.mainnet.normies, agentId === 32811 ? 7593 : 0);
    console.log(`registrationHash(normies, 7593): ${hash}`);
  } catch (e) {
    console.log(`registrationHash: (reverted: ${e.reason || e.message})`);
  }

  // 5. Check BINDING_METADATA_KEY
  try {
    const key = await adapter.BINDING_METADATA_KEY();
    console.log(`BINDING_METADATA_KEY: "${key}"`);
  } catch (e) {
    console.log(`BINDING_METADATA_KEY: (reverted: ${e.reason || e.message})`);
  }

  // 6. Check getMetadata for binding key
  try {
    const key = await adapter.BINDING_METADATA_KEY().catch(() => "erc8004.binding");
    const meta = await registry.getMetadata(agentId, key);
    console.log(`getMetadata(${agentId}, "${key}"): ${meta}`);
  } catch (e) {
    console.log(`getMetadata: (reverted: ${e.reason || e.message})`);
  }

  // 7. Cross-check Base registry
  console.log("\n--- Base chain cross-check ---");
  console.log(`Base adapter: ${CHAINS.base.adapter}`);
  console.log(`Base registry: ${CHAINS.base.registry}`);
  console.log(`Same registry address on both chains: ${CHAINS.mainnet.registry === CHAINS.base.registry ? "YES" : "NO"}`);

  try {
    const baseProvider = getProvider("base");
    const baseAdapter = new ethers.Contract(CHAINS.base.adapter, ADAPTER_ABI, baseProvider);
    const baseOnchainReg = await baseAdapter.identityRegistry();
    console.log(`Base on-chain identityRegistry(): ${baseOnchainReg}`);
    console.log(`Base registry matches mainnet: ${baseOnchainReg.toLowerCase() === registryAddr.toLowerCase() ? "YES" : "NO"}`);
  } catch (e) {
    console.log(`Base probe failed: ${e.message}`);
  }

  // Output JSON summary
  const summary = {
    mainnet: {
      adapter: CHAINS.mainnet.adapter,
      registryHardcoded: CHAINS.mainnet.registry,
      registryOnchain: onchainRegistry,
      match,
      name, symbol,
    },
    agent: {
      agentId,
      registryOwner,
      registryTokenURI,
      adapterTokenURI,
      wallet,
      binding: binding ? {
        standard: ["ERC721", "ERC1155", "ERC6909"][Number(binding[0])] || String(binding[0]),
        tokenContract: binding[1],
        tokenId: binding[2].toString(),
      } : null,
    },
  };

  console.log("\n=== JSON Summary ===");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(e => { console.error(e.message); process.exit(1); });
