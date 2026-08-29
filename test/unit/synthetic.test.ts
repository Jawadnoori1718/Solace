/**
 * Solace — tests for the synthetic data generator.
 *
 * The central claim being tested is reproducibility. Solace tells councillors
 * that allocation decisions can be replayed and checked; that is only true if
 * the data underneath them can be regenerated exactly. These tests hold the
 * generator to that, and they also check that the physics is not nonsense —
 * that the sun does not shine at midnight and that winter days are shorter than
 * summer ones.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createRng } from "../../src/lib/synthetic/rng.ts";
import {
  clearSkyIrradiance,
  dayOfYear,
  halfHourlyGenerationKwh,
  solarDeclination,
  solarElevation,
} from "../../src/lib/synthetic/solar.ts";
import {
  generateDayWeather,
  generateWeatherSeries,
  PERIODS_PER_DAY,
} from "../../src/lib/synthetic/weather.ts";
import {
  generateExporterReadings,
  generateRecipientReadings,
} from "../../src/lib/synthetic/meter.ts";
import {
  EXPORTERS,
  PILOT_LOCATION,
  RECIPIENTS,
} from "../../src/lib/synthetic/households.ts";
import { distanceKm } from "../../src/lib/geo.ts";
import {
  matchesRecipientHash,
  recipientHash,
} from "../../src/lib/privacy.ts";
import { MeterChannel } from "../../src/lib/domain.ts";

const SEED = "test-seed";
const FROM = new Date("2026-08-01T00:00:00.000Z");
const TO = new Date("2026-08-07T00:00:00.000Z");

// ---------------------------------------------------------------------------
// Reproducibility
// ---------------------------------------------------------------------------

describe("deterministic randomness", () => {
  it("produces an identical sequence for the same seed", () => {
    const first = Array.from({ length: 200 }, () => createRng("abc").next());
    const second = Array.from({ length: 200 }, () => createRng("abc").next());

    assert.deepEqual(first, second);
  });

  it("produces a different sequence for a different seed", () => {
    const a = createRng("abc");
    const b = createRng("abd");

    const left = Array.from({ length: 50 }, () => a.next());
    const right = Array.from({ length: 50 }, () => b.next());

    assert.notDeepEqual(left, right);
  });

  it("decorrelates seeds that differ only in their last character", () => {
    // Household seeds look like "seed:REC-01:2026-08-14". If nearly-identical
    // seeds produced correlated streams, every household would experience the
    // same weather-independent luck on the same day.
    const streams = ["REC-01", "REC-02", "REC-03"].map((reference) => {
      const rng = createRng(`seed:${reference}:2026-08-14`);
      return Array.from({ length: 30 }, () => rng.next());
    });

    const meanAbsoluteDifference =
      streams[0].reduce((sum, value, i) => sum + Math.abs(value - streams[1][i]), 0) /
      streams[0].length;

    // Two independent uniform streams differ by 1/3 on average. Correlated
    // ones would differ by far less.
    assert.ok(
      meanAbsoluteDifference > 0.2,
      `streams look correlated: mean absolute difference ${meanAbsoluteDifference}`,
    );
  });

  it("stays within its stated bounds", () => {
    const rng = createRng("bounds");

    for (let i = 0; i < 1_000; i++) {
      const value = rng.next();
      assert.ok(value >= 0 && value < 1);

      const between = rng.between(5, 9);
      assert.ok(between >= 5 && between < 9);

      const integer = rng.int(1, 6);
      assert.ok(Number.isInteger(integer) && integer >= 1 && integer <= 6);
    }
  });
});

describe("reproducibility of the dataset", () => {
  it("regenerates identical weather from the same seed", () => {
    const first = generateWeatherSeries(FROM, TO, SEED);
    const second = generateWeatherSeries(FROM, TO, SEED);

    assert.equal(
      JSON.stringify([...first.entries()]),
      JSON.stringify([...second.entries()]),
    );
  });

  it("regenerates a single day identically without walking the month", () => {
    // A reviewer checking one afternoon should not have to replay the whole
    // window to get the same numbers.
    const series = generateWeatherSeries(FROM, TO, SEED);
    const standalone = generateDayWeather(
      new Date("2026-08-05T00:00:00.000Z"),
      SEED,
    );

    assert.deepEqual(series.get("2026-08-05"), standalone);
  });

  it("regenerates identical exporter readings from the same seed", () => {
    const weather = generateWeatherSeries(FROM, TO, SEED);

    const first = generateExporterReadings(EXPORTERS[0], weather, FROM, TO, SEED);
    const second = generateExporterReadings(EXPORTERS[0], weather, FROM, TO, SEED);

    assert.equal(JSON.stringify(first), JSON.stringify(second));
    assert.ok(first.length > 0);
  });

  it("regenerates identical recipient readings from the same seed", () => {
    const weather = generateWeatherSeries(FROM, TO, SEED);

    const first = generateRecipientReadings(RECIPIENTS[0], weather, FROM, TO, SEED);
    const second = generateRecipientReadings(RECIPIENTS[0], weather, FROM, TO, SEED);

    assert.equal(JSON.stringify(first), JSON.stringify(second));
  });

  it("produces different data for a different seed", () => {
    const weatherA = generateWeatherSeries(FROM, TO, "seed-a");
    const weatherB = generateWeatherSeries(FROM, TO, "seed-b");

    const a = generateRecipientReadings(RECIPIENTS[0], weatherA, FROM, TO, "seed-a");
    const b = generateRecipientReadings(RECIPIENTS[0], weatherB, FROM, TO, "seed-b");

    assert.notEqual(JSON.stringify(a), JSON.stringify(b));
  });
});

// ---------------------------------------------------------------------------
// The physics
// ---------------------------------------------------------------------------

describe("solar geometry", () => {
  it("puts the sun below the horizon at midnight", () => {
    const midnight = new Date("2026-06-21T00:00:00.000Z");
    const elevation = solarElevation(
      midnight,
      PILOT_LOCATION.latitude,
      PILOT_LOCATION.longitude,
    );

    assert.ok(elevation < 0, `expected the sun below the horizon, got ${elevation}°`);
  });

  it("puts the sun highest around midday", () => {
    const day = "2026-06-21";
    const elevations = Array.from({ length: 24 }, (_, hour) =>
      solarElevation(
        new Date(`${day}T${String(hour).padStart(2, "0")}:00:00.000Z`),
        PILOT_LOCATION.latitude,
        PILOT_LOCATION.longitude,
      ),
    );

    const highest = elevations.indexOf(Math.max(...elevations));
    // Leeds is just west of Greenwich, so solar noon falls a few minutes after
    // 12:00 UTC.
    assert.ok(highest >= 11 && highest <= 13, `peak elevation at ${highest}:00`);
  });

  it("makes midsummer days longer than midwinter ones", () => {
    const daylightHours = (date: string): number => {
      let count = 0;
      for (let period = 0; period < PERIODS_PER_DAY; period++) {
        const at = new Date(
          new Date(`${date}T00:00:00.000Z`).getTime() + period * 30 * 60_000,
        );
        if (
          solarElevation(at, PILOT_LOCATION.latitude, PILOT_LOCATION.longitude) > 0
        ) {
          count += 0.5;
        }
      }
      return count;
    };

    const june = daylightHours("2026-06-21");
    const december = daylightHours("2026-12-21");

    assert.ok(june > 16, `expected a long midsummer day, got ${june} hours`);
    assert.ok(december < 8.5, `expected a short midwinter day, got ${december} hours`);
  });

  it("tilts the sun north in summer and south in winter", () => {
    assert.ok(solarDeclination(dayOfYear(new Date("2026-06-21T12:00:00Z"))) > 23);
    assert.ok(solarDeclination(dayOfYear(new Date("2026-12-21T12:00:00Z"))) < -23);
  });

  it("produces no irradiance below the horizon", () => {
    assert.equal(clearSkyIrradiance(-1), 0);
    assert.equal(clearSkyIrradiance(0), 0);
    assert.ok(clearSkyIrradiance(60) > 700);
  });

  it("generates nothing overnight and something at midday", () => {
    const night = halfHourlyGenerationKwh(
      new Date("2026-08-01T01:00:00.000Z"),
      4.2,
      1,
      PILOT_LOCATION.latitude,
      PILOT_LOCATION.longitude,
    );
    const midday = halfHourlyGenerationKwh(
      new Date("2026-08-01T12:00:00.000Z"),
      4.2,
      1,
      PILOT_LOCATION.latitude,
      PILOT_LOCATION.longitude,
    );

    assert.equal(night, 0);
    assert.ok(midday > 1, `expected meaningful midday output, got ${midday} kWh`);
  });

  it("never exceeds the array's nameplate capacity", () => {
    // Half an hour at full rated power is capacity/2 kWh. Nothing should beat
    // that, cloudless or not.
    const capacity = 4.2;
    for (let period = 0; period < PERIODS_PER_DAY; period++) {
      const at = new Date(
        new Date("2026-06-21T00:00:00.000Z").getTime() + period * 30 * 60_000,
      );
      const kwh = halfHourlyGenerationKwh(
        at,
        capacity,
        1,
        PILOT_LOCATION.latitude,
        PILOT_LOCATION.longitude,
      );
      assert.ok(kwh <= capacity / 2, `${kwh} kWh exceeds nameplate in period ${period}`);
    }
  });
});

describe("weather", () => {
  it("gives every half-hourly period a temperature and a cloud factor", () => {
    const day = generateDayWeather(new Date("2026-01-15T00:00:00.000Z"), SEED);

    assert.equal(day.temperatureC.length, PERIODS_PER_DAY);
    assert.equal(day.cloudFactor.length, PERIODS_PER_DAY);
    assert.ok(day.cloudFactor.every((c) => c >= 0.15 && c <= 1));
  });

  it("makes winter colder than summer", () => {
    const january = generateDayWeather(new Date("2026-01-15T00:00:00.000Z"), SEED);
    const july = generateDayWeather(new Date("2026-07-15T00:00:00.000Z"), SEED);

    assert.ok(
      january.meanTemperatureC < july.meanTemperatureC,
      `January ${january.meanTemperatureC}°C was not colder than July ${july.meanTemperatureC}°C`,
    );
  });

  it("accumulates heating degree-hours only when it is cold", () => {
    const january = generateDayWeather(new Date("2026-01-15T00:00:00.000Z"), SEED);
    const july = generateDayWeather(new Date("2026-07-15T00:00:00.000Z"), SEED);

    assert.ok(january.heatingDegreeHours > july.heatingDegreeHours);
    assert.ok(january.heatingDegreeHours > 0);
  });

  it("keeps cloud cover autocorrelated rather than flickering", () => {
    // Real weather persists. If consecutive half-hours were independent draws,
    // generation would jump between full sun and overcast every thirty minutes.
    const day = generateDayWeather(new Date("2026-04-10T00:00:00.000Z"), SEED);

    let totalStep = 0;
    for (let i = 1; i < day.cloudFactor.length; i++) {
      totalStep += Math.abs(day.cloudFactor[i] - day.cloudFactor[i - 1]);
    }
    const meanStep = totalStep / (day.cloudFactor.length - 1);

    // Independent uniform draws over this range would step by roughly 0.28 on
    // average. A correlated series steps far less.
    assert.ok(meanStep < 0.12, `cloud series is not persistent: mean step ${meanStep}`);
  });
});

// ---------------------------------------------------------------------------
// The readings
// ---------------------------------------------------------------------------

describe("meter readings", () => {
  const weather = generateWeatherSeries(FROM, TO, SEED);

  it("records both consumption and export for a solar household", () => {
    const readings = generateExporterReadings(EXPORTERS[0], weather, FROM, TO, SEED);

    const channels = new Set(readings.map((r) => r.channel));
    assert.deepEqual([...channels].sort(), [
      MeterChannel.CONSUMPTION,
      MeterChannel.EXPORT,
    ]);
  });

  it("covers every half-hourly period of every day", () => {
    const days = 7;
    const readings = generateRecipientReadings(
      RECIPIENTS[0],
      weather,
      FROM,
      TO,
      SEED,
    );

    assert.equal(readings.length, days * PERIODS_PER_DAY);
  });

  it("never records negative energy", () => {
    for (const household of RECIPIENTS) {
      const readings = generateRecipientReadings(
        household,
        weather,
        FROM,
        TO,
        SEED,
      );
      assert.ok(
        readings.every((r) => r.kwh >= 0),
        `${household.reference} produced a negative reading`,
      );
    }
  });

  it("exports nothing overnight", () => {
    const readings = generateExporterReadings(EXPORTERS[0], weather, FROM, TO, SEED);

    const overnight = readings.filter(
      (r) =>
        r.channel === MeterChannel.EXPORT &&
        (r.intervalStart.getUTCHours() < 3 || r.intervalStart.getUTCHours() >= 22),
    );

    assert.ok(overnight.length > 0);
    assert.ok(
      overnight.every((r) => r.kwh === 0),
      "a solar array exported energy in the middle of the night",
    );
  });

  it("shows rationing households consuming less than comfortable ones", () => {
    // The signal the allocation engine depends on. REC-05 rations heavily;
    // REC-08 does not. Compared against their own cold-weather baselines, the
    // rationing household must sit lower.
    const share = (reference: string): number => {
      const household = RECIPIENTS.find((r) => r.reference === reference);
      if (household === undefined) throw new Error(`unknown household ${reference}`);

      const readings = generateRecipientReadings(household, weather, FROM, TO, SEED);
      const days = readings.length / PERIODS_PER_DAY;
      const daily = readings.reduce((sum, r) => sum + r.kwh, 0) / days;

      return daily / household.coldWeatherBaselineKwh;
    };

    assert.ok(
      share("REC-05") < share("REC-08"),
      "the rationing household is not consuming less than the comfortable one",
    );
  });

  it("gives prepayment households sustained low-consumption spells", () => {
    // Self-disconnection: the meter runs out and stays out for hours. Measured
    // against each household's own median, so a small household is not
    // mistaken for a disconnected one.
    const longestRun = (reference: string): number => {
      const household = RECIPIENTS.find((r) => r.reference === reference);
      if (household === undefined) throw new Error(`unknown household ${reference}`);

      const readings = generateRecipientReadings(household, weather, FROM, TO, SEED);
      const sorted = readings.map((r) => r.kwh).toSorted((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];

      let run = 0;
      let longest = 0;
      for (const reading of readings) {
        run = reading.kwh < median * 0.25 ? run + 1 : 0;
        longest = Math.max(longest, run);
      }
      return longest;
    };

    // REC-05 is on a prepayment meter and rations severely.
    assert.ok(
      longestRun("REC-05") >= 2,
      "expected a self-disconnection spell for the prepayment household",
    );
  });
});

// ---------------------------------------------------------------------------
// The universe
// ---------------------------------------------------------------------------

describe("the demo universe", () => {
  it("has three exporters and eight recipients", () => {
    assert.equal(EXPORTERS.length, 3);
    assert.equal(RECIPIENTS.length, 8);
  });

  it("uses unique household references", () => {
    const references = [...EXPORTERS, ...RECIPIENTS].map((h) => h.reference);
    assert.equal(new Set(references).size, references.length);
  });

  it("places every recipient within reach of at least one exporter", () => {
    // If a recipient sat outside every exporter's radius it could never be
    // served, and its presence in the data would be misleading.
    for (const recipient of RECIPIENTS) {
      const nearest = Math.min(
        ...EXPORTERS.map((exporter) => distanceKm(exporter, recipient)),
      );
      assert.ok(
        nearest <= 8,
        `${recipient.reference} in ${recipient.locality} is ${nearest.toFixed(1)} km from the nearest exporter`,
      );
    }
  });

  it("spans a range of need rather than eight identical households", () => {
    const onBenefits = RECIPIENTS.filter((r) => r.onMeansTestedBenefit).length;
    const onPrepayment = RECIPIENTS.filter((r) => r.onPrepaymentMeter).length;
    const bands = new Set(RECIPIENTS.map((r) => r.epcBand));

    assert.ok(onBenefits > 0 && onBenefits < RECIPIENTS.length);
    assert.ok(onPrepayment > 0 && onPrepayment < RECIPIENTS.length);
    assert.ok(bands.size >= 4, "EPC bands are not varied enough to discriminate");
  });

  it("gives every recipient at least one case note", () => {
    for (const recipient of RECIPIENTS) {
      assert.ok(
        recipient.caseNotes.length > 0,
        `${recipient.reference} has no case note for the parser to read`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------

describe("recipient hashing", () => {
  const SALT = "a-test-salt";

  it("produces a 32-byte hex value suitable for bytes32", () => {
    const hash = recipientHash("REC-01", SALT);

    assert.match(hash, /^0x[0-9a-f]{64}$/);
  });

  it("is stable for the same reference and salt", () => {
    assert.equal(recipientHash("REC-01", SALT), recipientHash("REC-01", SALT));
  });

  it("differs between households", () => {
    assert.notEqual(recipientHash("REC-01", SALT), recipientHash("REC-02", SALT));
  });

  it("differs under a different salt", () => {
    // This is the property that defeats brute force. Without the salt, an
    // attacker cannot compute the hash of a guessed reference at all.
    assert.notEqual(recipientHash("REC-01", SALT), recipientHash("REC-01", "other"));
  });

  it("leaks nothing about the reference it came from", () => {
    const hash = recipientHash("REC-01", SALT);

    assert.ok(!hash.toLowerCase().includes("rec"));
    assert.ok(!hash.includes("01"));
  });

  it("verifies a reference against its hash", () => {
    const hash = recipientHash("REC-03", SALT);

    assert.equal(matchesRecipientHash("REC-03", hash, SALT), true);
    assert.equal(matchesRecipientHash("REC-04", hash, SALT), false);
  });
});
