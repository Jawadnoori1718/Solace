import type { HardhatUserConfig } from "hardhat/config";
import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";

import { loadEnvFiles } from "./src/lib/env-file.ts";

// Hardhat is a plain Node process, so it does not get the `.env.local` loading
// that Next.js does for the dashboard. Load it before the config is read.
loadEnvFiles();

/**
 * A throwaway key used only by the local simulated chain.
 *
 * This is Hardhat's own well-known first test account. It is public, it is in
 * every Hardhat tutorial ever written, and it must never hold anything. It is
 * here so that the local network has a deterministic deployer address, which in
 * turn makes local deployments reproducible.
 */
const LOCAL_TEST_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

/**
 * The Base Sepolia deployer key.
 *
 * Falls back to the local test key when unset. That is deliberate: the config
 * must load without a key so that `npx hardhat test` and local deployment work
 * on a fresh checkout. Targeting Base Sepolia with an unfunded fallback fails
 * with an out-of-funds error, which is a clear and honest failure, rather than
 * Hardhat refusing to load its own configuration.
 */
const deployerKey = process.env.DEPLOYER_PRIVATE_KEY?.trim() || LOCAL_TEST_KEY;

const config: HardhatUserConfig = {
  plugins: [hardhatToolboxViemPlugin],

  paths: {
    // Contract tests need the Hardhat runtime. The unit tests in test/unit are
    // plain `node --test` and must stay runnable without it, so that the
    // allocation engine's reproducibility suite has no dependency on a chain.
    tests: "test/contracts",
  },

  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        // Settlement is the function that runs thousands of times; deployment
        // happens once. Tune for the former.
        runs: 500,
      },
      // Emit metadata needed to verify the source on a block explorer. A
      // contract nobody can read the source of is not an accountability tool.
      metadata: { bytecodeHash: "ipfs" },
    },
  },

  networks: {
    /**
     * In-process simulated chain. Used by the test suite.
     */
    hardhat: {
      type: "edr-simulated",
      chainType: "l1",
    },

    /**
     * A local Hardhat node, started with `npm run chain`.
     *
     * This is the chain demo mode settles on. Transactions here are real —
     * really mined, really emitting events, really moving balances — they are
     * simply not public. That is what lets the full thirty days of history be
     * genuinely on a chain without needing a faucet, and without the venue's
     * wifi being on the critical path.
     */
    localhost: {
      type: "http",
      chainType: "l1",
      url: process.env.HARDHAT_RPC_URL?.trim() || "http://127.0.0.1:8545",
      chainId: 31337,
    },

    /**
     * Base Sepolia, the public testnet. Live mode settles here, so the block
     * explorer link in the dashboard points at something anybody in the room
     * can independently verify from their own phone.
     */
    baseSepolia: {
      type: "http",
      chainType: "op",
      url: process.env.BASE_SEPOLIA_RPC_URL?.trim() || "https://sepolia.base.org",
      chainId: 84532,
      accounts: [deployerKey],
    },
  },
};

export default config;
