/**
 * Solace — everything the dashboard reads.
 *
 * All of it runs on the server, and all of it is written so that a missing
 * database, an unseeded one, or an unreachable chain produces a value the
 * interface can render rather than an exception it cannot. The demonstration
 * degrades; it does not break.
 *
 * The pot balance is derived here from deposits minus settlements rather than
 * read from a stored column, so the headline figure cannot drift from the
 * ledger it claims to summarise.
 */

import "server-only";

import { ACTIVE_CHAIN, EXPORT_PENCE_PER_KWH, explorerTxUrl } from "../config.ts";
import {
  HouseholdRole,
  MeterChannel,
  SettlementStatus,
  SPENT_STATUSES,
  parseJsonColumn,
  toChainName,
  type AllocationReasoning,
} from "../domain.ts";
import { chainIsReachable } from "../chain/client.ts";
import { onChainPotBalancePence } from "../settlement/service.ts";
import { prisma } from "../db.ts";
import { DEMO_POT } from "../synthetic/households.ts";

// ---------------------------------------------------------------------------
// The pot
// ---------------------------------------------------------------------------

export interface PotOverview {
  reference: string;
  name: string;
  councilName: string;
  fundingSource: string;

  depositedPence: number;
  spentPence: number;
  balancePence: number;
  /** 0–1. How much of the pot has been committed. */
  spentFraction: number;

  totalKwh: number;
  householdsServed: number;
  householdsAssessed: number;

  settlementsConfirmed: number;
  settlementsFailed: number;
  settlementsTotal: number;

  windowStart: Date | null;
  windowEnd: Date | null;

  /** What the same kilowatt-hours would have earned exported to the grid. */
  gridValuePence: number;

  contract: {
    chain: string;
    address: string | null;
    explorerUrl: string | null;
  };

  /** The most recent confirmed settlement, for the explorer link. */
  latestSettlement: {
    txHash: string;
    explorerUrl: string | null;
    chain: string;
    confirmedAt: Date | null;
  } | null;
}

/**
 * Load the headline figures.
 *
 * Returns null when there is no pot, which happens on a fresh clone before the
 * seed has run. The page renders an explanation rather than an error.
 */
export async function getPotOverview(): Promise<PotOverview | null> {
  const pot = await prisma.pot.findUnique({
    where: { reference: DEMO_POT.reference },
  });
  if (pot === null) return null;

  const spentFilter = { in: [...SPENT_STATUSES] };

  const [
    deposits,
    spend,
    energy,
    servedHouseholds,
    assessedHouseholds,
    statusCounts,
    readingBounds,
    deployment,
    latest,
  ] = await Promise.all([
    prisma.deposit.aggregate({
      where: { potId: pot.id, status: spentFilter },
      _sum: { amountPence: true },
    }),
    prisma.allocation.aggregate({
      where: { potId: pot.id, settlement: { status: spentFilter } },
      _sum: { amountPence: true },
    }),
    prisma.allocation.aggregate({
      where: { potId: pot.id, settlement: { status: spentFilter } },
      _sum: { kwh: true },
    }),
    prisma.allocation.findMany({
      where: { potId: pot.id, settlement: { status: spentFilter } },
      distinct: ["recipientId"],
      select: { recipientId: true },
    }),
    prisma.household.count({ where: { role: HouseholdRole.RECIPIENT } }),
    prisma.settlement.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.meterReading.aggregate({
      _min: { intervalStart: true },
      _max: { intervalStart: true },
    }),
    prisma.contractDeployment.findUnique({
      where: { chain_name: { chain: ACTIVE_CHAIN, name: "SolacePound" } },
    }),
    prisma.settlement.findFirst({
      where: { status: SettlementStatus.CONFIRMED, txHash: { not: null } },
      orderBy: [{ confirmedAt: "desc" }, { createdAt: "desc" }],
    }),
  ]);

  const depositedPence = deposits._sum.amountPence ?? 0;
  const spentPence = spend._sum.amountPence ?? 0;
  const totalKwh = energy._sum.kwh ?? 0;

  const counted = (status: string): number =>
    statusCounts.find((row) => row.status === status)?._count._all ?? 0;

  return {
    reference: pot.reference,
    name: pot.name,
    councilName: pot.councilName,
    fundingSource: pot.fundingSource,

    depositedPence,
    spentPence,
    balancePence: depositedPence - spentPence,
    spentFraction: depositedPence > 0 ? spentPence / depositedPence : 0,

    totalKwh,
    householdsServed: servedHouseholds.length,
    householdsAssessed: assessedHouseholds,

    settlementsConfirmed: counted(SettlementStatus.CONFIRMED),
    settlementsFailed: counted(SettlementStatus.FAILED),
    settlementsTotal: statusCounts.reduce((sum, row) => sum + row._count._all, 0),

    windowStart: readingBounds._min.intervalStart,
    windowEnd: readingBounds._max.intervalStart,

    gridValuePence: Math.round(totalKwh * EXPORT_PENCE_PER_KWH),

    contract: {
      chain: ACTIVE_CHAIN,
      address: deployment?.address ?? null,
      explorerUrl: deployment?.explorerUrl ?? null,
    },

    latestSettlement:
      latest === null || latest.txHash === null
        ? null
        : {
            txHash: latest.txHash,
            explorerUrl:
              latest.explorerUrl ??
              explorerTxUrl(toChainName(latest.chain), latest.txHash),
            chain: latest.chain,
            confirmedAt: latest.confirmedAt,
          },
  };
}

