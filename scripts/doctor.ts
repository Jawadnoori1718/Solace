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
import { loadEnvFiles } from "../src/lib/env-file.ts";
import { onChainPotBalancePence } from "../src/lib/settlement/service.ts";
import { prisma } from "../src/lib/db.ts";
import { SPENT_STATUSES } from "../src/lib/domain.ts";

loadEnvFiles();

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

  checks.push({
    name: "Allocation",
    level: run !== null && allocations > 0 ? "ready" : "blocked",
    detail:
      run === null
        ? "The engine has not been run."
        : `${allocations} decisions, engine ${run.engineVersion}, digest ${run.outputDigest.slice(0, 12)}.`,
    fix: run === null ? "npm run allocate" : undefined,
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

    checks.push({
      name: "Ledger",
      level: onChain === local ? "ready" : "blocked",
      detail:
        onChain === local
          ? `The database and the chain both report ${formatPence(local)} remaining.`
          : `The database says ${formatPence(local)} but the chain says ${onChain === null ? "unknown" : formatPence(onChain)}. The chain was probably restarted.`,
      fix: onChain === local ? undefined : "npm run demo:prepare",
    });

    checks.push({
      name: "Live beat",
      level: pending > 0 ? "ready" : "warn",
      detail:
        pending > 0
          ? `${pending} allocations are held back to settle on stage.`
          : "Nothing is left to settle live. The demonstration would have no beat four.",
      fix: pending > 0 ? undefined : "npm run demo:prepare",
    });
  }

  // -- Configuration ---------------------------------------------------------

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
