/**
 * Solace — run the allocation engine over the seeded window.
 *
 *   npm run allocate
 *
 * Loads the input from the database, runs the deterministic solver, writes the
 * run and its decisions back, and prints enough of the reasoning to see what
 * the engine actually did and why.
 *
 * Settling those decisions on chain is a separate step, in Phase 5. This script
 * only decides.
 */

import { allocate } from "../src/lib/engine/allocate.ts";
import {
  currentPotBalancePence,
  loadAllocationInput,
} from "../src/lib/engine/load.ts";
import { DEMO_POT, householdId } from "../src/lib/synthetic/households.ts";
import { formatKwh, formatPence } from "../src/lib/format.ts";
import { loadEnvFiles } from "../src/lib/env-file.ts";
import { prisma } from "../src/lib/db.ts";
import { toJsonColumn } from "../src/lib/domain.ts";

loadEnvFiles();

const SEED = process.env.SOLACE_ALLOCATION_SEED?.trim() || "solace-allocation-2026";

async function main(): Promise<void> {
  const pot = await prisma.pot.findUnique({
    where: { reference: DEMO_POT.reference },
  });
  if (pot === null) {
    throw new Error("No pot found. Run `npm run db:seed` first.");
  }

  // The window is whatever meter data exists.
  const bounds = await prisma.meterReading.aggregate({
    _min: { intervalStart: true },
    _max: { intervalStart: true },
  });
  if (bounds._min.intervalStart === null || bounds._max.intervalStart === null) {
    throw new Error("No meter readings found. Run `npm run db:seed` first.");
  }

  const windowStart = bounds._min.intervalStart.toISOString().slice(0, 10);
  const windowEnd = bounds._max.intervalStart.toISOString().slice(0, 10);

  let potBalancePence = await currentPotBalancePence(pot.id);
  let dryRun = false;

  if (potBalancePence <= 0) {
    // The pot has no confirmed deposits yet — funding it on chain is Phase 5.
    // Running against the intended opening balance is still useful, and saying
    // so is better than silently allocating nothing.
    potBalancePence = DEMO_POT.openingDepositPence;
    dryRun = true;
  }

  console.log(`\nRunning the allocation engine`);
  console.log(`  Pot       ${pot.name} (${pot.reference})`);
  console.log(`  Window    ${windowStart} to ${windowEnd}`);
  console.log(`  Seed      ${SEED}`);
  console.log(
    `  Balance   ${formatPence(potBalancePence)}${dryRun ? "  (no confirmed deposit yet — using the intended opening balance)" : ""}`,
  );

  const input = await loadAllocationInput({
    potReference: pot.reference,
    windowStart,
    windowEnd,
    seed: SEED,
  });
  input.potBalancePence = potBalancePence;

  const started = process.hrtime.bigint();
  const result = allocate(input);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;

  console.log(`\n  Decided in ${elapsedMs.toFixed(0)} ms`);
  console.log(`  Decisions ${result.decisions.length}`);
  console.log(`  Delivered ${formatKwh(result.totalKwh)}`);
  console.log(`  Spent     ${formatPence(result.totalPence)}`);
  console.log(`  Remaining ${formatPence(potBalancePence - result.totalPence)}`);
  console.log(`  Unplaced  ${formatKwh(result.unallocatedKwh)} of surplus had no concurrent demand nearby`);
  console.log(`  Input     ${result.inputDigest.slice(0, 16)}…`);
  console.log(`  Output    ${result.outputDigest.slice(0, 16)}…`);

  // Prove reproducibility here, not only in the test suite. Running the same
  // input twice must produce the same digest.
  const replay = allocate(input);
  console.log(
    `  Replay    ${replay.outputDigest === result.outputDigest ? "identical output digest" : "MISMATCH — the engine is not deterministic"}`,
  );

  await persist(pot.id, result, input.seed);

  reportAssessments(result);
  reportPerRecipient(result, input);
  reportTopDecision(result);

  if (result.unserved.length > 0) {
    console.log(`\n  Households that received nothing`);
    for (const entry of result.unserved) {
      console.log(`    ${entry.recipientReference}  ${entry.reason}`);
    }
  }

  for (const note of result.notes) {
    console.log(`\n  Note: ${note}`);
  }

  console.log("");
}

