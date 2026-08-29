/**
 * Solace — the shared vocabulary of the system.
 *
 * SQLite has no enum type, so the schema stores these as plain strings. Keeping
 * the permitted values here, as `as const` objects with matching types, means
 * TypeScript still narrows them everywhere and there is exactly one place to
 * look when you want to know what a column may contain.
 */

// ---------------------------------------------------------------------------
// Households and meters
// ---------------------------------------------------------------------------

export const HouseholdRole = {
  /** A household with rooftop solar, exporting surplus to the grid. */
  EXPORTER: "EXPORTER",
  /** A household eligible for fuel poverty support. */
  RECIPIENT: "RECIPIENT",
} as const;
export type HouseholdRole = (typeof HouseholdRole)[keyof typeof HouseholdRole];

export const MeterChannel = {
  /** Surplus generation flowing out of the property. */
  EXPORT: "EXPORT",
  /** Electricity drawn by the property. */
  CONSUMPTION: "CONSUMPTION",
} as const;
export type MeterChannel = (typeof MeterChannel)[keyof typeof MeterChannel];

/** EPC bands, best to worst. Order matters: the engine scores by index. */
export const EPC_BANDS = ["A", "B", "C", "D", "E", "F", "G"] as const;
export type EpcBand = (typeof EPC_BANDS)[number];

// ---------------------------------------------------------------------------
// Chain and settlement
// ---------------------------------------------------------------------------

export const ChainName = {
  /** The public testnet. Transactions here are real and independently verifiable. */
  BASE_SEPOLIA: "BASE_SEPOLIA",
  /** A local Hardhat node. Real transactions, but only on this machine. */
  HARDHAT_LOCAL: "HARDHAT_LOCAL",
  /**
   * No chain involved. Used only for backfilled historic records, which are
   * simulation and are labelled as such wherever they are shown.
   */
  NONE: "NONE",
} as const;
export type ChainName = (typeof ChainName)[keyof typeof ChainName];

/**
 * Narrow a database string to a known chain.
 *
 * Columns come back as plain strings because SQLite has no enums. Anything
 * unrecognised becomes NONE rather than throwing: an unfamiliar value in one
 * row should mean "no explorer link for this row", not a blank dashboard.
 */
export function toChainName(value: string | null | undefined): ChainName {
  if (value !== null && value !== undefined && value in ChainName) {
    return value as ChainName;
  }
  return ChainName.NONE;
}

export const SettlementStatus = {
  /** Created, not yet sent to a node. */
  PENDING: "PENDING",
  /** Broadcast, awaiting inclusion in a block. */
  SUBMITTED: "SUBMITTED",
  /** Included in a block. This is the only status that proves anything. */
  CONFIRMED: "CONFIRMED",
  /** The chain call did not succeed. `failureReason` explains why. */
  FAILED: "FAILED",
  /**
   * A seeded historic record with no transaction behind it. Present so the
   * dashboard has thirty days of context, and never presented as settled.
   */
  BACKFILLED: "BACKFILLED",
} as const;
export type SettlementStatus =
  (typeof SettlementStatus)[keyof typeof SettlementStatus];

/** Statuses that count towards money actually having left the pot. */
export const SPENT_STATUSES: readonly SettlementStatus[] = [
  SettlementStatus.SUBMITTED,
  SettlementStatus.CONFIRMED,
  SettlementStatus.BACKFILLED,
];

// ---------------------------------------------------------------------------
// Allocation reasoning
// ---------------------------------------------------------------------------

/**
 * One factor in a household's need score.
 *
 * `value` is the raw observation, `weight` is the fixed coefficient from the
 * engine's configuration, and `contribution` is what that factor added to the
 * final score. Storing all three means a reader can check the arithmetic rather
 * than take the total on trust.
 */
export interface ReasoningFactor {
  /** Stable machine key, e.g. "epc_band". */
  key: string;
  /** How this reads on the dashboard, e.g. "EPC band F". */
  label: string;
  value: number | string | boolean;
  weight: number;
  contribution: number;
  /** One sentence a councillor could repeat out loud. */
  explanation: string;
}

/**
 * The full justification for a single allocation. This is what the dashboard
 * expands, and it is written for a reader who is entitled to an answer, not for
 * a developer reading logs.
 */
export interface AllocationReasoning {
  engineVersion: string;
  /** Need score before the fairness adjustment. */
  needScore: number;
  /** Multiplier applied because of how much this household has already had. */
  fairnessMultiplier: number;
  /** Need score after fairness. This is what the ranking actually used. */
  priorityScore: number;
  factors: ReasoningFactor[];
  proximity: {
    exporterReference: string;
    distanceKm: number;
    withinRadiusKm: number;
  };
  fairness: {
    kwhAlreadyReceived: number;
    timesServed: number;
    /** Plain-English statement of why the multiplier is what it is. */
    note: string;
  };
  /** A one-paragraph summary assembled from the factors by ordinary code. */
  summary: string;
}

// ---------------------------------------------------------------------------
// Need signals
// ---------------------------------------------------------------------------

/**
 * The structured form of a free-text council case note.
 *
 * This is the only thing the parsing model is permitted to produce. It is
 * persisted, then read by the engine. The model never sees an allocation
 * decision and never influences one except through these stored fields.
 */
export interface ParsedNeedSignal {
  /** 0–1. Higher means more vulnerable to cold. */
  vulnerabilityScore: number;
  /** Short machine-readable markers, e.g. "self_disconnection". */
  indicators: string[];
  /** Whether the note describes an immediate risk rather than a standing one. */
  urgent: boolean;
  /** The model's own one-line justification, shown alongside the score. */
  rationale: string;
  /** 0–1. Low confidence is surfaced rather than hidden. */
  confidence: number;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/**
 * The figures handed to the narrative model, computed from the ledger by
 * ordinary code. The model turns these into prose. It is not given the freedom
 * to introduce a number that is not in here.
 */
export interface ReportFacts {
  potReference: string;
  potName: string;
  councilName: string;
  fundingSource: string;
  periodStart: string;
  periodEnd: string;
  depositedPence: number;
  spentPence: number;
  remainingPence: number;
  totalKwh: number;
  householdsServed: number;
  averageKwhPerHousehold: number;
  averagePencePerHousehold: number;
  confirmedOnChainCount: number;
  backfilledCount: number;
  /** Households served more than once, with the engine's reason for each. */
  repeatRecipients: Array<{
    reference: string;
    locality: string;
    timesServed: number;
    kwhReceived: number;
    reason: string;
  }>;
}

// ---------------------------------------------------------------------------
// JSON column helpers
// ---------------------------------------------------------------------------

/**
 * Parse a JSON column that we wrote ourselves.
 *
 * Returns `null` rather than throwing. A malformed reasoning blob should
 * collapse one expandable panel, not take down the councillor's dashboard
 * during a demo.
 */
export function parseJsonColumn<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Serialise a value for a JSON column. */
export function toJsonColumn(value: unknown): string {
  return JSON.stringify(value);
}
