/**
 * Solace — assembling the engine's input from the database.
 *
 * This is the boundary between stored state and the pure solver. Everything
 * messy — queries, joins, nulls, dates — happens here, and what crosses into
 * the engine is a plain object with no behaviour and no hidden dependencies.
 *
 * Keeping that boundary sharp is what makes the reproducibility claim testable.
 * The engine can be handed a hand-written input in a test and will behave
 * exactly as it does in production, because there is no other way to reach it.
 */

import {
  HouseholdRole,
  MeterChannel,
  parseJsonColumn,
  type EpcBand,
  type ParsedNeedSignal,
} from "../domain.ts";
import { prisma } from "../db.ts";
import { PROXIMITY_RADIUS_KM, TARIFF_PENCE_PER_KWH } from "../config.ts";
import { SPENT_STATUSES } from "../domain.ts";
import type {
  AllocationInput,
  DayConditions,
  ExporterState,
  RecipientState,
} from "./types.ts";

export interface LoadOptions {
  potReference: string;
  /** Inclusive ISO date, e.g. "2026-08-01". */
  windowStart: string;
  /** Inclusive ISO date. */
  windowEnd: string;
  seed: string;
  /**
   * Pot balance to work within, in pence. Defaults to what the database says
   * is left: confirmed deposits minus everything already settled.
   */
  potBalancePence?: number;
}

/**
 * Build the engine's input.
 *
 * Throws with a readable message if the pot does not exist. Everything else
 * degrades quietly — a household with no readings simply has no demand, and a
 * day with no weather is skipped rather than assumed mild.
 */
