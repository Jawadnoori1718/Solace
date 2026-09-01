/**
 * Solace — is this thing ready?
 *
 *   npm run doctor
 *
 * Run this before the demonstration, not during it. It checks every dependency
 * the six beats rely on and reports each one as ready or not, with the command
 * that fixes it.
 *
 * The point is to convert every silent failure into a line of text on a laptop
 * five minutes beforehand. Everything checked here has already broken at least
 * once during development.
 */

// Must be first: loads .env.local before any module reads process.env.
import "../src/lib/env-first.ts";

import { existsSync } from "node:fs";
import path from "node:path";

import {
  ACTIVE_CHAIN,
  CHAINS,
  MODE,
  hasAnthropicKey,
  hasConfiguredHashSalt,
  isLiveMode,
} from "../src/lib/config.ts";
import { DEMO_POT } from "../src/lib/synthetic/households.ts";
import { chainIsReachable, tokenAddress } from "../src/lib/chain/client.ts";
import { formatPence } from "../src/lib/format.ts";
import { onChainPotBalancePence } from "../src/lib/settlement/service.ts";
import { prisma } from "../src/lib/db.ts";
import { SPENT_STATUSES } from "../src/lib/domain.ts";

type Level = "ready" | "warn" | "blocked";

interface Check {
  name: string;
  level: Level;
  detail: string;
  fix?: string;
}

const MARK: Record<Level, string> = {
  ready: "  ok  ",
  warn: " warn ",
  blocked: "BLOCKED",
};

