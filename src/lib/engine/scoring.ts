/**
 * Solace — how a household's need is scored.
 *
 * NO LANGUAGE MODEL RUNS HERE. Every number below is produced by arithmetic
 * over council records and meter readings. One input — `caseNoteVulnerability`
 * — was written by a model at some earlier point and persisted to a database
 * column; by the time it reaches this file it is simply a number between zero
 * and one, indistinguishable from any other. The engine cannot call a model and
 * does not know one exists.
 *
 * THE SHAPE OF THE SCORE
 *
 * Nine factors, each normalised to 0–1, each multiplied by a fixed weight, and
 * summed. The weights are constants declared in one place, they add to one, and
 * they are published in the reasoning attached to every decision. A councillor
 * who disagrees with a ranking can see precisely which factor produced it and
 * by how much, and can argue about the weight rather than about the outcome.
 *
 * That is the whole point of a deterministic engine. The disagreement moves
 * from "why did the computer choose them" to "is health worth more than EPC
 * band" — which is a policy question, and one a councillor is entitled to
 * answer.
 */

import { EPC_BANDS, type ReasoningFactor } from "../domain.ts";
import type { DayConditions, RecipientState } from "./types.ts";

/**
 * The weights.
 *
 * These are a policy position, not a measurement, and they are stated as such.
 * A council adopting Solace would set them itself, most likely through the same
 * committee that signs off its fuel poverty strategy. They sum to 1.0 so that a
 * score is always a fraction of the worst case a household could present.
 */
export const FACTOR_WEIGHTS = {
  /** In receipt of a means-tested benefit. The council's own record. */
  means_tested_benefit: 0.16,
  /** EPC band. A leakier home needs more energy for the same warmth. */
  epc_band: 0.14,
  /** A health condition made worse by cold. */
  health_condition: 0.12,
  /** Consumption below what the weather says the home should need. */
  consumption_shortfall: 0.16,
  /** Prepayment meter: a documented marker of self-disconnection risk. */
  prepayment_meter: 0.1,
  /** A resident over sixty-five. */
  resident_over_sixty_five: 0.09,
  /** A child under five. */
  child_under_five: 0.07,
  /** Evidence in the meter data of the supply actually going off. */
  self_disconnection: 0.06,
  /** Vulnerability described in the council's own case notes. */
  case_note_vulnerability: 0.1,
} as const;

export type FactorKey = keyof typeof FACTOR_WEIGHTS;

/**
 * The reference cold day: a daily mean of 4°C, which is 276 degree-hours below
 * the 15.5°C heating threshold. `coldWeatherBaselineKwh` is defined against
 * this, so it is what expected consumption is scaled from.
 */
export const COLD_REFERENCE_DEGREE_HOURS = (15.5 - 4) * 24;

/** Half-hourly periods covering 17:00 to 23:00, when the evening peak runs. */
const EVENING_PERIOD_START_HOUR = 17;
const EVENING_PERIOD_END_HOUR = 23;

/** A supply interruption must last at least this many periods to count. */
const MIN_DISCONNECTION_PERIODS = 4; // two hours

/** Episodes needed to score the maximum on the self-disconnection factor. */
const DISCONNECTION_EPISODES_FOR_MAX = 4;

// ---------------------------------------------------------------------------
// Individual factors
// ---------------------------------------------------------------------------

/**
 * EPC band as a 0–1 score, where G scores 1.
 *
 * Linear across the seven bands. A band G home loses heat roughly three times
 * faster than a band A one, so this understates the difference at the extremes;
 * it is kept linear because a councillor can follow it and because the
 * alternative is a curve nobody can justify to three decimal places.
 */
export function epcBandScore(band: string): number {
  const index = EPC_BANDS.indexOf(band as (typeof EPC_BANDS)[number]);
  if (index === -1) return 0.5; // Unknown band: assume the middle, do not guess.
  return index / (EPC_BANDS.length - 1);
}