export async function loadAllocationInput(
  options: LoadOptions,
): Promise<AllocationInput> {
  const pot = await prisma.pot.findUnique({
    where: { reference: options.potReference },
  });
  if (pot === null) {
    throw new Error(`No pot with reference "${options.potReference}".`);
  }

  const from = new Date(`${options.windowStart}T00:00:00.000Z`);
  // Exclusive upper bound covering the whole of the final day.
  const to = new Date(
    new Date(`${options.windowEnd}T00:00:00.000Z`).getTime() + 86_400_000,
  );

  const [households, readings, weather] = await Promise.all([
    prisma.household.findMany({
      include: {
        needSignals: { orderBy: { recordedAt: "desc" } },
      },
      orderBy: { reference: "asc" },
    }),
    prisma.meterReading.findMany({
      where: { intervalStart: { gte: from, lt: to } },
      orderBy: { intervalStart: "asc" },
    }),
    prisma.weatherObservation.findMany({
      where: { date: { gte: from, lt: to } },
      orderBy: { date: "asc" },
    }),
  ]);

  // Group readings once rather than filtering per household.
  const exportByHousehold = new Map<string, Record<string, number>>();
  const consumptionByHousehold = new Map<string, Record<string, number>>();

  for (const reading of readings) {
    const target =
      reading.channel === MeterChannel.EXPORT
        ? exportByHousehold
        : consumptionByHousehold;

    let series = target.get(reading.householdId);
    if (series === undefined) {
      series = {};
      target.set(reading.householdId, series);
    }
    series[reading.intervalStart.toISOString()] = reading.kwh;
  }

  // Energy already delivered, for the fairness constraint. Only settlements
  // that actually represent spend count.
  const priorAllocations = await prisma.allocation.findMany({
    where: {
      settlement: { status: { in: [...SPENT_STATUSES] } },
      createdAt: { lt: to },
    },
    select: { recipientId: true, kwh: true },
  });

  const servedKwh = new Map<string, number>();
  const servedCount = new Map<string, number>();
  for (const allocation of priorAllocations) {
    servedKwh.set(
      allocation.recipientId,
      (servedKwh.get(allocation.recipientId) ?? 0) + allocation.kwh,
    );
    servedCount.set(
      allocation.recipientId,
      (servedCount.get(allocation.recipientId) ?? 0) + 1,
    );
  }

  const exporters: ExporterState[] = households
    .filter((household) => household.role === HouseholdRole.EXPORTER)
    .map((household) => ({
      reference: household.reference,
      displayName: household.displayName,
      locality: household.locality,
      latitude: household.latitude,
      longitude: household.longitude,
      surplusKwhByInterval: exportByHousehold.get(household.id) ?? {},
    }));

  const recipients: RecipientState[] = households
    .filter((household) => household.role === HouseholdRole.RECIPIENT)
    .map((household) => ({
      reference: household.reference,
      displayName: household.displayName,
      locality: household.locality,
      latitude: household.latitude,
      longitude: household.longitude,

      onMeansTestedBenefit: household.onMeansTestedBenefit ?? false,
      epcBand: (household.epcBand ?? "D") as EpcBand,
      occupants: household.occupants ?? 1,
      hasChildUnderFive: household.hasChildUnderFive ?? false,
      hasResidentOverSixtyFive: household.hasResidentOverSixtyFive ?? false,
      hasHealthCondition: household.hasHealthCondition ?? false,
      onPrepaymentMeter: household.onPrepaymentMeter ?? false,
      coldWeatherBaselineKwh: household.coldWeatherBaselineKwh ?? 0,

      consumptionKwhByInterval: consumptionByHousehold.get(household.id) ?? {},

      caseNoteVulnerability: resolveCaseNoteScore(household.needSignals),

      previouslyServedKwh: round4(servedKwh.get(household.id) ?? 0),
      previouslyServedCount: servedCount.get(household.id) ?? 0,
    }));

  const conditions: DayConditions[] = weather.map((day) => ({
    date: day.date.toISOString().slice(0, 10),
    meanTemperatureC: day.meanTemperatureC,
    heatingDegreeHours: day.heatingDegreeHours,
  }));

  const potBalancePence =
    options.potBalancePence ?? (await currentPotBalancePence(pot.id));

  return {
    potReference: pot.reference,
    windowStart: options.windowStart,
    windowEnd: options.windowEnd,
    seed: options.seed,
    exporters,
    recipients,
    conditions,
    tariffPencePerKwh: TARIFF_PENCE_PER_KWH,
    proximityRadiusKm: PROXIMITY_RADIUS_KM,
    potBalancePence,
  };
}

/**
 * The most recent parsed vulnerability score for a household, or null.
 *
 * Null is meaningful and is passed through as null. It says the council has not
 * had a case note read for this household, and the engine responds by dropping
 * the factor and renormalising rather than scoring the household as
 * un-vulnerable. A gap in the records must not read as evidence of comfort.
 */
function resolveCaseNoteScore(
  signals: Array<{ vulnerabilityScore: number | null; parsedJson: string | null }>,
): number | null {
  for (const signal of signals) {
    if (signal.vulnerabilityScore !== null) return signal.vulnerabilityScore;

    const parsed = parseJsonColumn<ParsedNeedSignal>(signal.parsedJson);
    if (parsed !== null && typeof parsed.vulnerabilityScore === "number") {
      return parsed.vulnerabilityScore;
    }
  }
  return null;
}

/**
 * What the pot has left, in pence: confirmed deposits minus everything settled.
 *
 * Derived rather than stored, so it cannot drift from the ledger it summarises.
 */
export async function currentPotBalancePence(potId: string): Promise<number> {
  const [deposits, spent] = await Promise.all([
    prisma.deposit.aggregate({
      where: { potId, status: { in: [...SPENT_STATUSES] } },
      _sum: { amountPence: true },
    }),
    prisma.allocation.aggregate({
      where: { potId, settlement: { status: { in: [...SPENT_STATUSES] } } },
      _sum: { amountPence: true },
    }),
  ]);

  return (deposits._sum.amountPence ?? 0) - (spent._sum.amountPence ?? 0);
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
