/**
 * Solace — parse council case notes into structured need signals.
 *
 *   npm run ai:parse
 *   npm run ai:parse -- --force     # re-parse notes already parsed
 *
 * This is the AI's first job, and it runs as a separate, deliberate step rather
 * than inside the allocation engine. That separation is the point: the model's
 * output lands in a database column, and the engine later reads a number.
 *
 * Re-running the parser changes the engine's inputs, so the allocation must be
 * re-run afterwards to take account of it. The script says so.
 */

import { AI_MODEL, PARSER_VERSION } from "../src/lib/ai/client.ts";
import { hasAnthropicKey } from "../src/lib/config.ts";
import { loadEnvFiles } from "../src/lib/env-file.ts";
import { parseCaseNote } from "../src/lib/ai/parse-need-signals.ts";
import { prisma } from "../src/lib/db.ts";
import { toJsonColumn } from "../src/lib/domain.ts";

loadEnvFiles();

const force = process.argv.includes("--force");

async function main(): Promise<void> {
  if (!hasAnthropicKey) {
    console.error(
      "\nNo Anthropic API key configured. Set ANTHROPIC_API_KEY in .env.local.\n" +
        "The allocation engine runs without it — case notes simply contribute nothing,\n" +
        "and the engine renormalises the remaining factors rather than penalising the household.\n",
    );
    process.exitCode = 1;
    return;
  }

  const signals = await prisma.needSignal.findMany({
    where: force ? {} : { parsedAt: null },
    include: { household: true },
    orderBy: { id: "asc" },
  });

  console.log(`\nParsing council case notes`);
  console.log(`  Model     ${AI_MODEL}`);
  console.log(`  Parser    ${PARSER_VERSION}`);
  console.log(`  Notes     ${signals.length} to parse${force ? " (forced)" : ""}`);

  if (signals.length === 0) {
    console.log(`\n  Nothing to do. Use --force to re-parse.\n`);
    return;
  }

  let parsed = 0;
  let failed = 0;

  for (const signal of signals) {
    const outcome = await parseCaseNote(signal.caseNote);

    if (!outcome.ok || outcome.parsed === null) {
      failed += 1;
      console.log(`    ${signal.household.reference}  failed: ${outcome.error}`);
      continue;
    }

    await prisma.needSignal.update({
      where: { id: signal.id },
      data: {
        parsedJson: toJsonColumn(outcome.parsed),
        vulnerabilityScore: outcome.parsed.vulnerabilityScore,
        parserModel: outcome.model,
        parserVersion: outcome.parserVersion,
        parsedAt: new Date(),
      },
    });

    parsed += 1;

    console.log(
      `    ${signal.household.reference}  ${outcome.parsed.vulnerabilityScore.toFixed(2)}` +
        `  confidence ${outcome.parsed.confidence.toFixed(2)}` +
        `${outcome.parsed.urgent ? "  URGENT" : ""}`,
    );
    console.log(`      ${outcome.parsed.rationale}`);
    if (outcome.parsed.indicators.length > 0) {
      console.log(`      ${outcome.parsed.indicators.join(", ")}`);
    }
  }

  console.log(`\n  Parsed    ${parsed}`);
  if (failed > 0) console.log(`  Failed    ${failed}`);

  console.log(
    `\n  These scores are now an input to the allocation engine.\n` +
      `  Re-run \`npm run allocate\` for them to take effect.\n`,
  );
}

try {
  await main();
} catch (error) {
  console.error(
    `\nParsing failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
