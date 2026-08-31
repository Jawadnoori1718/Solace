/**
 * Solace — tests for the AI layer, and for the boundary around it.
 *
 * The claim being tested is the one that matters most in this project: that no
 * language model participates in deciding who receives energy. That is asserted
 * mechanically here rather than promised in a comment — the engine's source is
 * read and checked for any path to the AI layer.
 *
 * The rest covers the report's integrity check, which is what stops generated
 * prose from asserting a figure the ledger does not support.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  describeFacts,
  findUnverifiedFigures,
} from "../../src/lib/ai/generate-report.ts";
import type { ReportFacts } from "../../src/lib/domain.ts";

// ---------------------------------------------------------------------------
// The separation
// ---------------------------------------------------------------------------

/** Every .ts file under a directory, recursively. */
function sourceFiles(directory: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(full));
    } else if (entry.name.endsWith(".ts")) {
      found.push(full);
    }
  }

  return found;
}

describe("the allocation engine has no path to a language model", () => {
  const engineDirectory = path.join(process.cwd(), "src", "lib", "engine");
  const files = sourceFiles(engineDirectory);

  it("has engine source files to check", () => {
    assert.ok(files.length > 0, "found no engine source to inspect");
  });

  it("imports nothing from the AI layer", () => {
    // The central claim of the project, checked rather than asserted. If
    // somebody later wires a model into the solver, this fails.
    for (const file of files) {
      const source = readFileSync(file, "utf8");

      assert.ok(
        !/from\s+["'][^"']*\/ai\//.test(source),
        `${path.basename(file)} imports from the AI layer`,
      );
      assert.ok(
        !source.includes("@anthropic-ai/sdk"),
        `${path.basename(file)} imports the Anthropic SDK`,
      );
      assert.ok(
        !/\banthropic\s*\(/i.test(source),
        `${path.basename(file)} constructs an Anthropic client`,
      );
    }
  });

  it("makes no network calls at all", () => {
    // A deterministic, replayable solver cannot depend on anything it has to
    // ask for over a network — not a model, not a price feed, not a clock.
    for (const file of files) {
      const source = readFileSync(file, "utf8");

      assert.ok(!/\bfetch\s*\(/.test(source), `${path.basename(file)} calls fetch`);
      assert.ok(
        !/from\s+["'](node:)?(https?|net)["']/.test(source),
        `${path.basename(file)} imports a network module`,
      );
    }
  });

  it("reads no clock, so a run cannot depend on when it happened", () => {
    for (const file of files) {
      // load.ts is the database boundary and is allowed to construct dates
      // from stored values; the solver itself is not.
      if (path.basename(file) === "load.ts") continue;

      const source = readFileSync(file, "utf8");
      assert.ok(
        !/Date\.now\(\)|new Date\(\s*\)/.test(source),
        `${path.basename(file)} reads the current time`,
      );
    }
  });

  it("draws no randomness that is not seeded", () => {
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      assert.ok(
        !source.includes("Math.random"),
        `${path.basename(file)} uses Math.random, which is not reproducible`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// The report's integrity check
// ---------------------------------------------------------------------------

const FACTS: ReportFacts = {
  potReference: "WINTER-2026",
  potName: "Winter Support Pot 2026",
  councilName: "Westminster City Council",
  fundingSource: "Household Support Fund",
  periodStart: "2026-07-30",
  periodEnd: "2026-08-29",
  depositedPence: 40_000,
  spentPence: 10_481,
  remainingPence: 29_519,
  totalKwh: 374.3,
  householdsServed: 5,
  averageKwhPerHousehold: 74.9,
  averagePencePerHousehold: 2_096,
  confirmedOnChainCount: 292,
  backfilledCount: 0,
  repeatRecipients: [
    {
      reference: "REC-05",
      locality: "Holbeck",
      timesServed: 76,
      kwhReceived: 70.8,
      reason: "The engine scored this household 0.73 on need.",
    },
  ],
};

describe("checking a report against its facts", () => {
  it("accepts a narrative that only uses the figures it was given", () => {
    const narrative =
      "Your £400.00 has delivered 374.3 kWh to 5 households. " +
      "£104.81 has been spent and £295.19 remains. " +
      "292 settlements were confirmed on a public ledger.";

    assert.deepEqual(findUnverifiedFigures(narrative, FACTS), []);
  });

  it("catches a figure the ledger does not support", () => {
    // The failure this exists to prevent: a plausible number nobody can check.
    const narrative =
      "Your £400.00 has delivered 374.3 kWh, saving households £1,250 on their bills.";

    const unverified = findUnverifiedFigures(narrative, FACTS);

    assert.ok(
      unverified.length > 0,
      "an invented figure passed the integrity check",
    );
    assert.ok(unverified.some((value) => value.includes("1,250")));
  });

  it("accepts percentages the facts support", () => {
    // 10481 of 40000 is 26.2%.
    const narrative = "About 26% of the pot has been committed so far.";

    assert.deepEqual(findUnverifiedFigures(narrative, FACTS), []);
  });

  it("ignores small counts, which are ordinary prose", () => {
    const narrative =
      "Five households were reached, and 3 of them were served more than once.";

    assert.deepEqual(findUnverifiedFigures(narrative, FACTS), []);
  });

  it("accepts a need score quoted from the engine's own reasoning", () => {
    // The facts hand the model a sentence containing "0.73 on need". Repeating
    // it is correct, and flagging it as fabricated would teach a reader to
    // ignore the check entirely.
    const narrative =
      "One household in Holbeck was served 76 times; the engine scored it 0.73 on need.";

    assert.deepEqual(findUnverifiedFigures(narrative, FACTS), []);
  });

  it("accepts dates from the reporting period", () => {
    const narrative =
      "Between 2026-07-30 and 2026-08-29 the pot delivered 374.3 kWh.";

    assert.deepEqual(findUnverifiedFigures(narrative, FACTS), []);
  });

  it("accepts a figure written with or without a thousands separator", () => {
    const facts: ReportFacts = { ...FACTS, totalKwh: 41_300 };

    assert.deepEqual(findUnverifiedFigures("41,300 kWh was delivered.", facts), []);
    assert.deepEqual(findUnverifiedFigures("41300 kWh was delivered.", facts), []);
  });
});

describe("the facts given to the model", () => {
  it("includes every headline figure", () => {
    const described = describeFacts(FACTS);

    for (const expected of [
      "£400.00",
      "£104.81",
      "£295.19",
      "374.3 kWh",
      "Westminster City Council",
      "Winter Support Pot 2026",
      "Household Support Fund",
    ]) {
      assert.ok(
        described.includes(expected),
        `the model was not told about ${expected}`,
      );
    }
  });

  it("explains repeat recipients using the engine's own reasoning", () => {
    const described = describeFacts(FACTS);

    assert.ok(described.includes("REC-05"));
    assert.ok(described.includes("76 times"));
    assert.ok(described.includes("0.73 on need"));
  });

  it("says plainly when no household was served twice", () => {
    const described = describeFacts({ ...FACTS, repeatRecipients: [] });

    assert.ok(described.includes("No household was served more than once."));
  });

  it("carries no personal data", () => {
    // The report is the most quotable artefact this system produces. Nothing
    // that could identify a household may reach it.
    const described = describeFacts(FACTS);

    for (const forbidden of ["prepayment", "health condition", "benefit"]) {
      assert.ok(
        !described.toLowerCase().includes(forbidden),
        `the model was told about "${forbidden}"`,
      );
    }
  });
});
