/**
 * Solace — runtime configuration.
 *
 * Everything the application needs to know about its environment is resolved
 * here, once, with a safe default. Nothing in this file throws at import time.
 * A missing API key or RPC URL must produce a clear message in the interface,
 * not a white screen during a demonstration in Parliament.
 */

// Fully-specified relative import: command-line tools run this module under
// plain Node, which has no bundler to resolve extensionless paths.
import { ChainName } from "./domain.ts";

// ---------------------------------------------------------------------------
// Operating mode
// ---------------------------------------------------------------------------

export const OperatingMode = {
  /**
   * Everything runs locally. A local Hardhat node provides the chain, the
   * database is pre-seeded, and no part of the demonstration path touches the
   * internet. This is the mode to use when the venue's wifi cannot be trusted.
   */
  DEMO: "DEMO",
  /**
   * Settlement goes to Base Sepolia, so the block explorer link points at a
   * genuinely public, independently verifiable transaction.
   */
  LIVE: "LIVE",
} as const;
export type OperatingMode = (typeof OperatingMode)[keyof typeof OperatingMode];

function readMode(): OperatingMode {
  const raw = (
    process.env.SOLACE_MODE ??
    process.env.NEXT_PUBLIC_SOLACE_MODE ??
    ""
  ).toUpperCase();
  return raw === OperatingMode.LIVE ? OperatingMode.LIVE : OperatingMode.DEMO;
}

/**
 * The active mode. Defaults to DEMO, which is the deliberate choice: an
 * unconfigured checkout should run offline and work, rather than fail while
 * reaching for a network it was never told about.
 */
export const MODE: OperatingMode = readMode();

export const isDemoMode = MODE === OperatingMode.DEMO;
export const isLiveMode = MODE === OperatingMode.LIVE;

/** The chain settlements are written to in the current mode. */
export const ACTIVE_CHAIN: ChainName = isLiveMode
  ? ChainName.BASE_SEPOLIA
  : ChainName.HARDHAT_LOCAL;

// ---------------------------------------------------------------------------
// Chains
// ---------------------------------------------------------------------------

export const CHAINS = {
  [ChainName.BASE_SEPOLIA]: {
    id: 84532,
    label: "Base Sepolia",
    explorerBaseUrl: "https://sepolia.basescan.org",
    defaultRpcUrl: "https://sepolia.base.org",
    /** Public, verifiable by anyone with a browser. */
    isPublic: true,
  },
  [ChainName.HARDHAT_LOCAL]: {
    id: 31337,
    label: "Local Hardhat node",
    explorerBaseUrl: "",
    defaultRpcUrl: "http://127.0.0.1:8545",
    isPublic: false,
  },
  [ChainName.NONE]: {
    id: 0,
    label: "Not settled on chain",
    explorerBaseUrl: "",
    defaultRpcUrl: "",
    isPublic: false,
  },
} as const;

export const BASE_SEPOLIA_RPC_URL =
  process.env.BASE_SEPOLIA_RPC_URL?.trim() ||
  CHAINS[ChainName.BASE_SEPOLIA].defaultRpcUrl;

export const HARDHAT_RPC_URL =
  process.env.HARDHAT_RPC_URL?.trim() ||
  CHAINS[ChainName.HARDHAT_LOCAL].defaultRpcUrl;

/**
 * Build a block explorer URL for a transaction, or `null` where no public
 * explorer exists. Callers must handle `null` by hiding the link rather than
 * rendering one that leads nowhere.
 */
export function explorerTxUrl(
  chain: ChainName,
  txHash: string | null | undefined,
): string | null {
  if (!txHash) return null;
  const base = CHAINS[chain]?.explorerBaseUrl;
  if (!base) return null;
  return `${base}/tx/${txHash}`;
}

/** Build a block explorer URL for a contract address, or `null`. */
export function explorerAddressUrl(
  chain: ChainName,
  address: string | null | undefined,
): string | null {
  if (!address) return null;
  const base = CHAINS[chain]?.explorerBaseUrl;
  if (!base) return null;
  return `${base}/address/${address}`;
}