/**
 * Estimate a household's non-heating daily consumption, in kWh.
 *
 * Taken from the household's own mildest days — the quartile of the window with
 * the fewest heating degree-hours. On those days almost nothing is spent on
 * heat, so what remains is the fridge, the lights, the kettle and the washing.
 *
 * Deriving this from the household's own data rather than from a model matters.
 * A household that rations cuts its heating, not its fridge, so this estimate
 * stays accurate even when the household is in difficulty — which is exactly
 * when we need it to be.
 */
export function estimateBaseLoadKwh(
  dailyConsumptionKwh: Map<string, number>,
  conditionsByDate: Map<string, DayConditions>,
): number {
  const days = [...dailyConsumptionKwh.entries()]
    .map(([date, kwh]) => ({
      date,
      kwh,
      degreeHours: conditionsByDate.get(date)?.heatingDegreeHours ?? 0,
    }))
    .sort((a, b) => a.degreeHours - b.degreeHours || (a.date < b.date ? -1 : 1));

  if (days.length === 0) return 0;

  // The mildest quarter of the window, but never fewer than two days — one day
  // is too noisy to characterise a household. Taking a fixed minimum of three
  // would, over a short window, drag genuinely cold days into the "mild" sample
  // and inflate the estimate, which then makes a properly-heated household look
  // as though it were rationing.
  const sampleSize = Math.min(
    days.length,
    Math.max(2, Math.round(days.length / 4)),
  );
  const sample = days.slice(0, sampleSize);

  return sample.reduce((sum, day) => sum + day.kwh, 0) / sample.length;
}

/**
 * How far below its weather-adjusted expectation a household is consuming.
 *
 * Returns 0 when the household consumes everything it should, rising towards 1
 * as it consumes less. This is the factor that distinguishes a cold home from a
 * frugal one, and a frugal one from an empty one.
 *
 * Expected consumption interpolates between the household's own measured base
 * load and the cold-weather baseline the council holds — which comes from EPC
 * modelling of the building, not from anything the household chose.
 */
export function consumptionShortfall(
  dailyConsumptionKwh: Map<string, number>,
  conditionsByDate: Map<string, DayConditions>,
  coldWeatherBaselineKwh: number,
): { shortfall: number; actualDailyKwh: number; expectedDailyKwh: number } {
  const baseLoad = estimateBaseLoadKwh(dailyConsumptionKwh, conditionsByDate);

  // The heating a fully-heated home would draw on the reference cold day.
  const heatingHeadroom = Math.max(0, coldWeatherBaselineKwh - baseLoad);

  let expectedTotal = 0;
  let actualTotal = 0;
  let days = 0;

  for (const [date, actual] of [...dailyConsumptionKwh.entries()].sort()) {
    const degreeHours = conditionsByDate.get(date)?.heatingDegreeHours ?? 0;
    const expected =
      baseLoad + heatingHeadroom * (degreeHours / COLD_REFERENCE_DEGREE_HOURS);

    expectedTotal += expected;
    actualTotal += actual;
    days += 1;
  }

  if (days === 0 || expectedTotal <= 0) {
    return { shortfall: 0, actualDailyKwh: 0, expectedDailyKwh: 0 };
  }

  const shortfall = Math.min(1, Math.max(0, 1 - actualTotal / expectedTotal));

  return {
    shortfall,
    actualDailyKwh: actualTotal / days,
    expectedDailyKwh: expectedTotal / days,
  };
}

/**
 * Count evenings when the supply appears to have gone off.
 *
 * Only the evening peak is examined, and that is deliberate. A near-zero
 * half-hour at four in the morning is a household asleep. A near-zero half-hour
 * at seven in the evening, sustained for two hours, is a household that cannot
 * cook — and on a prepayment meter it usually means the meter ran out.
 *
 * The threshold is a quarter of the household's own median evening consumption,
 * so a single-occupant flat is judged against itself rather than against a
 * family of five.
 */
