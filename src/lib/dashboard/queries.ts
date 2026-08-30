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

  // Only a chain holding LESS than the ledger claims is a discrepancy: it means
  // money the ledger says was committed is not there. A chain holding more is
  // ordinary — the demonstration has been run before and those earlier
  // transactions are still on it. Reporting that in red taught the operator to
  // ignore the one warning that actually matters.
  const ledgerAgrees =
    onChainBalancePence === null || onChainBalancePence >= localBalancePence;

  if (!ledgerAgrees) {
    problems.push(
      `The chain holds ${onChainBalancePence} pence against a local ledger of ${localBalancePence}. ` +
        `Money the ledger records as committed is not on the chain — most likely the chain was restarted after the pot was funded.`,
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
// What the roofs are doing right now
// ---------------------------------------------------------------------------

export interface LiveExporter {
  reference: string;
  locality: string;
  displayName: string;
  capacityKw: number;
  /** Export in the half-hour currently in progress, in kWh. */
  nowKwh: number;
  /** Everything exported so far today. */
  todayKwh: number;
  /** Today's export by half-hour, from midnight. */
  series: number[];
}

export interface LiveExport {
  /** The half-hour currently in progress, as an ISO instant. */
  intervalStart: string;
  /** Position of that half-hour in the day, 0 to 47. */
  periodIndex: number;
  exporters: LiveExporter[];
  /** Combined surplus in the current half-hour. */
  surplusNowKwh: number;
  /** Combined surplus so far today. */
  surplusTodayKwh: number;
  /** True when the sun is down and nothing is being exported. */
  afterDark: boolean;
  /** The most recent half-hour that produced anything, for the after-dark case. */
  peakToday: { periodIndex: number; kwh: number } | null;
  /** The latest date the seeded data covers. */
  dataDate: string;
  /**
   * True when nothing had been generated yet on the current day, so the curves
   * shown are the most recent day that did produce.
   *
   * Demonstrations happen at whatever hour they happen. At three in the morning
   * today's curve is empty, and an empty panel says nothing useful about a
   * solar scheme. Falling back to the last real day keeps the panel meaningful
   * without inventing a single reading.
   */
  showingPreviousDay: boolean;
}

/**
 * What the three roofs are exporting in the half-hour currently in progress.
 *
 * Beat two of the demonstration. The reading is real seeded data for the actual
 * current half-hour, not a loop — so at four in the afternoon it shows a
 * genuine afternoon figure and at ten at night it shows zero and says why.
 * Faking daylight would be the easiest thing in the world here and would make
 * every other honesty claim on the page worthless.
 */
export async function getLiveExport(): Promise<LiveExport | null> {
  const bounds = await prisma.meterReading.aggregate({
    _max: { intervalStart: true },
  });
  if (bounds._max.intervalStart === null) return null;

  // The seeded window ends today, so "today" is its last day. If the clock has
  // run past the seeded data, fall back to the final seeded day rather than
  // showing an empty panel.
  const latest = bounds._max.intervalStart;
  const now = new Date();
  const useToday =
    now.toISOString().slice(0, 10) <= latest.toISOString().slice(0, 10);

  const day = useToday
    ? new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      )
    : new Date(
        Date.UTC(
          latest.getUTCFullYear(),
          latest.getUTCMonth(),
          latest.getUTCDate(),
        ),
      );

  let periodIndex = useToday
    ? Math.min(47, now.getUTCHours() * 2 + (now.getUTCMinutes() >= 30 ? 1 : 0))
    : 47;

  // If nothing has been generated yet today — the small hours — step back to
  // the previous day and show all of it. Nothing is fabricated; the panel just
  // stops pointing at a stretch of night.
  let showingPreviousDay = false;
  let activeDay = day;

  const producedSoFar = await prisma.meterReading.aggregate({
    where: {
      channel: MeterChannel.EXPORT,
      intervalStart: {
        gte: day,
        lt: new Date(day.getTime() + (periodIndex + 1) * 30 * 60_000),
      },
    },
    _sum: { kwh: true },
  });

  if ((producedSoFar._sum.kwh ?? 0) <= 0) {
    activeDay = new Date(day.getTime() - 86_400_000);
    periodIndex = 47;
    showingPreviousDay = true;
  }

  const dayEnd = new Date(activeDay.getTime() + 86_400_000);

  const [exporterHouseholds, readings] = await Promise.all([
    prisma.household.findMany({
      where: { role: HouseholdRole.EXPORTER },
      orderBy: { reference: "asc" },
    }),
    prisma.meterReading.findMany({
      where: {
        channel: MeterChannel.EXPORT,
        intervalStart: { gte: activeDay, lt: dayEnd },
      },
      orderBy: { intervalStart: "asc" },
    }),
  ]);

  const byHousehold = new Map<string, number[]>();
  for (const reading of readings) {
    const index = Math.floor(
      (reading.intervalStart.getTime() - activeDay.getTime()) / (30 * 60_000),
    );
    if (index < 0 || index > 47) continue;

    let series = byHousehold.get(reading.householdId);
    if (series === undefined) {
      series = new Array<number>(48).fill(0);
      byHousehold.set(reading.householdId, series);
    }
    series[index] = reading.kwh;
  }

  const exporters: LiveExporter[] = exporterHouseholds.map((household) => {
    const series = byHousehold.get(household.id) ?? new Array<number>(48).fill(0);

    return {
      reference: household.reference,
      locality: household.locality,
      displayName: household.displayName,
      capacityKw: household.solarCapacityKw ?? 0,
      nowKwh: round2(series[periodIndex] ?? 0),
      // Only what has actually happened so far today, not the whole day.
      todayKwh: round1(
        series.slice(0, periodIndex + 1).reduce((sum, kwh) => sum + kwh, 0),
      ),
      series: series.map((kwh) => round2(kwh)),
    };
  });

  const surplusNowKwh = round2(
    exporters.reduce((sum, exporter) => sum + exporter.nowKwh, 0),
  );

  // The brightest half-hour so far, so an evening demonstration still has a
  // real figure to point at rather than a row of zeroes.
  let peakToday: { periodIndex: number; kwh: number } | null = null;
  for (let index = 0; index <= periodIndex; index++) {
    const total = exporters.reduce(
      (sum, exporter) => sum + (exporter.series[index] ?? 0),
      0,
    );
    if (peakToday === null || total > peakToday.kwh) {
      peakToday = { periodIndex: index, kwh: round2(total) };
    }
  }

  return {
    intervalStart: new Date(
      activeDay.getTime() + periodIndex * 30 * 60_000,
    ).toISOString(),
    periodIndex,
    exporters,
    surplusNowKwh,
    surplusTodayKwh: round1(
      exporters.reduce((sum, exporter) => sum + exporter.todayKwh, 0),
    ),
    afterDark: surplusNowKwh < 0.01,
    peakToday: peakToday !== null && peakToday.kwh > 0 ? peakToday : null,
    dataDate: activeDay.toISOString().slice(0, 10),
    showingPreviousDay,
  };
}

// ---------------------------------------------------------------------------
// Where the energy actually went
// ---------------------------------------------------------------------------

export interface FlowNode {
  reference: string;
  locality: string;
  /** kWh exported or received across the window. */
  kwh: number;
  /** Exporters only: installed array capacity. */
  capacityKw?: number;
  /** Recipients only. */
  needScore?: number;
  eligible?: boolean;
  sharePercent?: number;
}

export interface FlowLink {
  from: string;
  to: string;
  kwh: number;
}

export interface FlowGraph {
  exporters: FlowNode[];
  recipients: FlowNode[];
  links: FlowLink[];
  totalKwh: number;
  /** Decisions the engine made. */
  decisionCount: number;
  /** How many of those have been settled on chain. */
  settledCount: number;
}

/**
 * The whole pilot as a graph: three roofs on one side, eight homes on the
 * other, and the energy that moved between them.
 *
 * Households that were assessed and found ineligible are included with no
 * links. Leaving them out would make the picture prettier and would hide the
 * single most contestable decision the engine makes.
 */
export async function getEnergyFlowGraph(): Promise<FlowGraph> {
  const [households, allocations, run, settledCount] = await Promise.all([
    prisma.household.findMany({
      orderBy: { reference: "asc" },
      include: {
        readings: {
          where: { channel: MeterChannel.CONSUMPTION },
          select: { kwh: true },
        },
      },
    }),
    // Every decision the engine made, not only the settled ones. Between
    // running the engine and settling, a graph filtered to settlements is
    // empty — which would show a councillor nothing at exactly the moment
    // they have just watched the engine decide.
    prisma.allocation.findMany({
      include: { exporter: true, recipient: true },
    }),
    prisma.allocationRun.findFirst({
      orderBy: { createdAt: "desc" },
      select: { assessmentsJson: true },
    }),
    prisma.allocation.count({
      where: { settlement: { status: { in: [...SPENT_STATUSES] } } },
    }),
  ]);

  const assessments = new Map(
    (parseJsonColumn<NeedSummaryRow[]>(run?.assessmentsJson ?? null) ?? []).map(
      (assessment) => [assessment.recipientReference, assessment],
    ),
  );

  // Aggregate the thousands of half-hourly decisions into one line per pair.
  const pairKwh = new Map<string, number>();
  const exporterKwh = new Map<string, number>();
  const recipientKwh = new Map<string, number>();

  for (const allocation of allocations) {
    const from = allocation.exporter.reference;
    const to = allocation.recipient.reference;
    const key = `${from}|${to}`;

    pairKwh.set(key, (pairKwh.get(key) ?? 0) + allocation.kwh);
    exporterKwh.set(from, (exporterKwh.get(from) ?? 0) + allocation.kwh);
    recipientKwh.set(to, (recipientKwh.get(to) ?? 0) + allocation.kwh);
  }

  const exporters: FlowNode[] = households
    .filter((household) => household.role === HouseholdRole.EXPORTER)
    .map((household) => ({
      reference: household.reference,
      locality: household.locality,
      kwh: round1(exporterKwh.get(household.reference) ?? 0),
      capacityKw: household.solarCapacityKw ?? undefined,
    }))
    .sort((a, b) => b.kwh - a.kwh);

  const recipients: FlowNode[] = households
    .filter((household) => household.role === HouseholdRole.RECIPIENT)
    .map((household) => {
      const consumed = household.readings.reduce((sum, row) => sum + row.kwh, 0);
      const received = recipientKwh.get(household.reference) ?? 0;
      const assessment = assessments.get(household.reference);

      return {
        reference: household.reference,
        locality: household.locality,
        kwh: round1(received),
        needScore: assessment?.needScore,
        eligible: assessment?.eligible ?? received > 0,
        sharePercent:
          consumed > 0 ? Math.round((received / consumed) * 100) : 0,
      };
    })
    // Served households first, ordered by the share of their bill covered;
    // then the ineligible ones, so the diagram reads top to bottom as
    // "most helped" down to "not eligible".
    .sort((a, b) => {
      if (a.kwh > 0 !== b.kwh > 0) return a.kwh > 0 ? -1 : 1;
      if (a.kwh > 0) return (b.sharePercent ?? 0) - (a.sharePercent ?? 0);
      return (b.needScore ?? 0) - (a.needScore ?? 0);
    });

  const links: FlowLink[] = [...pairKwh.entries()]
    .map(([key, kwh]) => {
      const [from, to] = key.split("|");
      return { from, to, kwh: round1(kwh) };
    })
    .filter((link) => link.kwh > 0)
    .sort((a, b) => b.kwh - a.kwh);

  return {
    exporters,
    recipients,
    links,
    totalKwh: round1([...recipientKwh.values()].reduce((sum, k) => sum + k, 0)),
    decisionCount: allocations.length,
    settledCount,
  };
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

/** Round to one decimal place, for figures shown to a person. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Round to two decimal places, for half-hourly meter figures. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** How many accountability reports have been generated for the demo pot. */
export async function getReportCount(): Promise<number> {
  return prisma.report.count();
}
