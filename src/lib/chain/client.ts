/**
 * Solace — talking to the chain.
 *
 * One place where viem clients are built, so that the rest of the application
 * never has to know which network it is on. Demo mode points at a local Hardhat
 * node; live mode points at Base Sepolia. Nothing else changes.
 *
 * Nothing here throws at import time. A missing key or an unreachable node
 * produces a clear result the interface can render, not a crash. The chain is
 * the least reliable thing in this system and the demonstration must survive it
 * being unavailable.
 */

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Account,
  type Address,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

import {
  ACTIVE_CHAIN,
  BASE_SEPOLIA_RPC_URL,
  CHAINS,
  DEPLOYER_PRIVATE_KEY,
  HARDHAT_RPC_URL,
  isLiveMode,
} from "../config.ts";
import { ChainName } from "../domain.ts";
import { prisma } from "../db.ts";

/**
 * Hardhat's well-known first test account.
 *
 * Public, in every Hardhat tutorial ever written, and holding nothing but local
 * test ether. Used so demo mode works on a fresh clone with no configuration.
 */
const LOCAL_TEST_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

/** The local Hardhat node, described for viem. */
const hardhatLocal = defineChain({
  id: CHAINS[ChainName.HARDHAT_LOCAL].id,
  name: CHAINS[ChainName.HARDHAT_LOCAL].label,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [HARDHAT_RPC_URL] } },
});

/**
 * Typed as viem's generic `Chain` on purpose.
 *
 * Base Sepolia is an OP-stack chain and carries extra block fields that the
 * local node does not. Left inferred, the two branches produce unrelated client
 * types and nothing downstream can accept both. We use no OP-specific
 * behaviour, so the common type is the correct one.
 */
function activeChain(): Chain {
  return isLiveMode ? baseSepolia : hardhatLocal;
}

function activeRpcUrl(): string {
  return isLiveMode ? BASE_SEPOLIA_RPC_URL : HARDHAT_RPC_URL;
}

/** Read-only client for the active chain. */
export function publicClient() {
  return createPublicClient({
    chain: activeChain(),
    transport: http(activeRpcUrl()),
  });
}

/**
 * The account that funds pots and submits settlements.
 *
 * In live mode this must be a configured key. In demo mode it falls back to the
 * local test account, which is the whole point of demo mode.
 */
export function settlementAccount(): Account | null {
  // The key is chosen by mode, not by whether one happens to be configured.
  //
  // A Base Sepolia deployer key is meaningless on a local chain: it holds no
  // local ether and it is not the account that deployed the local contract, so
  // every settlement reverts with `NotASettler`. Before this was explicit,
  // simply adding a testnet key to `.env.local` silently broke demo mode —
  // which is exactly the configuration somebody would be in the day before a
  // demonstration.
  const key = isLiveMode ? DEPLOYER_PRIVATE_KEY : LOCAL_TEST_KEY;
  if (!key) return null;

  try {
    return privateKeyToAccount(key as `0x${string}`);
  } catch {
    // A malformed key is a configuration problem, not a crash. The caller
    // reports it and the interface degrades.
    return null;
  }
}

/** Client for submitting transactions, or null if no usable key is configured. */
export function walletClient() {
  const account = settlementAccount();
  if (account === null) return null;

  return createWalletClient({
    account,
    chain: activeChain(),
    transport: http(activeRpcUrl()),
  });
}

/**
 * Where SolacePound is deployed on the active chain.
 *
 * Read from the database, written there at deploy time. No address is ever
 * hardcoded, so the application cannot end up pointing at a contract that was
 * replaced an hour before a demonstration.
 */
export async function tokenAddress(
  chain: ChainName = ACTIVE_CHAIN,
): Promise<Address | null> {
  const deployment = await prisma.contractDeployment.findUnique({
    where: { chain_name: { chain, name: "SolacePound" } },
  });

  return (deployment?.address as Address | undefined) ?? null;
}

/** Whether the active chain is reachable. Used to degrade the interface. */
export async function chainIsReachable(): Promise<boolean> {
  try {
    await publicClient().getChainId();
    return true;
  } catch {
    return false;
  }
}
