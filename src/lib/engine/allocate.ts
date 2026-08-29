/**
 * Solace — the allocation engine.
 *
 * A deterministic, need-weighted greedy solver. Given the same input it
 * produces byte-identical output, every time, on any machine. No language model
 * is consulted, no clock is read, no network call is made, and no random number
 * is drawn that is not derived from the run's seed.
 *
 * HOW IT DECIDES
 *
 * 1. Score every recipient's need once, from council records and meter data.
 *    See `scoring.ts` for the nine factors and their published weights.
 *
 * 2. Walk the window one day at a time, and within each day one half-hourly
 *    settlement period at a time.
 *
 * 3. In each period, for each exporting household with surplus, rank the
 *    recipients that are (a) within the proximity radius and (b) actually
 *    drawing electricity in that same period. Offer the surplus to the highest
 *    priority first, then the next, until it runs out.
 *
 * 4. Priority is need multiplied by a fairness factor that decays with what the
 *    household has already received, updated continuously as the run proceeds.
 *
 * WHY CONCURRENT DEMAND MATTERS
 *
 * Step 3(b) is the constraint that keeps this honest. Surplus generated at two
 * in the afternoon cannot warm a house at eight in the evening — not without
 * storage, which this pilot does not have. So a household is only matched
 * against surplus it could actually have used at that moment. It makes the
 * numbers smaller and the claim true.
 */

import { distanceKm } from "../geo.ts";
import { toJsonColumn, type AllocationReasoning } from "../domain.ts";
import { createRng } from "../synthetic/rng.ts";
import { digest } from "./digest.ts";
import { fairnessMultiplier, fairnessNote } from "./fairness.ts";
import { assessNeed, round4, type NeedAssessment } from "./scoring.ts";
import type {
  AllocationDecision,
  AllocationInput,
  AllocationResult,
  DayConditions,
  ExporterState,
  NeedSummary,
  RecipientState,
  UnservedRecipient,
} from "./types.ts";

/**
 * Bumped whenever a change could alter a decision.
 *
 * Recorded against every run, so a decision made last winter can be explained
 * with the rules that were actually in force at the time rather than the rules
 * in force now.
 */
export const ENGINE_VERSION = "1.0.0";

/**
 * Below this, an allocation is not worth making, in kWh.
 *
 * Without a floor the solver produces thousands of allocations of a hundredth
 * of a kilowatt-hour, each costing a fraction of a penny and each requiring its
 * own on-chain transaction. The dust would cost more to settle than it is
 * worth, and would bury the meaningful decisions in a feed nobody can read.
 */
export const MIN_ALLOCATION_KWH = 0.05;

/**
 * The need score below which a household is not eligible for support.
 *
 * This is a policy threshold, not a technical one, and it belongs here for a
 * reason that only became clear once the engine ran against real data.
 *
 * Surplus is scarce across a month but not within a sunny afternoon. At midday
 * three arrays produce more than the nearby households are drawing at that
 * moment, so ranking by need decided only the ORDER in which households were
 * served, not whether they were — and everyone in range ended up served. The
 * comfortable household with no benefits, a band C flat and no health condition
 * was receiving fuel poverty support alongside a pensioner self-disconnecting
 * on a prepayment meter.
 *
 * That is not a scarcity problem to be tuned away. It is a question about who a
 * fuel poverty fund is for, and every such fund already answers it: the
 * Household Support Fund, the Warm Home Discount and ECO4 all have eligibility
 * criteria. Solace has one too, it is a single published number, and a council
 * can move it.
 */
export const NEED_ELIGIBILITY_THRESHOLD = 0.35;

/**
 * Allocate surplus to households.
 *
 * Pure. Depends on nothing but its argument.
 */
