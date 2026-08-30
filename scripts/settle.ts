/**
 * Solace — fund the pot and settle allocations on chain.
 *
 *   npm run settle            # fund if needed, then settle everything pending
 *   npm run settle -- --limit 20
 *
 * In demo mode this runs against a local Hardhat node, so the thirty days of
 * history become genuine transactions — really mined, really emitting events,
 * really moving balances — without needing a faucet or the internet. In live
 * mode it runs against Base Sepolia, where the same transactions are publicly
 * verifiable.
 *
 * Failures are recorded and skipped rather than fatal. A settlement run that
 * stops dead on the first bad transaction is useless on a stage.
 */

// Must be first: loads .env.local before any module reads process.env.
import "../src/lib/env-first.ts";

import { ACTIVE_CHAIN, MODE, modeDescription } from "../src/lib/config.ts";
import { CHAINS } from "../src/lib/config.ts";
import { DEMO_POT } from "../src/lib/synthetic/households.ts";
import { formatKwh, formatPence, shortenHash } from "../src/lib/format.ts";
import { prisma } from "../src/lib/db.ts";
import {
  fundPot,
  onChainPotBalancePence,
  pendingAllocations,
  reconcilePotFunding,
  resolveChainContext,
  settleAllocation,
  spentPence,
} from "../src/lib/settlement/service.ts";

/** `--limit N` caps how many allocations are settled in one run. */
function parseLimit(): number | undefined {
  const index = process.argv.indexOf("--limit");
  if (index === -1) return undefined;

  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

async function main(): Promise<void> {
  const limit = parseLimit();

  const pot = await prisma.pot.findUnique({
    where: { reference: DEMO_POT.reference },
  });
  if (pot === null) {
    throw new Error("No pot found. Run `npm run db:seed` first.");
  }

  console.log(`\nSettling on ${CHAINS[ACTIVE_CHAIN].label}`);
  console.log(`  Mode      ${MODE} — ${modeDescription()}`);

  const resolved = await resolveChainContext();
  if (!resolved.ok) {
    // Not an exception. A configuration or connectivity problem is something to
    // report clearly, not to crash on.
    console.error(`\n  Cannot settle: ${resolved.reason}\n`);
    process.exitCode = 1;
    return;
  }

  const { context } = resolved;
  console.log(`  Contract  ${context.address}`);

  // -- Fund the pot, once ---------------------------------------------------

  // The chain is the authority on whether the pot was really funded. A local
  // node that has been restarted has forgotten, even though we have not.
  const reconciliation = await reconcilePotFunding(pot.id, pot.reference);
  if (reconciliation.message !== null) {
    console.log(`  Note      ${reconciliation.message}`);
  }

  const existingDeposit = await prisma.deposit.findFirst({
    where: { potId: pot.id, status: "CONFIRMED" },
  });

  if (existingDeposit === null) {
    console.log(
      `\n  Funding ${pot.name} with ${formatPence(DEMO_POT.openingDepositPence)}`,
    );

    const outcome = await fundPot({
      potId: pot.id,
      potReference: pot.reference,
      amountPence: DEMO_POT.openingDepositPence,
      councilReference: DEMO_POT.depositReference,
      context,
    });

    if (!outcome.ok) {
      console.error(`  Funding failed: ${outcome.error}\n`);
      process.exitCode = 1;
      return;
    }

    console.log(`  Confirmed ${shortenHash(outcome.txHash ?? "")}`);
    if (outcome.explorerUrl !== null) {
      console.log(`  Explorer  ${outcome.explorerUrl}`);
    }
  } else {
    console.log(`\n  Pot already funded (${existingDeposit.reference})`);
  }

  // -- Settle the backlog ---------------------------------------------------

  const pending = await pendingAllocations(pot.id, limit);

  if (pending.length === 0) {
    console.log(`\n  Nothing pending. Every allocation is already settled.\n`);
    await summarise(pot.id, pot.reference);
    return;
  }

  console.log(`\n  Settling ${pending.length} allocations`);

  let confirmed = 0;
  let failed = 0;
  const started = Date.now();
  let lastConfirmedUrl: string | null = null;
  let lastConfirmedHash: string | null = null;

  for (const [index, allocation] of pending.entries()) {
    const outcome = await settleAllocation({
      allocationId: allocation.id,
      context,
    });

    if (outcome.ok) {
      confirmed += 1;
      lastConfirmedUrl = outcome.explorerUrl;
      lastConfirmedHash = outcome.txHash;
    } else {
      failed += 1;
      // Print the first few failures in full; beyond that the summary suffices.
      if (failed <= 3) {
        console.log(`    ${allocation.id} failed: ${outcome.error}`);
      }
    }

    // Progress, without a line per transaction.
    if ((index + 1) % 25 === 0 || index === pending.length - 1) {
      const elapsed = (Date.now() - started) / 1000;
      console.log(
        `    ${String(index + 1).padStart(4)} of ${pending.length}  ` +
          `${confirmed} confirmed, ${failed} failed  (${elapsed.toFixed(1)}s)`,
      );
    }
  }

  console.log(`\n  Done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`  Confirmed ${confirmed}`);
  if (failed > 0) console.log(`  Failed    ${failed}`);

  if (lastConfirmedHash !== null) {
    console.log(
      `  Last tx   ${lastConfirmedUrl ?? lastConfirmedHash}`,
    );
  }

  await summarise(pot.id, pot.reference);
}

/**
 * Compare the local ledger against the chain.
 *
 * These two numbers are computed by entirely different means — one by summing
 * database rows, one by reading contract storage. If they disagree, something
 * is wrong and it is better to find out here than on stage.
 */
async function summarise(potId: string, potReference: string): Promise<void> {
  const [deposits, spent, settlements, onChain] = await Promise.all([
    prisma.deposit.aggregate({
      where: { potId, status: "CONFIRMED" },
      _sum: { amountPence: true },
    }),
    spentPence(potId),
    prisma.settlement.groupBy({ by: ["status"], _count: { _all: true } }),
    onChainPotBalancePence(potReference),
  ]);

  const deposited = deposits._sum.amountPence ?? 0;
  const localBalance = deposited - spent;

  const energy = await prisma.allocation.aggregate({
    where: { potId, settlement: { status: "CONFIRMED" } },
    _sum: { kwh: true },
  });

  console.log(`\n  The pot`);
  console.log(`    Deposited      ${formatPence(deposited)}`);
  console.log(`    Spent          ${formatPence(spent)}`);
  console.log(`    Local balance  ${formatPence(localBalance)}`);
  console.log(
    `    Chain balance  ${onChain === null ? "unavailable" : formatPence(onChain)}`,
  );

  if (onChain !== null) {
    console.log(
      `    Agreement      ${onChain === localBalance ? "the ledger and the chain agree" : `MISMATCH of ${formatPence(Math.abs(onChain - localBalance))}`}`,
    );
  }

  console.log(`    Delivered      ${formatKwh(energy._sum.kwh ?? 0)}`);

  console.log(`\n  Settlements`);
  for (const row of settlements.sort((a, b) => (a.status < b.status ? -1 : 1))) {
    console.log(`    ${row.status.padEnd(10)} ${row._count._all}`);
  }

  console.log("");
}

try {
  await main();
} catch (error) {
  console.error(
    `\nSettlement failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
