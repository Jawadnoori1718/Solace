/**
 * Solace — allocation engine tests.
 *
 * The claim under test is the one a civil servant will press hardest on: that
 * the engine is deterministic and replayable, and that no language model
 * participates in deciding who receives energy.
 *
 * Inputs here are hand-written rather than taken from the synthetic data
 * generator. That is deliberate. Testing the engine against data produced by
 * our own simulator would risk proving only that two halves of the same set of
 * assumptions agree with each other.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  allocate,
  ENGINE_VERSION,
  NEED_ELIGIBILITY_THRESHOLD,
} from "../../src/lib/engine/allocate.ts";
import { canonicalJson, digest } from "../../src/lib/engine/digest.ts";
import {
  FAIRNESS_HALF_LIFE_KWH,
  fairnessMultiplier,
} from "../../src/lib/engine/fairness.ts";
import {
  assessNeed,
  consumptionShortfall,
  detectSelfDisconnection,
  epcBandScore,
  estimateBaseLoadKwh,
  FACTOR_WEIGHTS,
} from "../../src/lib/engine/scoring.ts";
import type {
  AllocationInput,
  DayConditions,
  ExporterState,
  RecipientState,
} from "../../src/lib/engine/types.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Half-hourly ISO interval starts for the given hours on a date. */
function intervals(date: string, hours: number[]): string[] {
  return hours.map(
    (hour) =>
      new Date(
        `${date}T${String(Math.floor(hour)).padStart(2, "0")}:${hour % 1 === 0.5 ? "30" : "00"}:00.000Z`,
      ).toISOString(),
  );
}

/** A series with the same value in every listed interval. */
function flat(isoIntervals: string[], kwh: number): Record<string, number> {
  return Object.fromEntries(isoIntervals.map((iso) => [iso, kwh]));
}

const DAY_ONE = "2026-01-10";
const DAY_TWO = "2026-01-11";

const DAYLIGHT = [10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5];
const EVENING = [17, 17.5, 18, 18.5, 19, 19.5, 20, 20.5, 21, 21.5, 22, 22.5];

function makeExporter(overrides: Partial<ExporterState> = {}): ExporterState {
  return {
    reference: "SOL-01",
    displayName: "Test exporter",
    locality: "Adel",
    latitude: 53.848,
    longitude: -1.586,
    surplusKwhByInterval: {
      ...flat(intervals(DAY_ONE, DAYLIGHT), 1),
      ...flat(intervals(DAY_TWO, DAYLIGHT), 1),
    },
    ...overrides,
  };
}

/** A household in genuine difficulty: benefits, band G, health, prepayment. */
function makeHighNeed(overrides: Partial<RecipientState> = {}): RecipientState {
  return {
    reference: "REC-HIGH",
    displayName: "High need household",
    locality: "Holbeck",
    latitude: 53.786,
    longitude: -1.557,
    onMeansTestedBenefit: true,
    epcBand: "G",
    occupants: 1,
    hasChildUnderFive: false,
    hasResidentOverSixtyFive: true,
    hasHealthCondition: true,
    onPrepaymentMeter: true,
    coldWeatherBaselineKwh: 22,
    consumptionKwhByInterval: {
      ...flat(intervals(DAY_ONE, [...DAYLIGHT, ...EVENING]), 0.4),
      ...flat(intervals(DAY_TWO, [...DAYLIGHT, ...EVENING]), 0.4),
    },
    caseNoteVulnerability: null,
    previouslyServedKwh: 0,
    previouslyServedCount: 0,
    ...overrides,
  };
}

/** A comfortable household: no benefits, band C, no health condition. */
function makeLowNeed(overrides: Partial<RecipientState> = {}): RecipientState {
  return {
    reference: "REC-LOW",
    displayName: "Comfortable household",
    locality: "Gipton",
    latitude: 53.811,
    longitude: -1.489,
    onMeansTestedBenefit: false,
    epcBand: "C",
    occupants: 1,
    hasChildUnderFive: false,
    hasResidentOverSixtyFive: false,
    hasHealthCondition: false,
    onPrepaymentMeter: false,
    coldWeatherBaselineKwh: 14,
    consumptionKwhByInterval: {
      ...flat(intervals(DAY_ONE, [...DAYLIGHT, ...EVENING]), 0.4),
      ...flat(intervals(DAY_TWO, [...DAYLIGHT, ...EVENING]), 0.4),
    },
    caseNoteVulnerability: null,
    previouslyServedKwh: 0,
    previouslyServedCount: 0,
    ...overrides,
  };
}