export function allocate(input: AllocationInput): AllocationResult {
  const notes: string[] = [];

  const conditionsByDate = new Map<string, DayConditions>(
    input.conditions.map((day) => [day.date, day]),
  );

  // Deterministic ordering throughout. Sorting by reference gives a stable
  // sequence; the seeded tie-break below is what stops that stability turning
  // into systematic favouritism.
  const exporters = [...input.exporters].sort(byReference);
  const recipients = [...input.recipients].sort(byReference);

  const tieBreak = buildTieBreak(input.seed, recipients);

  // Need is assessed once per run, over the whole window. It describes a
  // household's situation, and that does not change between Tuesday and
  // Wednesday. Fairness is what moves during the run.
  const needs = new Map<string, NeedAssessment>();
  for (const recipient of recipients) {
    needs.set(recipient.reference, assessNeed(recipient, conditionsByDate));
  }

  // Eligibility is decided once, before any energy moves, and published for
  // every household whether it is met or not.
  const eligible = new Set<string>();
  const assessments: NeedSummary[] = recipients.map((recipient) => {
    const need = needs.get(recipient.reference);
    const score = need?.score ?? 0;
    const isEligible = score >= NEED_ELIGIBILITY_THRESHOLD;
    if (isEligible) eligible.add(recipient.reference);

    return {
      recipientReference: recipient.reference,
      needScore: score,
      eligible: isEligible,
      ineligibleReason: isEligible
        ? null
        : `Need score ${score.toFixed(2)} is below the ${NEED_ELIGIBILITY_THRESHOLD} threshold this fund applies. ` +
          `Fuel poverty support is targeted at households in difficulty, and on the council's records this household is not one.`,
      actualDailyKwh: need?.actualDailyKwh ?? 0,
      expectedDailyKwh: need?.expectedDailyKwh ?? 0,
    };
  });

  // Running state.
  const servedKwh = new Map<string, number>();
  const servedCount = new Map<string, number>();
  for (const recipient of recipients) {
    servedKwh.set(recipient.reference, recipient.previouslyServedKwh);
    servedCount.set(recipient.reference, recipient.previouslyServedCount);
  }

  const decisions: AllocationDecision[] = [];
  let spentPence = 0;
  let unallocatedKwh = 0;
  let potExhausted = false;

  const dates = collectDates(input, conditionsByDate);

  for (const date of dates) {
    if (potExhausted) break;

    // Fairness as it stood at the start of the day. Captured here so that every
    // allocation made on this day is explained by the same figure, which is
    // what a reader expects when they see a date.
    const fairnessAtDayStart = new Map<string, number>();
    const servedAtDayStart = new Map<string, number>();
    const countAtDayStart = new Map<string, number>();
    for (const recipient of recipients) {
      const served = servedKwh.get(recipient.reference) ?? 0;
      servedAtDayStart.set(recipient.reference, served);
      countAtDayStart.set(recipient.reference, servedCount.get(recipient.reference) ?? 0);
      fairnessAtDayStart.set(recipient.reference, fairnessMultiplier(served));
    }

    /** kWh matched today, keyed "exporter|recipient". */
    const dayTotals = new Map<string, number>();
    /** The rank each pair achieved when it was first matched today. */
    const dayRank = new Map<string, number>();

    for (const interval of intervalsForDate(date, exporters, recipients)) {
      /** How much of each recipient's demand this period is already spoken for. */
      const claimed = new Map<string, number>();

      for (const exporter of exporters) {
        let surplus = round4(exporter.surplusKwhByInterval[interval] ?? 0);
        if (surplus < MIN_ALLOCATION_KWH) continue;

        const candidates = recipients
          .map((recipient) => {
            const distance = distanceKm(exporter, recipient);
            const demand = recipient.consumptionKwhByInterval[interval] ?? 0;
            const alreadyClaimed = claimed.get(recipient.reference) ?? 0;
            const need = needs.get(recipient.reference);

            return {
              recipient,
              distance,
              unmetDemand: round4(demand - alreadyClaimed),
              priority: round4(
                (need?.score ?? 0) *
                  (fairnessMultiplier(servedKwh.get(recipient.reference) ?? 0)),
              ),
            };
          })
          .filter(
            (candidate) =>
              eligible.has(candidate.recipient.reference) &&
              candidate.distance <= input.proximityRadiusKm &&
              candidate.unmetDemand >= MIN_ALLOCATION_KWH,
          )
          .sort(
            (a, b) =>
              b.priority - a.priority ||
              tieBreak(a.recipient.reference) - tieBreak(b.recipient.reference),
          );

        for (const [position, candidate] of candidates.entries()) {
          if (surplus < MIN_ALLOCATION_KWH) break;

          const take = round4(Math.min(surplus, candidate.unmetDemand));
          if (take < MIN_ALLOCATION_KWH) continue;

          const key = `${exporter.reference}|${candidate.recipient.reference}`;
          dayTotals.set(key, round4((dayTotals.get(key) ?? 0) + take));
          if (!dayRank.has(key)) dayRank.set(key, position + 1);

          claimed.set(
            candidate.recipient.reference,
            round4((claimed.get(candidate.recipient.reference) ?? 0) + take),
          );
          servedKwh.set(
            candidate.recipient.reference,
            round4((servedKwh.get(candidate.recipient.reference) ?? 0) + take),
          );

          surplus = round4(surplus - take);
        }

        // Surplus with nowhere to go: nobody nearby was drawing power at that
        // moment. Recorded rather than discarded, because it is the honest
        // measure of what a pilot this size cannot reach.
        if (surplus >= MIN_ALLOCATION_KWH) {
          unallocatedKwh = round4(unallocatedKwh + surplus);
        }
      }
    }

    // Turn the day's matching into decisions, cheapest arithmetic last.
    const dayDecisions: AllocationDecision[] = [];

    for (const key of [...dayTotals.keys()].sort()) {
      const kwh = round4(dayTotals.get(key) ?? 0);
      if (kwh < MIN_ALLOCATION_KWH) continue;

      const [exporterReference, recipientReference] = key.split("|");
      const exporter = exporters.find((e) => e.reference === exporterReference);
      const recipient = recipients.find((r) => r.reference === recipientReference);
      const need = needs.get(recipientReference);
      if (exporter === undefined || recipient === undefined || need === undefined) {
        continue;
      }

      const amountPence = Math.round(kwh * input.tariffPencePerKwh);
      if (amountPence <= 0) continue;

      const multiplier = fairnessAtDayStart.get(recipientReference) ?? 1;
      const servedBefore = servedAtDayStart.get(recipientReference) ?? 0;
      const timesBefore = countAtDayStart.get(recipientReference) ?? 0;

      const reasoning: AllocationReasoning = {
        engineVersion: ENGINE_VERSION,
        needScore: need.score,
        fairnessMultiplier: round4(multiplier),
        priorityScore: round4(need.score * multiplier),
        factors: need.factors,
        proximity: {
          exporterReference,
          distanceKm: round4(distanceKm(exporter, recipient)),
          withinRadiusKm: input.proximityRadiusKm,
        },
        fairness: {
          kwhAlreadyReceived: round4(servedBefore),
          timesServed: timesBefore,
          note: fairnessNote(servedBefore, timesBefore, multiplier),
        },
        summary: buildSummary({
          recipient,
          exporter,
          date,
          kwh,
          amountPence,
          need,
          multiplier,
          servedBefore,
          rank: dayRank.get(key) ?? 1,
        }),
      };

      dayDecisions.push({
        id: `alloc_${date}_${exporterReference}_${recipientReference}`,
        date,
        exporterReference,
        recipientReference,
        kwh,
        milliKwh: Math.round(kwh * 1000),
        pencePerKwh: input.tariffPencePerKwh,
        amountPence,
        rank: dayRank.get(key) ?? 1,
        reasoning,
      });
    }

    // The pot is a hard limit. If today's decisions would breach it, drop them
    // from the least urgent upwards until they fit, and say so.
    dayDecisions.sort((a, b) => a.rank - b.rank || (a.id < b.id ? -1 : 1));

    for (const decision of dayDecisions) {
      if (spentPence + decision.amountPence > input.potBalancePence) {
        potExhausted = true;
        notes.push(
          `The pot was exhausted on ${date}. Allocations from that point were not made.`,
        );
        break;
      }

      spentPence += decision.amountPence;
      decisions.push(decision);
      servedCount.set(
        decision.recipientReference,
        (servedCount.get(decision.recipientReference) ?? 0) + 1,
      );
    }
  }

  // Renumber ranks across the whole run, so rank 1 is the run's neediest match
  // rather than the first day's.
  const ordered = [...decisions].sort(
    (a, b) =>
      b.reasoning.priorityScore - a.reasoning.priorityScore ||
      (a.id < b.id ? -1 : 1),
  );
  ordered.forEach((decision, index) => {
    decision.rank = index + 1;
  });

  const unserved = explainUnserved(
    recipients,
    exporters,
    decisions,
    input,
    needs,
    assessments,
  );

  const totalKwh = round4(
    decisions.reduce((sum, decision) => sum + decision.kwh, 0),
  );

  return {
    engineVersion: ENGINE_VERSION,
    potReference: input.potReference,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    seed: input.seed,
    decisions,
    unserved,
    assessments,
    totalKwh,
    totalPence: spentPence,
    inputDigest: digest(input),
    outputDigest: digest(decisions),
    unallocatedKwh,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function byReference(a: { reference: string }, b: { reference: string }): number {
  return a.reference < b.reference ? -1 : a.reference > b.reference ? 1 : 0;
}

/**
 * A stable, seeded ordering used only to break exact ties.
 *
 * Ties are rare but not negligible, and resolving them alphabetically would
 * mean REC-01 quietly winning every one of them for the lifetime of the
 * system. A seeded permutation is just as reproducible and has no such bias.
 */
function buildTieBreak(
  seed: string,
  recipients: RecipientState[],
): (reference: string) => number {
  const order = new Map<string, number>();

  for (const recipient of recipients) {
    order.set(
      recipient.reference,
      createRng(`${seed}:tiebreak:${recipient.reference}`).next(),
    );
  }

  return (reference: string) => order.get(reference) ?? 0;
}

/** Every date in the window that has data, in order. */
function collectDates(
  input: AllocationInput,
  conditionsByDate: Map<string, DayConditions>,
): string[] {
  const dates = new Set<string>();

  for (const exporter of input.exporters) {
    for (const iso of Object.keys(exporter.surplusKwhByInterval)) {
      dates.add(iso.slice(0, 10));
    }
  }

  return [...dates]
    .filter(
      (date) =>
        date >= input.windowStart &&
        date <= input.windowEnd &&
        conditionsByDate.has(date),
    )
    .sort();
}

/** Every half-hourly interval on a date for which anyone has data, in order. */
function intervalsForDate(
  date: string,
  exporters: ExporterState[],
  recipients: RecipientState[],
): string[] {
  const intervals = new Set<string>();

  for (const exporter of exporters) {
    for (const iso of Object.keys(exporter.surplusKwhByInterval)) {
      if (iso.startsWith(date)) intervals.add(iso);
    }
  }
  for (const recipient of recipients) {
    for (const iso of Object.keys(recipient.consumptionKwhByInterval)) {
      if (iso.startsWith(date)) intervals.add(iso);
    }
  }

  return [...intervals].sort();
}

/**
 * Say why each unserved household received nothing.
 *
 * An accountability system that explains only its positive decisions is half a
 * system. The household that got nothing is the one most likely to ask.
 */
function explainUnserved(
  recipients: RecipientState[],
  exporters: ExporterState[],
  decisions: AllocationDecision[],
  input: AllocationInput,
  needs: Map<string, NeedAssessment>,
  assessments: NeedSummary[],
): UnservedRecipient[] {
  const served = new Set(decisions.map((d) => d.recipientReference));
  const assessmentByReference = new Map(
    assessments.map((assessment) => [assessment.recipientReference, assessment]),
  );
  const unserved: UnservedRecipient[] = [];

  for (const recipient of recipients) {
    if (served.has(recipient.reference)) continue;

    const assessment = assessmentByReference.get(recipient.reference);
    if (assessment !== undefined && !assessment.eligible) {
      unserved.push({
        recipientReference: recipient.reference,
        reason: assessment.ineligibleReason ?? "Below the eligibility threshold.",
      });
      continue;
    }

    const nearest = Math.min(
      ...exporters.map((exporter) => distanceKm(exporter, recipient)),
    );

    if (nearest > input.proximityRadiusKm) {
      unserved.push({
        recipientReference: recipient.reference,
        reason: `No exporting household within ${input.proximityRadiusKm} km. The nearest is ${nearest.toFixed(1)} km away.`,
      });
      continue;
    }

    const score = needs.get(recipient.reference)?.score ?? 0;
    unserved.push({
      recipientReference: recipient.reference,
      reason:
        `Eligible and within range, but its need score of ${score.toFixed(2)} placed it ` +
        `below other households every time surplus was available.`,
    });
  }

  return unserved.sort((a, b) =>
    a.recipientReference < b.recipientReference ? -1 : 1,
  );
}

/**
 * Assemble the plain-English summary attached to a decision.
 *
 * Written by ordinary code from the same numbers the decision used. No model is
 * involved, so the sentence cannot say anything the arithmetic does not.
 */
function buildSummary(args: {
  recipient: RecipientState;
  exporter: ExporterState;
  date: string;
  kwh: number;
  amountPence: number;
  need: NeedAssessment;
  multiplier: number;
  servedBefore: number;
  rank: number;
}): string {
  const { recipient, exporter, kwh, amountPence, need, multiplier, servedBefore } =
    args;

  // The three factors that contributed most, named in order.
  const top = [...need.factors]
    .sort((a, b) => b.contribution - a.contribution)
    .filter((factor) => factor.contribution > 0)
    .slice(0, 3)
    .map((factor) => factor.label.toLowerCase());

  const drivers =
    top.length > 0
      ? `Need was driven mainly by ${listPhrase(top)}.`
      : "No need factors registered for this household.";

  const fairnessClause =
    servedBefore > 0
      ? ` Its priority was reduced by ${Math.round((1 - multiplier) * 100)}% because it had already received ${servedBefore.toFixed(1)} kWh.`
      : "";

  return (
    `${kwh.toFixed(1)} kWh of surplus from ${exporter.displayName} was directed to ` +
    `${recipient.displayName}, costing ${(amountPence / 100).toFixed(2)} pounds. ` +
    `The household scored ${need.score.toFixed(2)} on need. ${drivers}${fairnessClause}`
  );
}

/** "a, b and c" */
function listPhrase(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Serialise reasoning for the database's JSON column. */
export function serialiseReasoning(reasoning: AllocationReasoning): string {
  return toJsonColumn(reasoning);
}