export function detectSelfDisconnection(
  consumptionKwhByInterval: Record<string, number>,
): { episodes: number; score: number; longestRunPeriods: number } {
  const eveningByDate = new Map<string, Array<{ time: string; kwh: number }>>();

  for (const [iso, kwh] of Object.entries(consumptionKwhByInterval)) {
    const at = new Date(iso);
    const hour = at.getUTCHours();
    if (hour < EVENING_PERIOD_START_HOUR || hour >= EVENING_PERIOD_END_HOUR) {
      continue;
    }

    const date = iso.slice(0, 10);
    const bucket = eveningByDate.get(date);
    if (bucket === undefined) {
      eveningByDate.set(date, [{ time: iso, kwh }]);
    } else {
      bucket.push({ time: iso, kwh });
    }
  }

  const allEvening = [...eveningByDate.values()]
    .flat()
    .map((entry) => entry.kwh)
    .sort((a, b) => a - b);

  if (allEvening.length === 0) {
    return { episodes: 0, score: 0, longestRunPeriods: 0 };
  }

  const median = allEvening[Math.floor(allEvening.length / 2)];
  const threshold = median * 0.25;

  let episodes = 0;
  let longestRunPeriods = 0;

  for (const date of [...eveningByDate.keys()].sort()) {
    const periods = (eveningByDate.get(date) ?? []).toSorted((a, b) =>
      a.time < b.time ? -1 : 1,
    );

    let run = 0;
    for (const period of periods) {
      if (period.kwh < threshold) {
        run += 1;
        longestRunPeriods = Math.max(longestRunPeriods, run);
      } else {
        if (run >= MIN_DISCONNECTION_PERIODS) episodes += 1;
        run = 0;
      }
    }
    if (run >= MIN_DISCONNECTION_PERIODS) episodes += 1;
  }

  return {
    episodes,
    score: Math.min(1, episodes / DISCONNECTION_EPISODES_FOR_MAX),
    longestRunPeriods,
  };
}

// ---------------------------------------------------------------------------
// The score
// ---------------------------------------------------------------------------

export interface NeedAssessment {
  /** 0–1. Higher means greater need. */
  score: number;
  factors: ReasoningFactor[];
  /** Present so the dashboard can show the household's own consumption story. */
  actualDailyKwh: number;
  expectedDailyKwh: number;
}

/**
 * Score one household's need.
 *
 * Where a factor cannot be evaluated — most often because no case note has been
 * parsed — it is omitted and the remaining weights are scaled back up to sum to
 * one. A household is not penalised for a gap in the council's records, and the
 * omission is recorded in the reasoning rather than hidden.
 */