// ---------------------------------------------------------------------------
// Energy and money assumptions
// ---------------------------------------------------------------------------

/**
 * The tariff used to convert kilowatt-hours into pence.
 *
 * THIS IS A STATED ASSUMPTION, NOT A CITED FIGURE. It is a single configurable
 * constant so that a reviewer can see exactly what rate produced every number
 * in the interface and substitute their own. Solace's claim is about the
 * traceability of the arithmetic, not about the precision of this rate.
 */
export const TARIFF_PENCE_PER_KWH = Number(
  process.env.SOLACE_TARIFF_PENCE_PER_KWH ?? 28,
);

/**
 * The rate a household currently receives for exporting surplus to the grid.
 * Also a stated assumption. Its role is to show the gap Solace closes: the same
 * kilowatt-hour is worth more delivered to a cold home than sold to the grid.
 */
export const EXPORT_PENCE_PER_KWH = Number(
  process.env.SOLACE_EXPORT_PENCE_PER_KWH ?? 15,
);

/**
 * How far a recipient may be from an exporter and still be matched.
 *
 * The constraint is real, not decorative: surplus delivered locally puts less
 * strain on the distribution network, and a councillor can explain a
 * neighbourhood-level match in a way they cannot explain a national one.
 *
 * Three kilometres is calibrated to an inner-London borough. Westminster is
 * about five kilometres corner to corner, so a radius of eight would cover the
 * whole of it and the constraint would never bind — it would be a rule that
 * looks like policy and does nothing. At three, thirteen of the twenty-four
 * possible pairings are eligible and the northern and southern halves of the
 * borough are served by their own roofs.
 */
export const PROXIMITY_RADIUS_KM = Number(
  process.env.SOLACE_PROXIMITY_RADIUS_KM ?? 3,
);

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

/**
 * Salt for the recipient identifier HMAC.
 *
 * There are only eleven households in this universe, so a plain unsalted hash
 * of a household reference could be brute-forced by anyone in seconds. A secret
 * salt is what makes the on-chain identifier genuinely opaque. It lives in
 * `.env.local`, is never committed, and never leaves the server.
 *
 * The fallback exists so a fresh checkout runs. It is not a secret and is
 * reported as such by `configurationWarnings()`.
 */
export const RECIPIENT_HASH_SALT =
  process.env.SOLACE_HASH_SALT?.trim() || "solace-development-salt-not-secret";

export const hasConfiguredHashSalt = Boolean(
  process.env.SOLACE_HASH_SALT?.trim(),
);

export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
export const hasAnthropicKey = ANTHROPIC_API_KEY.length > 0;

/**
 * Deployer key for contract deployment and settlement. Server-side only, and
 * only ever a throwaway testnet key. Never a key that holds real value.
 */
export const DEPLOYER_PRIVATE_KEY =
  process.env.DEPLOYER_PRIVATE_KEY?.trim() ?? "";

// ---------------------------------------------------------------------------
// Honest self-reporting
// ---------------------------------------------------------------------------

/**
 * Things that are not configured, phrased for display.
 *
 * Solace's whole argument is that a system handling public money should be able
 * to say what it does and does not know. That starts with the system being
 * candid about its own configuration rather than failing quietly.
 */
export function configurationWarnings(): string[] {
  const warnings: string[] = [];

  if (!hasConfiguredHashSalt) {
    warnings.push(
      "Recipient hashing is using the development salt. Set SOLACE_HASH_SALT before any real deployment.",
    );
  }

  if (!hasAnthropicKey) {
    warnings.push(
      "No Anthropic API key configured. Need-signal parsing and report generation will fall back to their stored results.",
    );
  }

  if (isLiveMode && !DEPLOYER_PRIVATE_KEY) {
    warnings.push(
      "Live mode is selected but no deployer key is configured, so settlement cannot reach Base Sepolia.",
    );
  }

  return warnings;
}

/** A short description of the current mode, for the dashboard header. */
export function modeDescription(): string {
  return isLiveMode
    ? "Live — settling on Base Sepolia, a public testnet"
    : "Demo — settling on a local chain, no internet required";
}
