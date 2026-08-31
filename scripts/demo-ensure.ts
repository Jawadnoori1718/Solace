// Must be first: loads .env.local before any module reads process.env.
import "../src/lib/env-first.ts";

/**
 * Solace — make sure the demonstration is ready, doing only what is missing.
 *
 *   node scripts/demo-ensure.ts
 *
 * Called by `npm run demo`. It checks four things and repairs only the ones
 * that are actually wrong:
 *
 *   1. Are the eleven households and their meter data present?
 *   2. Have the council case notes been parsed?
 *   3. Is the demonstration at its opening state?
 *
 * Doing this in TypeScript rather than shell matters. The first version checked
 * the household count with a shell command that silently returned nothing, so
 * every run re-seeded the database — which wiped the parsed case notes and
 * quietly threw away work that costs API calls to redo. A check that fails open
 * is worse than no check.
 */

import { spawnSync } from "node:child_process";

import { hasAnthropicKey } from "../src/lib/config.ts";
import { prisma } from "../src/lib/db.ts";

const EXPECTED_HOUSEHOLDS = 11;

function run(command: string, args: string[]): boolean {
  const result = spawnSync(command, args, { stdio: "inherit" });
  return result.status === 0;
}

async function main(): Promise<void> {
  // -- 1. Households and meter data ----------------------------------------

  const households = await prisma.household.count();
  const readings = await prisma.meterReading.count();

  if (households < EXPECTED_HOUSEHOLDS || readings === 0) {
    console.log("  Data       generating thirty days of meter readings…");
    await prisma.$disconnect();

    if (!run("npm", ["run", "db:seed", "--silent"])) {
      console.error("  Data       seeding failed");
      process.exitCode = 1;
      return;
    }
    console.log("  Data       ready");
  } else {
    console.log(
      `  Data       ${households} households, ${readings.toLocaleString("en-GB")} readings`,
    );
  }

  // -- 2. Case notes -------------------------------------------------------

  const totalNotes = await prisma.needSignal.count();
  const parsedNotes = await prisma.needSignal.count({
    where: { parsedAt: { not: null } },
  });

  if (totalNotes > 0 && parsedNotes < totalNotes) {
    if (hasAnthropicKey) {
      console.log(`  Case notes parsing ${totalNotes - parsedNotes} with the API…`);
      await prisma.$disconnect();
      run("npm", ["run", "ai:parse", "--silent"]);
      console.log("  Case notes ready");
    } else {
      console.log(
        `  Case notes ${parsedNotes} of ${totalNotes} parsed — no API key, the engine will renormalise without them`,
      );
    }
  } else if (totalNotes > 0) {
    console.log(`  Case notes ${parsedNotes} of ${totalNotes} parsed`);
  }

  // -- 3. Opening state ----------------------------------------------------

  await prisma.settlement.deleteMany();
  await prisma.allocation.deleteMany();
  await prisma.allocationRun.deleteMany();
  await prisma.deposit.deleteMany();
  await prisma.report.deleteMany();

  console.log("  Demo       reset to the opening state");
}

try {
  await main();
} catch (error) {
  console.error(
    `  Preparation failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