// ---------------------------------------------------------------------------
// Allocations
// ---------------------------------------------------------------------------

export interface AllocationRow {
  id: string;
  date: Date;
  kwh: number;
  amountPence: number;
  rank: number;

  exporter: { reference: string; displayName: string; locality: string };
  recipient: { reference: string; displayName: string; locality: string };

  reasoning: AllocationReasoning | null;

  settlement: {
    status: string;
    chain: string;
    txHash: string | null;
    explorerUrl: string | null;
    failureReason: string | null;
  } | null;
}

/** The most recent allocations, newest first. */
export async function getRecentAllocations(limit = 25): Promise<AllocationRow[]> {
  const rows = await prisma.allocation.findMany({
    orderBy: [{ createdAt: "desc" }, { rank: "asc" }],
    take: limit,
    include: { exporter: true, recipient: true, settlement: true },
  });

  return rows.map((row) => ({
    id: row.id,
    date: row.createdAt,
    kwh: row.kwh,
    amountPence: row.amountPence,
    rank: row.rank,
    exporter: {
      reference: row.exporter.reference,
      displayName: row.exporter.displayName,
      locality: row.exporter.locality,
    },
    recipient: {
      reference: row.recipient.reference,
      displayName: row.recipient.displayName,
      locality: row.recipient.locality,
    },
    reasoning: parseJsonColumn<AllocationReasoning>(row.reasoningJson),
    settlement:
      row.settlement === null
        ? null
        : {
            status: row.settlement.status,
            chain: row.settlement.chain,
            txHash: row.settlement.txHash,
            explorerUrl:
              row.settlement.explorerUrl ??
              explorerTxUrl(
                toChainName(row.settlement.chain),
                row.settlement.txHash,
              ),
            failureReason: row.settlement.failureReason,
          },
  }));
}

// ---------------------------------------------------------------------------
// Households
// ---------------------------------------------------------------------------

export interface HouseholdRow {
  reference: string;
  displayName: string;
  locality: string;
  epcBand: string | null;
  onPrepaymentMeter: boolean;
  hasHealthCondition: boolean;
  onMeansTestedBenefit: boolean;

  needScore: number | null;
  kwhReceived: number;
  pencePaid: number;
  timesServed: number;
  /** Delivered energy as a share of everything the household consumed. */
  shareOfConsumption: number | null;
}

/**
 * Every recipient household, whether or not it was served.
 *
 * Households that received nothing appear too, with a zero. A dashboard that
 * lists only the served households cannot answer the question a councillor will
 * actually ask, which is who was left out.
 */