const CONDITIONS: DayConditions[] = [
  { date: DAY_ONE, meanTemperatureC: 4, heatingDegreeHours: 276 },
  { date: DAY_TWO, meanTemperatureC: 4, heatingDegreeHours: 276 },
];

function makeInput(overrides: Partial<AllocationInput> = {}): AllocationInput {
  return {
    potReference: "TEST-POT",
    windowStart: DAY_ONE,
    windowEnd: DAY_TWO,
    seed: "test-seed",
    exporters: [makeExporter()],
    recipients: [makeHighNeed(), makeLowNeed()],
    conditions: CONDITIONS,
    tariffPencePerKwh: 28,
    proximityRadiusKm: 8,
    potBalancePence: 100_000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Determinism — the claim the whole project rests on
// ---------------------------------------------------------------------------

describe("determinism", () => {
  it("produces byte-identical output from the same input", () => {
    const input = makeInput();

    const first = allocate(input);
    const second = allocate(input);

    assert.equal(
      canonicalJson(first.decisions),
      canonicalJson(second.decisions),
      "the same input produced different decisions",
    );
    assert.equal(first.outputDigest, second.outputDigest);
    assert.equal(first.inputDigest, second.inputDigest);
  });

  it("produces byte-identical output from a separately constructed input", () => {
    // Not the same object — an equal one. This catches an engine that is
    // reproducible only because it is quietly caching something.
    const first = allocate(makeInput());
    const second = allocate(makeInput());

    assert.equal(first.outputDigest, second.outputDigest);
    assert.equal(canonicalJson(first), canonicalJson(second));
  });

  it("is unaffected by the order keys were inserted in", () => {
    const input = makeInput();

    // Rebuild every interval map in reverse insertion order. Structurally
    // identical, differently constructed.
    const reversed: AllocationInput = {
      ...input,
      exporters: input.exporters.map((exporter) => ({
        ...exporter,
        surplusKwhByInterval: Object.fromEntries(
          Object.entries(exporter.surplusKwhByInterval).reverse(),
        ),
      })),
      recipients: input.recipients.map((recipient) => ({
        ...recipient,
        consumptionKwhByInterval: Object.fromEntries(
          Object.entries(recipient.consumptionKwhByInterval).reverse(),
        ),
      })),
    };

    assert.equal(allocate(input).outputDigest, allocate(reversed).outputDigest);
    assert.equal(digest(input), digest(reversed));
  });

  it("is unaffected by the order households were listed in", () => {
    const input = makeInput();
    const shuffled = { ...input, recipients: [...input.recipients].reverse() };

    assert.equal(allocate(input).outputDigest, allocate(shuffled).outputDigest);
  });

  it("does not mutate its input", () => {
    const input = makeInput();
    const before = canonicalJson(input);

    allocate(input);

    assert.equal(canonicalJson(input), before, "the engine modified its input");
  });

  it("records the engine version against every decision", () => {
    const result = allocate(makeInput());

    assert.equal(result.engineVersion, ENGINE_VERSION);
    for (const decision of result.decisions) {
      assert.equal(decision.reasoning.engineVersion, ENGINE_VERSION);
    }
  });

  it("changes its output digest when a household's circumstances change", () => {
    // Reproducibility must not mean insensitivity. A different input has to
    // produce a different attestation, or the digest proves nothing.
    const base = allocate(makeInput());
    const changed = allocate(
      makeInput({
        recipients: [makeHighNeed({ epcBand: "A" }), makeLowNeed()],
      }),
    );

    assert.notEqual(base.outputDigest, changed.outputDigest);
  });
});

describe("canonical serialisation", () => {
  it("hashes structurally identical objects identically", () => {
    assert.equal(
      digest({ b: 1, a: { d: 2, c: 3 } }),
      digest({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });

  it("preserves array order, which is meaningful here", () => {
    assert.notEqual(digest([1, 2, 3]), digest([3, 2, 1]));
  });

  it("treats negative zero as zero", () => {
    assert.equal(digest({ value: -0 }), digest({ value: 0 }));
  });
});

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

describe("need scoring", () => {
  it("has weights that sum to one", () => {
    const total = Object.values(FACTOR_WEIGHTS).reduce((sum, w) => sum + w, 0);
    assert.ok(
      Math.abs(total - 1) < 1e-9,
      `weights sum to ${total}, not 1 — scores would not be comparable`,
    );
  });

  it("scores EPC bands from zero at A to one at G", () => {
    assert.equal(epcBandScore("A"), 0);
    assert.equal(epcBandScore("G"), 1);
    assert.ok(epcBandScore("D") > epcBandScore("B"));
    assert.ok(epcBandScore("F") > epcBandScore("D"));
  });

  it("assumes the middle for an unknown EPC band rather than guessing", () => {
    assert.equal(epcBandScore("Z"), 0.5);
  });

  it("scores a household in difficulty above a comfortable one", () => {
    const conditions = new Map(CONDITIONS.map((day) => [day.date, day]));

    const high = assessNeed(makeHighNeed(), conditions);
    const low = assessNeed(makeLowNeed(), conditions);

    assert.ok(
      high.score > low.score,
      `high need scored ${high.score}, comfortable scored ${low.score}`,
    );
  });

  it("keeps every score between zero and one", () => {
    const conditions = new Map(CONDITIONS.map((day) => [day.date, day]));

    for (const recipient of [makeHighNeed(), makeLowNeed()]) {
      const assessment = assessNeed(recipient, conditions);
      assert.ok(assessment.score >= 0 && assessment.score <= 1);
    }
  });

  it("explains every factor it used", () => {
    const conditions = new Map(CONDITIONS.map((day) => [day.date, day]));
    const assessment = assessNeed(makeHighNeed(), conditions);

    for (const factor of assessment.factors) {
      assert.ok(factor.key.length > 0);
      assert.ok(factor.label.length > 0);
      assert.ok(factor.explanation.length > 0, `${factor.key} has no explanation`);
      assert.ok(factor.weight > 0);
    }
  });

  it("does not penalise a household for a missing case note", () => {
    // A gap in the council's records must not read as evidence of comfort.
    const conditions = new Map(CONDITIONS.map((day) => [day.date, day]));

    const withoutNote = assessNeed(
      makeHighNeed({ caseNoteVulnerability: null }),
      conditions,
    );
    const withNeutralNote = assessNeed(
      makeHighNeed({ caseNoteVulnerability: withoutNote.score }),
      conditions,
    );

    // Adding a case note that agrees with the other evidence should leave the
    // score essentially unchanged, because the missing factor was renormalised
    // rather than scored as zero.
    assert.ok(
      Math.abs(withoutNote.score - withNeutralNote.score) < 0.01,
      `renormalisation failed: ${withoutNote.score} became ${withNeutralNote.score}`,
    );
  });

  it("raises the score when case notes describe vulnerability", () => {
    const conditions = new Map(CONDITIONS.map((day) => [day.date, day]));

    const neutral = assessNeed(
      makeLowNeed({ caseNoteVulnerability: 0 }),
      conditions,
    );
    const alarming = assessNeed(
      makeLowNeed({ caseNoteVulnerability: 1 }),
      conditions,
    );

    assert.ok(alarming.score > neutral.score);
  });
});

describe("consumption against expectation", () => {
  const conditions = new Map<string, DayConditions>([
    ["2026-01-01", { date: "2026-01-01", meanTemperatureC: 14, heatingDegreeHours: 36 }],
    ["2026-01-02", { date: "2026-01-02", meanTemperatureC: 13, heatingDegreeHours: 60 }],
    ["2026-01-03", { date: "2026-01-03", meanTemperatureC: 4, heatingDegreeHours: 276 }],
    ["2026-01-04", { date: "2026-01-04", meanTemperatureC: 3, heatingDegreeHours: 300 }],
  ]);

  it("estimates base load from the mildest days", () => {
    const daily = new Map([
      ["2026-01-01", 8],
      ["2026-01-02", 9],
      ["2026-01-03", 24],
      ["2026-01-04", 26],
    ]);

    const baseLoad = estimateBaseLoadKwh(daily, conditions);

    // The three mildest days average (8 + 9 + 24) / 3. The method is blunt with
    // only four days; what matters is that it draws from the mild end.
    assert.ok(baseLoad < 15, `base load ${baseLoad} looks like it included cold days`);
  });

  it("reports no shortfall for a household heating itself properly", () => {
    const daily = new Map([
      ["2026-01-01", 9],
      ["2026-01-02", 10.5],
      ["2026-01-03", 22],
      ["2026-01-04", 23.5],
    ]);

    const { shortfall } = consumptionShortfall(daily, conditions, 22);

    assert.ok(shortfall < 0.12, `unexpected shortfall of ${shortfall}`);
  });

  it("detects a household consuming far less than the cold requires", () => {
    // Same mild days, but the cold days barely move — the signature of a
    // household that cannot afford to turn the heating on.
    const daily = new Map([
      ["2026-01-01", 9],
      ["2026-01-02", 9.2],
      ["2026-01-03", 10],
      ["2026-01-04", 10.2],
    ]);

    const { shortfall } = consumptionShortfall(daily, conditions, 22);

    assert.ok(shortfall > 0.2, `shortfall of ${shortfall} is too small to notice`);
  });

  it("never reports a negative shortfall", () => {
    const daily = new Map([
      ["2026-01-01", 40],
      ["2026-01-02", 40],
      ["2026-01-03", 40],
      ["2026-01-04", 40],
    ]);

    const { shortfall } = consumptionShortfall(daily, conditions, 22);
    assert.ok(shortfall >= 0);
  });
});

describe("self-disconnection detection", () => {
  it("finds a sustained evening outage", () => {
    const series: Record<string, number> = {
      ...flat(intervals(DAY_ONE, EVENING), 0.6),
    };
    // Four consecutive evening periods at almost nothing: the meter ran out.
    for (const iso of intervals(DAY_ONE, [18, 18.5, 19, 19.5])) {
      series[iso] = 0.01;
    }

    const result = detectSelfDisconnection(series);

    assert.ok(result.episodes >= 1, "the outage was not detected");
    assert.ok(result.score > 0);
  });

  it("ignores a household simply being asleep at night", () => {
    // Near-zero consumption at four in the morning is normal, not a crisis.
    const series: Record<string, number> = {
      ...flat(intervals(DAY_ONE, EVENING), 0.6),
      ...flat(intervals(DAY_ONE, [2, 2.5, 3, 3.5, 4, 4.5]), 0.005),
    };

    const result = detectSelfDisconnection(series);

    assert.equal(result.episodes, 0);
  });

  it("judges each household against its own consumption", () => {
    // A single-occupant flat drawing 0.08 kWh a period is living normally, not
    // disconnected. An absolute threshold would flag it; a relative one must not.
    const small = flat(intervals(DAY_ONE, EVENING), 0.08);

    assert.equal(detectSelfDisconnection(small).episodes, 0);
  });

  it("reports nothing when there is no evening data at all", () => {
    const result = detectSelfDisconnection(flat(intervals(DAY_ONE, [3, 3.5]), 0.1));

    assert.equal(result.episodes, 0);
    assert.equal(result.score, 0);
  });
});

// ---------------------------------------------------------------------------
// Fairness
// ---------------------------------------------------------------------------

describe("the fairness constraint", () => {
  it("leaves an unserved household's need untouched", () => {
    assert.equal(fairnessMultiplier(0), 1);
  });

  it("halves priority at the half-life", () => {
    assert.ok(Math.abs(fairnessMultiplier(FAIRNESS_HALF_LIFE_KWH) - 0.5) < 1e-9);
  });

  it("decays monotonically and never reaches zero", () => {
    let previous = 1;
    for (let served = 10; served <= 1_000; served += 10) {
      const multiplier = fairnessMultiplier(served);
      assert.ok(multiplier < previous, "fairness did not decay");
      assert.ok(multiplier > 0, "fairness excluded a household entirely");
      previous = multiplier;
    }
  });

  it("spreads energy rather than giving everything to one household", () => {
    // Two households with identical need. Without a fairness constraint the
    // tie-break would hand everything to whichever won the first round.
    const twin = (reference: string): RecipientState =>
      makeHighNeed({
        reference,
        consumptionKwhByInterval: {
          ...flat(intervals(DAY_ONE, [...DAYLIGHT, ...EVENING]), 0.4),
          ...flat(intervals(DAY_TWO, [...DAYLIGHT, ...EVENING]), 0.4),
        },
      });

    const result = allocate(
      makeInput({ recipients: [twin("REC-AA"), twin("REC-BB")] }),
    );

    const served = new Set(result.decisions.map((d) => d.recipientReference));
    assert.equal(served.size, 2, "one household absorbed the entire pot");
  });

  it("carries prior service into the run", () => {
    const fresh = makeHighNeed({ reference: "REC-FRESH" });
    const alreadyServed = makeHighNeed({
      reference: "REC-SERVED",
      previouslyServedKwh: 500,
      previouslyServedCount: 40,
    });

    // Scarcity has to be real for priority to matter. With surplus exceeding
    // total demand every household is served regardless of ranking, and the
    // binding constraint is how much each was drawing rather than how it
    // ranked — which is exactly what happens on a sunny afternoon. Here the
    // exporter produces less than either household could absorb, so the two
    // genuinely compete.
    const scarce = makeExporter({
      surplusKwhByInterval: {
        ...flat(intervals(DAY_ONE, DAYLIGHT), 0.2),
        ...flat(intervals(DAY_TWO, DAYLIGHT), 0.2),
      },
    });

    const result = allocate(
      makeInput({ exporters: [scarce], recipients: [fresh, alreadyServed] }),
    );

    const kwhFor = (reference: string): number =>
      result.decisions
        .filter((d) => d.recipientReference === reference)
        .reduce((sum, d) => sum + d.kwh, 0);

    assert.ok(
      kwhFor("REC-FRESH") > kwhFor("REC-SERVED"),
      "a heavily-served household was not deprioritised",
    );
  });
});

// ---------------------------------------------------------------------------
// The constraints
// ---------------------------------------------------------------------------

describe("constraints", () => {
  it("never spends more than the pot holds", () => {
    const result = allocate(makeInput({ potBalancePence: 50 }));

    assert.ok(
      result.totalPence <= 50,
      `spent ${result.totalPence}p from a 50p pot`,
    );
  });

  it("says so when the pot runs out", () => {
    const result = allocate(makeInput({ potBalancePence: 50 }));

    assert.ok(result.notes.some((note) => note.includes("exhausted")));
  });

  it("allocates nothing at all from an empty pot", () => {
    const result = allocate(makeInput({ potBalancePence: 0 }));

    assert.equal(result.decisions.length, 0);
    assert.equal(result.totalPence, 0);
  });

  it("never serves a household beyond the proximity radius", () => {
    const distant = makeHighNeed({
      reference: "REC-FAR",
      // Cornwall. Genuinely nowhere near Westminster.
      latitude: 50.26,
      longitude: -5.05,
    });

    const result = allocate(makeInput({ recipients: [distant] }));

    assert.equal(result.decisions.length, 0);
    assert.ok(
      result.unserved.some(
        (entry) =>
          entry.recipientReference === "REC-FAR" && entry.reason.includes("km"),
      ),
      "the distance exclusion was not explained",
    );
  });

  it("never delivers more than a household was drawing at the time", () => {
    // The constraint that keeps the claim physical: surplus at midday cannot
    // warm a house in the evening without storage, and there is no storage.
    const input = makeInput();
    const result = allocate(input);

    const deliveredByDay = new Map<string, number>();
    for (const decision of result.decisions) {
      const key = `${decision.date}|${decision.recipientReference}`;
      deliveredByDay.set(key, (deliveredByDay.get(key) ?? 0) + decision.kwh);
    }

    for (const [key, delivered] of deliveredByDay) {
      const [date, reference] = key.split("|");
      const recipient = input.recipients.find((r) => r.reference === reference);
      assert.ok(recipient !== undefined);

      const consumedThatDay = Object.entries(recipient.consumptionKwhByInterval)
        .filter(([iso]) => iso.startsWith(date))
        .reduce((sum, [, kwh]) => sum + kwh, 0);

      assert.ok(
        delivered <= consumedThatDay + 1e-6,
        `${reference} was given ${delivered} kWh on ${date} but only drew ${consumedThatDay}`,
      );
    }
  });

  it("never delivers more surplus than an exporter produced", () => {
    const input = makeInput();
    const result = allocate(input);

    const available = input.exporters.reduce(
      (sum, exporter) =>
        sum +
        Object.values(exporter.surplusKwhByInterval).reduce((s, kwh) => s + kwh, 0),
      0,
    );

    assert.ok(
      result.totalKwh <= available + 1e-6,
      `delivered ${result.totalKwh} kWh from ${available} kWh of surplus`,
    );
  });

  it("excludes households below the eligibility threshold", () => {
    const result = allocate(makeInput());

    const low = result.assessments.find((a) => a.recipientReference === "REC-LOW");
    assert.ok(low !== undefined);
    assert.ok(low.needScore < NEED_ELIGIBILITY_THRESHOLD);
    assert.equal(low.eligible, false);
    assert.ok(low.ineligibleReason !== null);

    assert.ok(
      !result.decisions.some((d) => d.recipientReference === "REC-LOW"),
      "an ineligible household received support",
    );
  });

  it("makes no allocation smaller than the dust threshold", () => {
    const result = allocate(makeInput());

    for (const decision of result.decisions) {
      assert.ok(decision.kwh >= 0.05, `dust allocation of ${decision.kwh} kWh`);
    }
  });

  it("records surplus it could not place", () => {
    // Surplus at midday with nobody drawing power. Honest accounting requires
    // this to be reported rather than quietly dropped.
    const noDaytimeDemand = makeHighNeed({
      consumptionKwhByInterval: flat(intervals(DAY_ONE, EVENING), 0.4),
    });

    const result = allocate(makeInput({ recipients: [noDaytimeDemand] }));

    assert.ok(result.unallocatedKwh > 0);
  });
});

// ---------------------------------------------------------------------------
// Explanations
// ---------------------------------------------------------------------------

describe("reasoning", () => {
  it("attaches a full explanation to every decision", () => {
    const result = allocate(makeInput());

    assert.ok(result.decisions.length > 0);

    for (const decision of result.decisions) {
      const { reasoning } = decision;

      assert.ok(reasoning.factors.length > 0, "no factors recorded");
      assert.ok(reasoning.summary.length > 20, "summary is not a sentence");
      assert.ok(reasoning.fairness.note.length > 0);
      assert.ok(reasoning.proximity.distanceKm >= 0);
      assert.ok(
        reasoning.proximity.distanceKm <= reasoning.proximity.withinRadiusKm,
      );
      assert.ok(reasoning.needScore >= 0 && reasoning.needScore <= 1);
      assert.ok(
        reasoning.fairnessMultiplier > 0 && reasoning.fairnessMultiplier <= 1,
      );
    }
  });

  it("shows arithmetic a reader can check", () => {
    const result = allocate(makeInput());
    const decision = result.decisions[0];

    // The need score is the sum of contributions, divided by the weight
    // actually used. A reader adding up the published column must arrive at the
    // published total.
    const contributions = decision.reasoning.factors.reduce(
      (sum, factor) => sum + factor.contribution,
      0,
    );
    const weights = decision.reasoning.factors.reduce(
      (sum, factor) => sum + factor.weight,
      0,
    );

    assert.ok(
      Math.abs(contributions / weights - decision.reasoning.needScore) < 0.001,
      `published factors sum to ${contributions / weights}, score says ${decision.reasoning.needScore}`,
    );
  });

  it("states the priority as need multiplied by fairness", () => {
    const result = allocate(makeInput());

    for (const decision of result.decisions) {
      const { needScore, fairnessMultiplier: multiplier, priorityScore } =
        decision.reasoning;

      assert.ok(
        Math.abs(needScore * multiplier - priorityScore) < 0.001,
        `${needScore} × ${multiplier} should be ${priorityScore}`,
      );
    }
  });

  it("gives a reason for every household that received nothing", () => {
    const result = allocate(makeInput());

    const served = new Set(result.decisions.map((d) => d.recipientReference));
    const explained = new Set(result.unserved.map((u) => u.recipientReference));

    for (const recipient of makeInput().recipients) {
      if (served.has(recipient.reference)) continue;
      assert.ok(
        explained.has(recipient.reference),
        `${recipient.reference} received nothing and was not explained`,
      );
    }

    for (const entry of result.unserved) {
      assert.ok(entry.reason.length > 20, "the reason is not a sentence");
    }
  });

  it("publishes an assessment for every household, served or not", () => {
    const input = makeInput();
    const result = allocate(input);

    assert.equal(result.assessments.length, input.recipients.length);
  });

  it("costs each allocation at the stated tariff", () => {
    const result = allocate(makeInput({ tariffPencePerKwh: 28 }));

    for (const decision of result.decisions) {
      assert.equal(decision.pencePerKwh, 28);
      assert.equal(decision.amountPence, Math.round(decision.kwh * 28));
      assert.equal(decision.milliKwh, Math.round(decision.kwh * 1000));
    }
  });

  it("ranks decisions with the neediest match first", () => {
    const result = allocate(
      makeInput({
        recipients: [
          makeHighNeed({ reference: "REC-AA" }),
          makeHighNeed({ reference: "REC-BB", epcBand: "D", hasHealthCondition: false }),
        ],
      }),
    );

    const ranks = result.decisions.map((d) => d.rank).toSorted((a, b) => a - b);
    assert.deepEqual(
      ranks,
      Array.from({ length: result.decisions.length }, (_, i) => i + 1),
      "ranks are not a contiguous sequence from 1",
    );

    const byRank = [...result.decisions].sort((a, b) => a.rank - b.rank);
    for (let i = 1; i < byRank.length; i++) {
      assert.ok(
        byRank[i - 1].reasoning.priorityScore >= byRank[i].reasoning.priorityScore,
        "a lower-priority decision outranked a higher one",
      );
    }
  });

  it("gives every decision a stable, meaningful identifier", () => {
    const first = allocate(makeInput());
    const second = allocate(makeInput());

    assert.deepEqual(
      first.decisions.map((d) => d.id),
      second.decisions.map((d) => d.id),
    );

    const ids = new Set(first.decisions.map((d) => d.id));
    assert.equal(ids.size, first.decisions.length, "identifiers are not unique");
  });
});

// ---------------------------------------------------------------------------
// Degenerate inputs
// ---------------------------------------------------------------------------

describe("degenerate inputs", () => {
  it("copes with no exporters", () => {
    const result = allocate(makeInput({ exporters: [] }));

    assert.equal(result.decisions.length, 0);
    assert.equal(result.totalKwh, 0);
  });

  it("copes with no recipients", () => {
    const result = allocate(makeInput({ recipients: [] }));

    assert.equal(result.decisions.length, 0);
    assert.equal(result.unserved.length, 0);
  });

  it("copes with no weather data", () => {
    const result = allocate(makeInput({ conditions: [] }));

    // Without a temperature series there are no days to walk, so nothing is
    // allocated. Silence is the right answer; a guess would not be.
    assert.equal(result.decisions.length, 0);
  });

  it("ignores days outside the window", () => {
    const narrow = allocate(
      makeInput({ windowStart: DAY_ONE, windowEnd: DAY_ONE }),
    );
    const wide = allocate(makeInput());

    assert.ok(narrow.decisions.every((d) => d.date === DAY_ONE));
    assert.ok(wide.decisions.length > narrow.decisions.length);
  });
});
