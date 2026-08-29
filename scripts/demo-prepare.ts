/**
 * Solace — put the demonstration into its opening state.
 *
 *   npm run demo:prepare
 *   npm run demo:prepare -- --hold 15
 *
 * Settles the history so the dashboard opens with a pot that has visibly been
 * spent, and deliberately holds back the most recent allocations so there is
 * something real left to settle on stage.
 *
 * The held-back allocations are genuine decisions the engine already made; they
 * are simply not settled yet. Nothing is staged or pre-recorded — pressing
 * "Settle now" submits real transactions and waits for real receipts.
 */

import { ACTIVE_CHAIN, CHAINS } from "../src/lib/config.ts";
import { DEMO_POT } from "../src/lib/synthetic/households.ts";
import { formatKwh, formatPence } from "../src/lib/format.ts";
import { loadEnvFiles } from "../src/lib/env-file.ts";
import { prisma } from "../src/lib/db.ts";
import { SPENT_STATUSES } from "../src/lib/domain.ts";
import {
  fundPot,
  reconcilePotFunding,
  resolveChainContext,
  settleAllocation,
} from "../src/lib/settlement/service.ts";

loadEnvFiles();

/** How many allocations to leave unsettled, for the live demonstration. */
const DEFAULT_HOLD = 12;

function parseHold(): number {
  const index = process.argv.indexOf("--hold");
  if (index === -1) return DEFAULT_HOLD;

  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : DEFAULT_HOLD;
}

async function main(): Promise<void> {
  const hold = parseHold();

  const pot = await prisma.pot.findUnique({
    where: { reference: DEMO_POT.reference },
  });
  if (pot === null) {
    throw new Error("No pot found. Run `npm run db:seed` first.");
  }

  console.log(`\nPreparing the demonstration`);
  console.log(`  Chain     ${CHAINS[ACTIVE_CHAIN].label}`);
  console.log(`  Holding   ${hold} allocations back to settle live`);

  const resolved = await resolveChainContext();
  if (!resolved.ok) {
    console.error(`\n  Cannot prepare: ${resolved.reason}\n`);
    process.exitCode = 1;
    return;
  }

  // Clear every settlement so the run can be replayed from a known state. The
  // allocations themselves are untouched — the engine's decisions stand.
  const cleared = await prisma.settlement.deleteMany();
  console.log(`  Cleared   ${cleared.count} previous settlements`);

  // A local chain forgets everything when it restarts; the database does not.
  // Check the chain before trusting our own record of the money going in.
  const reconciliation = await reconcilePotFunding(pot.id, pot.reference);
  if (reconciliation.message !== null) {
    console.log(`  Note      ${reconciliation.message}`);
  }

  const funded = await prisma.deposit.findFirst({
    where: { potId: pot.id, status: { in: [...SPENT_STATUSES] } },
  });

  if (funded === null) {
    const outcome = await fundPot({
      potId: pot.id,
      potReference: pot.reference,
      amountPence: DEMO_POT.openingDepositPence,
      councilReference: DEMO_POT.depositReference,
      context: resolved.context,
    });

    if (!outcome.ok) {
      console.error(`\n  Funding failed: ${outcome.error}\n`);
      process.exitCode = 1;
      return;
    }
    console.log(`  Funded    ${formatPence(DEMO_POT.openingDepositPence)}`);
  } else {
    console.log(`  Funded    already, ${formatPence(funded.amountPence)}`);
  }

  // Newest allocations are held back; everything older is settled now.
  const all = await prisma.allocation.findMany({
    where: { potId: pot.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });

  const toSettle = all.slice(hold).reverse();
  console.log(`\n  Settling ${toSettle.length} historic allocations`);

  let confirmed = 0;
  let failed = 0;
  const started = Date.now();

  for (const [index, allocation] of toSettle.entries()) {
    const outcome = await settleAllocation({
      allocationId: allocation.id,
      context: resolved.context,
    });

    if (outcome.ok) confirmed += 1;
    else failed += 1;

    if ((index + 1) % 50 === 0 || index === toSettle.length - 1) {
      console.log(
        `    ${String(index + 1).padStart(4)} of ${toSettle.length}  ${confirmed} confirmed, ${failed} failed`,
      );
    }
  }

  console.log(`  Done in ${((Date.now() - started) / 1000).toFixed(1)}s`);

  await report(pot.id);
}

async function report(potId: string): Promise<void> {
  const spentFilter = { in: [...SPENT_STATUSES] };

  const [deposits, spend, energy, pending] = await Promise.all([
    prisma.deposit.aggregate({
      where: { potId, status: spentFilter },
      _sum: { amountPence: true },
    }),
    prisma.allocation.aggregate({
      where: { potId, settlement: { status: spentFilter } },
      _sum: { amountPence: true },
    }),
    prisma.allocation.aggregate({
      where: { potId, settlement: { status: spentFilter } },
      _sum: { kwh: true },
    }),
    prisma.allocation.count({ where: { potId, settlement: null } }),
  ]);

  const deposited = deposits._sum.amountPence ?? 0;
  const spent = spend._sum.amountPence ?? 0;

  console.log(`\n  The dashboard will open showing`);
  console.log(`    Remaining   ${formatPence(deposited - spent)}`);
  console.log(`    Committed   ${formatPence(spent)} of ${formatPence(deposited)}`);
  console.log(`    Delivered   ${formatKwh(energy._sum.kwh ?? 0)}`);
  console.log(`    Awaiting    ${pending} allocations, ready to settle live`);
  console.log(`\n  Start the dashboard with \`npm run dev\`.\n`);
}

try {
  await main();
} catch (error) {
  console.error(
    `\nPreparation failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