/** Write the run and its decisions. Replaces any previous run for this window. */
async function persist(
  potId: string,
  result: Awaited<ReturnType<typeof allocate>>,
  seed: string,
): Promise<void> {
  const runId = `run_${result.windowStart}_${result.windowEnd}_${result.outputDigest.slice(0, 8)}`;

  await prisma.allocationRun.deleteMany({ where: { potId } });

  await prisma.allocationRun.create({
    data: {
      id: runId,
      potId,
      seed,
      engineVersion: result.engineVersion,
      windowStart: new Date(`${result.windowStart}T00:00:00.000Z`),
      windowEnd: new Date(`${result.windowEnd}T00:00:00.000Z`),
      inputDigest: result.inputDigest,
      outputDigest: result.outputDigest,
      // Stored so the dashboard can explain the households it decided against,
      // not only the ones it served.
      assessmentsJson: toJsonColumn(result.assessments),
      unservedJson: toJsonColumn(result.unserved),
      unallocatedKwh: result.unallocatedKwh,
    },
  });

  const CHUNK = 500;
  for (let offset = 0; offset < result.decisions.length; offset += CHUNK) {
    const chunk = result.decisions.slice(offset, offset + CHUNK);
    await prisma.allocation.createMany({
      data: chunk.map((decision) => ({
        id: decision.id,
        runId,
        potId,
        exporterId: householdId(decision.exporterReference),
        recipientId: householdId(decision.recipientReference),
        kwh: decision.kwh,
        milliKwh: decision.milliKwh,
        pencePerKwh: decision.pencePerKwh,
        amountPence: decision.amountPence,
        rank: decision.rank,
        reasoningJson: toJsonColumn(decision.reasoning),
        createdAt: new Date(`${decision.date}T12:00:00.000Z`),
      })),
    });
  }

  console.log(`  Stored    run ${runId}`);
}

/** Every household's need score, and whether it cleared the threshold. */
function reportAssessments(
  result: Awaited<ReturnType<typeof allocate>>,
): void {
  console.log(`\n  Need assessment`);
  const rows = [...result.assessments].sort((a, b) => b.needScore - a.needScore);

  for (const row of rows) {
    console.log(
      `    ${row.recipientReference}  score ${row.needScore.toFixed(3)}  ` +
        `${row.eligible ? "eligible    " : "not eligible"}  ` +
        `using ${row.actualDailyKwh.toFixed(1)} kWh/day against ${row.expectedDailyKwh.toFixed(1)} expected`,
    );
  }
}

/** How the energy was shared out. The fairness constraint, visible. */
function reportPerRecipient(
  result: Awaited<ReturnType<typeof allocate>>,
  input: Awaited<ReturnType<typeof loadAllocationInput>>,
): void {
  const byRecipient = new Map<string, { kwh: number; pence: number; count: number }>();

  for (const decision of result.decisions) {
    const entry = byRecipient.get(decision.recipientReference) ?? {
      kwh: 0,
      pence: 0,
      count: 0,
    };
    entry.kwh += decision.kwh;
    entry.pence += decision.amountPence;
    entry.count += 1;
    byRecipient.set(decision.recipientReference, entry);
  }

  // Total consumption per household, so delivered energy can be shown as the
  // share of a household's bill it covered. Absolute kilowatt-hours flatter
  // large households and understate what a delivery meant to a small one.
  const consumption = new Map<string, number>();
  for (const recipient of input.recipients) {
    consumption.set(
      recipient.reference,
      Object.values(recipient.consumptionKwhByInterval).reduce(
        (sum, kwh) => sum + kwh,
        0,
      ),
    );
  }

  console.log(`\n  Delivered per household`);
  const rows = [...byRecipient.entries()].sort(
    (a, b) =>
      b[1].kwh / (consumption.get(b[0]) || 1) -
      a[1].kwh / (consumption.get(a[0]) || 1),
  );

  for (const [reference, entry] of rows) {
    const used = consumption.get(reference) ?? 0;
    const share = used > 0 ? (entry.kwh / used) * 100 : 0;
    console.log(
      `    ${reference}  ${entry.kwh.toFixed(1).padStart(6)} kWh  ` +
        `${formatPence(entry.pence).padStart(8)}  across ${String(entry.count).padStart(3)} deliveries  ` +
        `covering ${share.toFixed(0).padStart(2)}% of its electricity`,
    );
  }
}

/** Show the reasoning behind the highest-priority decision in full. */
function reportTopDecision(
  result: Awaited<ReturnType<typeof allocate>>,
): void {
  const top = result.decisions.find((decision) => decision.rank === 1);
  if (top === undefined) return;

  console.log(`\n  Reasoning for the highest-priority decision`);
  console.log(`    ${top.date}  ${top.exporterReference} to ${top.recipientReference}`);
  console.log(`    ${top.reasoning.summary}`);
  console.log(`\n    Need score ${top.reasoning.needScore.toFixed(3)} from:`);

  for (const factor of [...top.reasoning.factors].sort(
    (a, b) => b.contribution - a.contribution,
  )) {
    console.log(
      `      ${factor.label.padEnd(32)} weight ${factor.weight.toFixed(2)}  ` +
        `contributed ${factor.contribution.toFixed(4)}`,
    );
  }

  console.log(
    `\n    Fairness multiplier ${top.reasoning.fairnessMultiplier.toFixed(3)} — ${top.reasoning.fairness.note}`,
  );
  console.log(
    `    Distance ${top.reasoning.proximity.distanceKm.toFixed(1)} km, within the ${top.reasoning.proximity.withinRadiusKm} km radius.`,
  );
}

try {
  await main();
} catch (error) {
  console.error(
    `\nAllocation failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