async function main(): Promise<void> {
  const checks: Check[] = [];

  console.log(`\nSolace readiness check`);
  console.log(`  Mode      ${MODE}`);
  console.log(`  Chain     ${CHAINS[ACTIVE_CHAIN].label}`);

  // -- The database ---------------------------------------------------------

  const databaseFile = path.join(process.cwd(), "prisma", "solace.db");
  if (!existsSync(databaseFile)) {
    checks.push({
      name: "Database",
      level: "blocked",
      detail: "No database file.",
      fix: "npm run db:migrate && npm run db:seed",
    });
  } else {
    const [households, readings, weather] = await Promise.all([
      prisma.household.count(),
      prisma.meterReading.count(),
      prisma.weatherObservation.count(),
    ]);

    checks.push({
      name: "Database",
      level: households === 11 && readings > 0 ? "ready" : "blocked",
      detail: `${households} households, ${readings.toLocaleString("en-GB")} readings, ${weather} days of weather.`,
      fix: households === 11 ? undefined : "npm run db:seed",
    });
  }

  // -- The engine has run ---------------------------------------------------

  const [run, allocations] = await Promise.all([
    prisma.allocationRun.findFirst({ orderBy: { createdAt: "desc" } }),
    prisma.allocation.count(),
  ]);

  // A reset demonstration has no allocations, and that is a valid, deliberate
  // state — it is the state you want to be in before performing the six beats
  // from the beginning. Reporting it in red would have somebody seeing BLOCKED
  // five minutes before going on stage and assuming the machine was broken.
  const depositTotal = await prisma.deposit.aggregate({
    where: { status: { in: [...SPENT_STATUSES] } },
    _sum: { amountPence: true },
  });
  const freshStart =
    (depositTotal._sum.amountPence ?? 0) === 0 && allocations === 0;

  checks.push({
    name: "Allocation",
    level: freshStart ? "ready" : run !== null && allocations > 0 ? "ready" : "blocked",
    detail: freshStart
      ? "Nothing allocated yet — the demonstration is at its opening state, ready to perform from beat one."
      : run === null
        ? "The engine has not been run, but money has been committed."
        : `${allocations} decisions, engine ${run.engineVersion}, digest ${run.outputDigest.slice(0, 12)}.`,
    fix: freshStart || run !== null ? undefined : "press Run the engine, or npm run allocate",
  });

  // -- The chain ------------------------------------------------------------

  const reachable = await chainIsReachable();
  checks.push({
    name: "Chain",
    level: reachable ? "ready" : "blocked",
    detail: reachable
      ? `${CHAINS[ACTIVE_CHAIN].label} is responding.`
      : `${CHAINS[ACTIVE_CHAIN].label} is not responding.`,
    fix: reachable ? undefined : isLiveMode ? "check BASE_SEPOLIA_RPC_URL" : "npm run chain",
  });

  const address = reachable ? await tokenAddress(ACTIVE_CHAIN) : null;
  checks.push({
    name: "Contract",
    level: address !== null ? "ready" : "blocked",
    detail:
      address === null
        ? "SolacePound is not deployed on this chain."
        : `SolacePound at ${address}.`,
    fix:
      address === null
        ? isLiveMode
          ? "npm run deploy:testnet"
          : "npm run deploy:local"
        : undefined,
  });

  // -- The pot, checked against the chain ------------------------------------

  const pot = await prisma.pot.findUnique({
    where: { reference: DEMO_POT.reference },
  });

  if (pot !== null && reachable && address !== null) {
    const [deposits, spend, onChain, pending] = await Promise.all([
      prisma.deposit.aggregate({
        where: { potId: pot.id, status: { in: [...SPENT_STATUSES] } },
        _sum: { amountPence: true },
      }),
      prisma.allocation.aggregate({
        where: { potId: pot.id, settlement: { status: { in: [...SPENT_STATUSES] } } },
        _sum: { amountPence: true },
      }),
      onChainPotBalancePence(pot.reference),
      prisma.allocation.count({ where: { potId: pot.id, settlement: null } }),
    ]);

    const local =
      (deposits._sum.amountPence ?? 0) - (spend._sum.amountPence ?? 0);

    // Only a chain holding LESS than the ledger is a problem: it means money
    // the ledger records as committed is not there. A chain holding more is
    // ordinary — earlier runs of the demonstration are still on it.
    // Three distinct cases, and conflating any two of them hides a real fault:
    // the contract could not be read at all, the chain holds less than the
    // ledger claims, or the chain holds at least as much.
    const unreadable = onChain === null;
    const chainShort = onChain !== null && onChain < local;

    checks.push({
      name: "Ledger",
      level: unreadable || chainShort ? "blocked" : "ready",
      detail: unreadable
        ? `The chain is reachable but the contract could not be read. It is not deployed at the recorded address — the chain was restarted.`
        : chainShort
          ? `The database says ${formatPence(local)} but the chain holds only ${formatPence(onChain)}. Money the ledger records is missing from the chain.`
          : onChain === local
            ? `The database and the chain both report ${formatPence(local)} remaining.`
            : `The database reports ${formatPence(local)} for this run. The chain holds ${formatPence(onChain)}, which includes earlier runs.`,
      fix: unreadable
        ? "npm run deploy:local"
        : chainShort
          ? "npm run demo:prepare"
          : undefined,
    });

    checks.push({
      name: "Live beat",
      level: freshStart || pending > 0 ? "ready" : "warn",
      detail: freshStart
        ? "Beat four will have plenty to settle once the engine has run."
        : pending > 0
          ? `${pending} allocations are waiting to settle on stage.`
          : "Everything is settled, so there is nothing left to show for beat four.",
      fix:
        freshStart || pending > 0
          ? undefined
          : "press Start over on the dashboard, or npm run demo:prepare",
    });
  }

  // -- Configuration ---------------------------------------------------------

  // A key copied out of a wallet without its `0x` prefix is the easiest mistake
  // to make here, and Hardhat's failure mode for it is a node that starts,
  // never opens its port, and logs nothing.
  const rawKey = process.env.DEPLOYER_PRIVATE_KEY?.trim() ?? "";
  if (rawKey !== "") {
    const wellFormed = /^0x[0-9a-fA-F]{64}$/.test(rawKey);
    checks.push({
      name: "Deployer key",
      level: wellFormed ? "ready" : "blocked",
      detail: wellFormed
        ? "A well-formed deployer key is configured."
        : /^[0-9a-fA-F]{64}$/.test(rawKey)
          ? "The key is missing its 0x prefix. Hardhat will fail to start."
          : "The key is not 0x followed by 64 hexadecimal characters.",
      fix: wellFormed
        ? undefined
        : "edit DEPLOYER_PRIVATE_KEY in .env.local so it reads 0x<64 hex characters>",
    });
  }

  checks.push({
    name: "Hash salt",
    level: hasConfiguredHashSalt ? "ready" : "warn",
    detail: hasConfiguredHashSalt
      ? "A deployment salt is configured."
      : "Using the development salt. Fine for a demonstration, not for real data.",
    fix: hasConfiguredHashSalt
      ? undefined
      : 'echo "SOLACE_HASH_SALT=$(openssl rand -hex 32)" >> .env.local',
  });

  checks.push({
    name: "Anthropic",
    level: hasAnthropicKey ? "ready" : "warn",
    detail: hasAnthropicKey
      ? "An API key is configured. Case-note parsing and report generation are available."
      : "No API key. The engine still runs; reports fall back to the last stored one.",
    fix: hasAnthropicKey ? undefined : "set ANTHROPIC_API_KEY in .env.local",
  });

  const parsed = await prisma.needSignal.count({ where: { parsedAt: { not: null } } });
  const totalNotes = await prisma.needSignal.count();
  checks.push({
    name: "Case notes",
    level: parsed === totalNotes && totalNotes > 0 ? "ready" : "warn",
    detail: `${parsed} of ${totalNotes} case notes parsed.`,
    fix: parsed === totalNotes ? undefined : "npm run ai:parse && npm run allocate",
  });

  // -- Report ---------------------------------------------------------------

  console.log("");
  for (const check of checks) {
    console.log(`  [${MARK[check.level]}] ${check.name.padEnd(12)} ${check.detail}`);
    if (check.fix !== undefined) {
      console.log(`${" ".repeat(24)}fix: ${check.fix}`);
    }
  }

  const blocked = checks.filter((check) => check.level === "blocked");
  const warned = checks.filter((check) => check.level === "warn");

  console.log("");
  if (blocked.length > 0) {
    console.log(
      `  ${blocked.length} thing${blocked.length === 1 ? "" : "s"} would stop the demonstration. Fix ${blocked.length === 1 ? "it" : "them"} before starting.`,
    );
    process.exitCode = 1;
  } else if (warned.length > 0) {
    console.log(
      `  Ready. ${warned.length} thing${warned.length === 1 ? " is" : "s are"} degraded but the demonstration will run.`,
    );
  } else {
    console.log(`  Ready. Every check passed.`);
  }
  console.log("");
}

try {
  await main();
} catch (error) {
  console.error(
    `\nThe readiness check itself failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
