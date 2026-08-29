/**
 * Solace — the allocation engine.
 *
 * The engine decides who receives energy. It is deterministic, it is pure, and
 * no language model participates in it. See `allocate.ts` for the solver and
 * `scoring.ts` for the factors and their weights.
 */

export { allocate, ENGINE_VERSION, MIN_ALLOCATION_KWH } from "./allocate.ts";
export { canonicalJson, digest } from "./digest.ts";
export {
  FAIRNESS_HALF_LIFE_KWH,
  fairnessMultiplier,
  fairnessNote,
} from "./fairness.ts";
export {
  assessNeed,
  COLD_REFERENCE_DEGREE_HOURS,
  consumptionShortfall,
  detectSelfDisconnection,
  epcBandScore,
  estimateBaseLoadKwh,
  FACTOR_WEIGHTS,
} from "./scoring.ts";
export type {
  AllocationDecision,
  AllocationInput,
  AllocationResult,
  DayConditions,
  ExporterState,
  RecipientState,
  UnservedRecipient,
} from "./types.ts";
