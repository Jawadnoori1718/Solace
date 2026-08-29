/**
 * Solace — gathering the facts a report is built from.
 *
 * Ordinary code, ordinary queries, no model anywhere. This is the half of
 * report generation that must be trustworthy; the writing is the half that must
 * be readable.
 *
 * The reasons attached to repeat recipients come from the allocation engine's
 * own stored reasoning, not from a summary of it. When the report says a
 * household was served eleven times and explains why, that explanation is the
 * engine's, produced at the moment of the decision.
 */

import {
  SPENT_STATUSES,
  SettlementStatus,
  parseJsonColumn,
  type AllocationReasoning,
  type ReportFacts,
} from "../domain.ts";
import { prisma } from "../db.ts";

/** How many times a household must be served before the report explains it. */
const REPEAT_THRESHOLD = 2;

/**
 * Build the facts for a pot.
 *
 * Returns null if the pot does not exist. Every figure is derived from the
 * ledger at the moment of the call.
 */
export async function gatherReportFacts(
  potReference: string,
): Promise<ReportFacts | null> {
  const pot = await prisma.pot.findUnique({ where: { reference: potReference } });
  if (pot === null) return null;

  const settled = { in: [...SPENT_STATUSES] };

  const [deposits, spend, energy, allocations, bounds] = await Promise.all([
    prisma.deposit.aggregate({
      where: { potId: pot.id, status: settled },
      _sum: { amountPence: true },
    }),
    prisma.allocation.aggregate({
      where: { potId: pot.id, settlement: { status: settled } },
      _sum: { amountPence: true },
    }),
    prisma.allocation.aggregate({
      where: { potId: pot.id, settlement: { status: settled } },
      _sum: { kwh: true },
    }),
    prisma.allocation.findMany({
      where: { potId: pot.id, settlement: { status: settled } },
      include: { recipient: true, settlement: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.meterReading.aggregate({
      _min: { intervalStart: true },
      _max: { intervalStart: true },
    }),
  ]);

  const depositedPence = deposits._sum.amountPence ?? 0;
  const spentPence = spend._sum.amountPence ?? 0;
  const totalKwh = round1(energy._sum.kwh ?? 0);

  // Group by household so repeats can be named and explained.
  interface Tally {
    reference: string;
    locality: string;
    timesServed: number;
    kwhReceived: number;
    reason: string;
  }

  const byHousehold = new Map<string, Tally>();

  for (const allocation of allocations) {
    const key = allocation.recipient.reference;
    const entry = byHousehold.get(key) ?? {
      reference: key,
      locality: allocation.recipient.locality,
      timesServed: 0,
      kwhReceived: 0,
      reason: "",
    };

    entry.timesServed += 1;
    entry.kwhReceived += allocation.kwh;

    // Keep the engine's own reasoning from the first decision for this
    // household — the factors that made it a priority in the first place.
    if (entry.reason === "") {
      const reasoning = parseJsonColumn<AllocationReasoning>(
        allocation.reasoningJson,
      );
      if (reasoning !== null) {
        entry.reason = describeReason(reasoning);
      }
    }

    byHousehold.set(key, entry);
  }

  const householdsServed = byHousehold.size;

  const confirmedOnChainCount = allocations.filter(
    (allocation) => allocation.settlement?.status === SettlementStatus.CONFIRMED,
  ).length;

  const backfilledCount = allocations.filter(
    (allocation) => allocation.settlement?.status === SettlementStatus.BACKFILLED,
  ).length;

  const repeatRecipients = [...byHousehold.values()]
    .filter((entry) => entry.timesServed >= REPEAT_THRESHOLD)
    .sort((a, b) => b.timesServed - a.timesServed)
    .map((entry) => ({
      reference: entry.reference,
      locality: entry.locality,
      timesServed: entry.timesServed,
      kwhReceived: round1(entry.kwhReceived),
      reason: entry.reason,
    }));

  return {
    potReference: pot.reference,
    potName: pot.name,
    councilName: pot.councilName,
    fundingSource: pot.fundingSource,

    periodStart: isoDate(bounds._min.intervalStart),
    periodEnd: isoDate(bounds._max.intervalStart),

    depositedPence,
    spentPence,
    remainingPence: depositedPence - spentPence,

    totalKwh,
    householdsServed,
    averageKwhPerHousehold:
      householdsServed > 0 ? round1(totalKwh / householdsServed) : 0,
    averagePencePerHousehold:
      householdsServed > 0 ? Math.round(spentPence / householdsServed) : 0,

    confirmedOnChainCount,
    backfilledCount,
    repeatRecipients,
  };
}

/**
 * Turn stored reasoning into one sentence a report can quote.
 *
 * Assembled by ordinary code from the engine's own factors, so the explanation
 * in the report is the explanation the engine recorded, not a paraphrase of it.
 */
function describeReason(reasoning: AllocationReasoning): string {
  const top = [...reasoning.factors]
    .sort((a, b) => b.contribution - a.contribution)
    .filter((factor) => factor.contribution > 0)
    .slice(0, 3)
    .map((factor) => factor.label.toLowerCase());

  if (top.length === 0) {
    return `The engine scored this household ${reasoning.needScore.toFixed(2)} on need.`;
  }

  return (
    `The engine scored this household ${reasoning.needScore.toFixed(2)} on need, ` +
    `mainly because of ${top.join(", ")}.`
  );
}

function isoDate(date: Date | null): string {
  return date === null
    ? "unknown"
    : date.toISOString().slice(0, 10);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