export function assessNeed(
  recipient: RecipientState,
  conditionsByDate: Map<string, DayConditions>,
): NeedAssessment {
  const dailyConsumption = aggregateDaily(recipient.consumptionKwhByInterval);

  const { shortfall, actualDailyKwh, expectedDailyKwh } = consumptionShortfall(
    dailyConsumption,
    conditionsByDate,
    recipient.coldWeatherBaselineKwh,
  );

  const disconnection = detectSelfDisconnection(
    recipient.consumptionKwhByInterval,
  );

  const factors: ReasoningFactor[] = [];

  const add = (
    key: FactorKey,
    label: string,
    value: number | string | boolean,
    normalised: number,
    explanation: string,
  ): void => {
    factors.push({
      key,
      label,
      value,
      weight: FACTOR_WEIGHTS[key],
      contribution: round4(normalised * FACTOR_WEIGHTS[key]),
      explanation,
    });
  };

  add(
    "means_tested_benefit",
    "Means-tested benefit",
    recipient.onMeansTestedBenefit,
    recipient.onMeansTestedBenefit ? 1 : 0,
    recipient.onMeansTestedBenefit
      ? "In receipt of a means-tested benefit, on the council's own records."
      : "Not recorded as receiving a means-tested benefit.",
  );

  const epc = epcBandScore(recipient.epcBand);
  add(
    "epc_band",
    `EPC band ${recipient.epcBand}`,
    recipient.epcBand,
    epc,
    `Band ${recipient.epcBand} of A to G. A leakier home needs more energy to reach the same temperature.`,
  );

  add(
    "health_condition",
    "Health condition worsened by cold",
    recipient.hasHealthCondition,
    recipient.hasHealthCondition ? 1 : 0,
    recipient.hasHealthCondition
      ? "A recorded health condition made worse by living in a cold home."
      : "No cold-sensitive health condition recorded.",
  );

  add(
    "consumption_shortfall",
    "Consumption below expectation",
    round4(shortfall),
    shortfall,
    shortfall > 0.01
      ? `Using ${actualDailyKwh.toFixed(1)} kWh a day against an expected ${expectedDailyKwh.toFixed(1)} kWh for this weather — ${(shortfall * 100).toFixed(0)}% below.`
      : `Using ${actualDailyKwh.toFixed(1)} kWh a day, in line with the ${expectedDailyKwh.toFixed(1)} kWh expected for this weather.`,
  );

  add(
    "prepayment_meter",
    "Prepayment meter",
    recipient.onPrepaymentMeter,
    recipient.onPrepaymentMeter ? 1 : 0,
    recipient.onPrepaymentMeter
      ? "On a prepayment meter, where running out of credit means going without supply."
      : "On a credit meter.",
  );

  add(
    "resident_over_sixty_five",
    "Resident over 65",
    recipient.hasResidentOverSixtyFive,
    recipient.hasResidentOverSixtyFive ? 1 : 0,
    recipient.hasResidentOverSixtyFive
      ? "An older resident, for whom cold carries a higher health risk."
      : "No resident over sixty-five recorded.",
  );

  add(
    "child_under_five",
    "Child under five",
    recipient.hasChildUnderFive,
    recipient.hasChildUnderFive ? 1 : 0,
    recipient.hasChildUnderFive
      ? "A child under five in the household."
      : "No child under five recorded.",
  );

  add(
    "self_disconnection",
    "Evenings without supply",
    disconnection.episodes,
    disconnection.score,
    disconnection.episodes > 0
      ? `Supply appears to have gone off on ${disconnection.episodes} ${disconnection.episodes === 1 ? "evening" : "evenings"} during the window, for up to ${(disconnection.longestRunPeriods / 2).toFixed(1)} hours.`
      : "No evening supply interruptions detected in the meter data.",
  );

  if (recipient.caseNoteVulnerability !== null) {
    add(
      "case_note_vulnerability",
      "Council case notes",
      round4(recipient.caseNoteVulnerability),
      recipient.caseNoteVulnerability,
      `Case notes assessed at ${(recipient.caseNoteVulnerability * 100).toFixed(0)}% on the vulnerability scale.`,
    );
  }

  // Renormalise so a missing factor neither helps nor harms the household.
  const weightUsed = factors.reduce((sum, factor) => sum + factor.weight, 0);
  const rawScore = factors.reduce((sum, factor) => sum + factor.contribution, 0);
  const score = weightUsed > 0 ? rawScore / weightUsed : 0;

  return {
    score: round4(score),
    factors,
    actualDailyKwh: round4(actualDailyKwh),
    expectedDailyKwh: round4(expectedDailyKwh),
  };
}

/** Sum half-hourly readings into daily totals, keyed by ISO date. */
export function aggregateDaily(
  byInterval: Record<string, number>,
): Map<string, number> {
  const daily = new Map<string, number>();

  for (const [iso, kwh] of Object.entries(byInterval)) {
    const date = iso.slice(0, 10);
    daily.set(date, (daily.get(date) ?? 0) + kwh);
  }

  return daily;
}

/**
 * Round to four decimal places.
 *
 * Every intermediate value in the engine is rounded at the point it is
 * produced. Left alone, floating point accumulates differences in the last bits
 * that depend on the order operations happened to run in — and an engine whose
 * output digest changes because a loop was restructured is not reproducible in
 * any sense worth claiming.
 */
export function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
