/**
 * Solace — allocation engine, input and output shapes.
 *
 * The engine is a pure function. It takes this input, returns this output, and
 * touches nothing else: no database, no network, no clock, no language model.
 * That is what makes it replayable — anyone holding the input can re-derive the
 * output exactly, and anyone disputing a decision can be handed the input that
 * produced it.
 */

import type { AllocationReasoning, EpcBand } from "../domain.ts";

/** A solar household with surplus to give, for one run. */
export interface ExporterState {
  reference: string;
  displayName: string;
  locality: string;
  latitude: number;
  longitude: number;
  /**
   * Surplus available in each half-hourly period, keyed by the period's start
   * as an ISO string. Only periods with surplus need appear.
   */
  surplusKwhByInterval: Record<string, number>;
}

/** A household eligible for support, for one run. */
export interface RecipientState {
  reference: string;
  displayName: string;
  locality: string;
  latitude: number;
  longitude: number;

  // Structural facts, from the council's own records.
  onMeansTestedBenefit: boolean;
  epcBand: EpcBand;
  occupants: number;
  hasChildUnderFive: boolean;
  hasResidentOverSixtyFive: boolean;
  hasHealthCondition: boolean;
  onPrepaymentMeter: boolean;
  coldWeatherBaselineKwh: number;

  /** Consumption in each half-hourly period, keyed by ISO interval start. */
  consumptionKwhByInterval: Record<string, number>;

  /**
   * Vulnerability score parsed from council case notes, 0–1, or null if no
   * note has been parsed.
   *
   * This is the ONLY value in the engine's input that a language model
   * contributed to, and it arrives already computed and persisted. The engine
   * reads a number from a database column; it does not call a model, and it
   * cannot tell that one was ever involved.
   */
  caseNoteVulnerability: number | null;

  /**
   * Energy this household has already received, in kWh, before this run.
   *
   * Drives the fairness constraint.
   */
  previouslyServedKwh: number;

  /** How many times this household has been served before this run. */
  previouslyServedCount: number;
}

/** Weather for one day. */
export interface DayConditions {
  /** ISO date, e.g. "2026-08-14". */
  date: string;
  meanTemperatureC: number;
  heatingDegreeHours: number;
}

/** Everything the engine needs. Nothing else is consulted. */
export interface AllocationInput {
  potReference: string;
  /** Inclusive ISO date of the first day considered. */
  windowStart: string;
  /** Inclusive ISO date of the last day considered. */
  windowEnd: string;

  /**
   * Fixes tie-breaking order.
   *
   * When two households score identically the engine must still choose one.
   * Choosing alphabetically would quietly favour whichever household happens
   * to sort first, every single time, forever. A seeded permutation removes
   * that bias while staying entirely reproducible.
   */
  seed: string;

  exporters: ExporterState[];
  recipients: RecipientState[];
  conditions: DayConditions[];

  tariffPencePerKwh: number;
  proximityRadiusKm: number;

  /** What the pot can still spend, in pence. The engine will not exceed it. */
  potBalancePence: number;
}

/** One decision. */
export interface AllocationDecision {
  /** Deterministic identifier, derived from the run and the decision itself. */
  id: string;
  /** ISO date the energy was delivered. */
  date: string;
  exporterReference: string;
  recipientReference: string;

  kwh: number;
  milliKwh: number;
  pencePerKwh: number;
  amountPence: number;

  /** Position in the run's ordering. Rank 1 was the neediest eligible match. */
  rank: number;

  reasoning: AllocationReasoning;
}

/** Why a household received nothing, so the absence is explicable too. */
export interface UnservedRecipient {
  recipientReference: string;
  reason: string;
}

/**
 * The need assessment for one household, whether or not it was served.
 *
 * Published for every household in the run, including those that received
 * nothing. A system that only explains its positive decisions cannot answer the
 * question it will actually be asked, which is why somebody was left out.
 */
export interface NeedSummary {
  recipientReference: string;
  needScore: number;
  eligible: boolean;
  /** Populated when `eligible` is false. */
  ineligibleReason: string | null;
  actualDailyKwh: number;
  expectedDailyKwh: number;
}

/** What the engine produced. */
export interface AllocationResult {
  engineVersion: string;
  potReference: string;
  windowStart: string;
  windowEnd: string;
  seed: string;

  decisions: AllocationDecision[];
  unserved: UnservedRecipient[];
  assessments: NeedSummary[];

  totalKwh: number;
  totalPence: number;

  /** SHA-256 over the canonicalised input. */
  inputDigest: string;
  /** SHA-256 over the canonicalised decisions. */
  outputDigest: string;

  /** Surplus that existed but could not be placed, and why. */
  unallocatedKwh: number;
  notes: string[];
}