export async function getHouseholds(): Promise<HouseholdRow[]> {
  // The run's assessments cover every household, including the ones it decided
  // against. Allocations only carry a score for households that were served, so
  // without this a household that received nothing would show no need score —
  // which reads as "we never looked", rather than "we looked and said no".
  const run = await prisma.allocationRun.findFirst({
    orderBy: { createdAt: "desc" },
    select: { assessmentsJson: true },
  });

  const assessedScore = new Map<string, number>(
    (parseJsonColumn<NeedSummaryRow[]>(run?.assessmentsJson ?? null) ?? []).map(
      (assessment) => [assessment.recipientReference, assessment.needScore],
    ),
  );

  const households = await prisma.household.findMany({
    where: { role: HouseholdRole.RECIPIENT },
    orderBy: { reference: "asc" },
    include: {
      allocationsReceived: {
        where: { settlement: { status: { in: [...SPENT_STATUSES] } } },
        select: { kwh: true, amountPence: true, reasoningJson: true },
      },
      readings: {
        where: { channel: MeterChannel.CONSUMPTION },
        select: { kwh: true },
      },
    },
  });

  return households.map((household) => {
    const received = household.allocationsReceived;
    const kwhReceived = received.reduce((sum, row) => sum + row.kwh, 0);
    const consumed = household.readings.reduce((sum, row) => sum + row.kwh, 0);

    // The need score is identical across a household's allocations within a
    // run, so the first one is representative.
    const reasoning = parseJsonColumn<AllocationReasoning>(
      received[0]?.reasoningJson ?? null,
    );

    return {
      reference: household.reference,
      displayName: household.displayName,
      locality: household.locality,
      epcBand: household.epcBand,
      onPrepaymentMeter: household.onPrepaymentMeter ?? false,
      hasHealthCondition: household.hasHealthCondition ?? false,
      onMeansTestedBenefit: household.onMeansTestedBenefit ?? false,

      needScore:
        assessedScore.get(household.reference) ?? reasoning?.needScore ?? null,
      kwhReceived,
      pencePaid: received.reduce((sum, row) => sum + row.amountPence, 0),
      timesServed: received.length,
      shareOfConsumption: consumed > 0 ? kwhReceived / consumed : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Whether the system is actually working
// ---------------------------------------------------------------------------

export interface SystemHealth {
  chainReachable: boolean;
  contractDeployed: boolean;
  /** What the chain says is left in the pot, or null if it could not be read. */
  onChainBalancePence: number | null;
  /** What the local ledger says is left. */
  localBalancePence: number;
  /** True when the two agree. A mismatch is worth showing, not hiding. */
  ledgerAgrees: boolean;
  /** Plain-English problems, if any. */
  problems: string[];
}

/**
 * Check the system against itself before drawing anything.
 *
 * The pot balance is computed twice by entirely different means — once by
 * summing database rows, once by reading contract storage. Showing a figure
 * without saying which source it came from, or without noticing that the two
 * disagree, would undermine the only thing this dashboard is for.
 *
 * Never throws. An unreachable chain is a fact to report, not an exception.
 */
export async function getSystemHealth(): Promise<SystemHealth> {
  const problems: string[] = [];

  const pot = await prisma.pot.findUnique({
    where: { reference: DEMO_POT.reference },
  });

  if (pot === null) {
    return {
      chainReachable: false,
      contractDeployed: false,
      onChainBalancePence: null,
      localBalancePence: 0,
      ledgerAgrees: true,
      problems: ["No pot has been set up yet."],
    };
  }

  const [deposits, spend, deployment] = await Promise.all([
    prisma.deposit.aggregate({
      where: { potId: pot.id, status: { in: [...SPENT_STATUSES] } },
      _sum: { amountPence: true },
    }),
    prisma.allocation.aggregate({
      where: { potId: pot.id, settlement: { status: { in: [...SPENT_STATUSES] } } },
      _sum: { amountPence: true },
    }),
    prisma.contractDeployment.findUnique({
      where: { chain_name: { chain: ACTIVE_CHAIN, name: "SolacePound" } },
    }),
  ]);

  const localBalancePence =
    (deposits._sum.amountPence ?? 0) - (spend._sum.amountPence ?? 0);

  const contractDeployed = deployment !== null;
  if (!contractDeployed) {
    problems.push(
      `SolacePound is not deployed on ${ACTIVE_CHAIN}. Settlement is unavailable until it is.`,
    );
  }

  const chainReachable = await chainIsReachable();
  if (!chainReachable) {
    problems.push(
      "The chain could not be reached. The figures below come from the local ledger; settlement is paused until it returns.",
    );
  }

  let onChainBalancePence: number | null = null;
  if (chainReachable && contractDeployed) {
    onChainBalancePence = await onChainPotBalancePence(pot.reference);
  }

  const ledgerAgrees =
    onChainBalancePence === null || onChainBalancePence === localBalancePence;

  if (!ledgerAgrees) {
    problems.push(
      `The chain reports a pot balance of ${onChainBalancePence} pence but the local ledger says ${localBalancePence}. ` +
        `The most likely cause is the chain having been restarted since the pot was funded.`,
    );
  }

  return {
    chainReachable,
    contractDeployed,
    onChainBalancePence,
    localBalancePence,
    ledgerAgrees,
    problems,
  };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export interface NeedSummaryRow {
  recipientReference: string;
  needScore: number;
  eligible: boolean;
  ineligibleReason: string | null;
  actualDailyKwh: number;
  expectedDailyKwh: number;
}

export interface UnservedRow {
  recipientReference: string;
  reason: string;
}

export interface RunSummary {
  engineVersion: string;
  seed: string;
  inputDigest: string;
  outputDigest: string;
  windowStart: Date;
  windowEnd: Date;
  unallocatedKwh: number | null;
  assessments: NeedSummaryRow[];
  unserved: UnservedRow[];
  decisionCount: number;
}

/**
 * The most recent allocation run, with its published assessments.
 *
 * This is what lets the dashboard explain the households it decided against.
 * Returns null before the engine has been run.
 */
export async function getLatestRun(): Promise<RunSummary | null> {
  const run = await prisma.allocationRun.findFirst({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { allocations: true } } },
  });
  if (run === null) return null;

  return {
    engineVersion: run.engineVersion,
    seed: run.seed,
    inputDigest: run.inputDigest,
    outputDigest: run.outputDigest,
    windowStart: run.windowStart,
    windowEnd: run.windowEnd,
    unallocatedKwh: run.unallocatedKwh,
    assessments:
      parseJsonColumn<NeedSummaryRow[]>(run.assessmentsJson) ?? [],
    unserved: parseJsonColumn<UnservedRow[]>(run.unservedJson) ?? [],
    decisionCount: run._count.allocations,
  };
}

/** Allocations decided but not yet settled. */
export async function getPendingCount(): Promise<number> {
  return prisma.allocation.count({
    where: {
      OR: [
        { settlement: null },
        { settlement: { status: SettlementStatus.FAILED } },
      ],
    },
  });
}

// ---------------------------------------------------------------------------
// The balance over time
// ---------------------------------------------------------------------------

export interface BalancePoint {
  /** ISO date. */
  date: string;
  /** What remained in the pot at the end of that day, in pence. */
  balancePence: number;
  /** Energy delivered that day, in kWh. */
  deliveredKwh: number;
  /** Spent that day, in pence. */
  spentPence: number;
}

/**
 * The pot draining, day by day.
 *
 * Built by walking settled allocations in date order and subtracting. The
 * series therefore reconciles exactly with the headline balance, because it is
 * the same arithmetic run cumulatively.
 */
export async function getBalanceSeries(): Promise<BalancePoint[]> {
  const pot = await prisma.pot.findUnique({
    where: { reference: DEMO_POT.reference },
  });
  if (pot === null) return [];

  const [deposits, allocations] = await Promise.all([
    prisma.deposit.aggregate({
      where: { potId: pot.id, status: { in: [...SPENT_STATUSES] } },
      _sum: { amountPence: true },
    }),
    prisma.allocation.findMany({
      where: { potId: pot.id, settlement: { status: { in: [...SPENT_STATUSES] } } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true, kwh: true, amountPence: true },
    }),
  ]);

  const opening = deposits._sum.amountPence ?? 0;
  if (allocations.length === 0) return [];

  const byDate = new Map<string, { kwh: number; pence: number }>();
  for (const allocation of allocations) {
    const date = allocation.createdAt.toISOString().slice(0, 10);
    const entry = byDate.get(date) ?? { kwh: 0, pence: 0 };
    entry.kwh += allocation.kwh;
    entry.pence += allocation.amountPence;
    byDate.set(date, entry);
  }

  let balance = opening;
  const series: BalancePoint[] = [];

  for (const date of [...byDate.keys()].sort()) {
    const entry = byDate.get(date);
    if (entry === undefined) continue;

    balance -= entry.pence;
    series.push({
      date,
      balancePence: balance,
      deliveredKwh: Math.round(entry.kwh * 10) / 10,
      spentPence: entry.pence,
    });
  }

  return series;
}
