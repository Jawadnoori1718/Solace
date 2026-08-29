/**
 * Solace — seed the database.
 *
 *   npm run db:seed
 *
 * Builds the entire demo universe: one council pot, three exporting households,
 * eight recipient households, thirty days of half-hourly meter data and the
 * council's case notes about each recipient.
 *
 * Everything is derived from a single seed string, so running this twice
 * produces byte-identical data. That is what makes the allocation engine's
 * reproducibility claim checkable rather than merely stated — a reviewer can
 * regenerate the exact dataset the engine ran against and re-derive its
 * decisions from scratch.
 */

import {
  DEMO_POT,
  EXPORTERS,
  RECIPIENTS,
  householdId,
} from "../src/lib/synthetic/households.ts";
import {
  generateExporterReadings,
  generateRecipientReadings,
  type GeneratedReading,
} from "../src/lib/synthetic/meter.ts";
import {
  generateWeatherSeries,
  isoDate,
  startOfUtcDay,
} from "../src/lib/synthetic/weather.ts";
import { HouseholdRole, MeterChannel } from "../src/lib/domain.ts";
import { formatKwh, formatPence } from "../src/lib/format.ts";
import { loadEnvFiles } from "../src/lib/env-file.ts";
import { prisma } from "../src/lib/db.ts";
import { recipientHash } from "../src/lib/privacy.ts";

loadEnvFiles();

/** Days of history to generate before the end date. */
const HISTORY_DAYS = 30;

/**
 * The seed that determines every random value in the dataset.
 *
 * Change it and you get a different but equally valid month of data. Leave it
 * and everyone who clones this repository gets the same one.
 */
const DATA_SEED = process.env.SOLACE_DATA_SEED?.trim() || "solace-2026";

/**
 * The last day of generated data.
 *
 * Defaults to today, so a fresh clone always has data up to the present and the
 * dashboard is never showing a stale month. Override to pin the window — for
 * example to generate a cold snap in January rather than whatever the weather
 * happens to be on the day of a demonstration.
 */
function resolveEndDate(): Date {
  const override = process.env.SOLACE_SEED_END_DATE?.trim();
  if (override) {
    const parsed = new Date(`${override}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(
        `SOLACE_SEED_END_DATE is not a valid date: "${override}". Expected YYYY-MM-DD.`,
      );
    }
    return startOfUtcDay(parsed);
  }
  return startOfUtcDay(new Date());
}

/** Deterministic identifier for a reading. */
function readingId(reading: GeneratedReading): string {
  const stamp = reading.intervalStart.toISOString().slice(0, 16).replace(/[-:T]/g, "");
  return `mr_${reading.householdReference}_${stamp}_${reading.channel[0]}`;
}

async function main(): Promise<void> {
  const endDate = resolveEndDate();
  const startDate = new Date(endDate.getTime() - HISTORY_DAYS * 86_400_000);

  console.log(`\nSeeding Solace`);
  console.log(`  Seed      ${DATA_SEED}`);
  console.log(`  Window    ${isoDate(startDate)} to ${isoDate(endDate)}`);
  console.log(`  Universe  ${EXPORTERS.length} exporting, ${RECIPIENTS.length} recipient households`);

  // Clear in dependency order. Deleting the pot and households would cascade,
  // but being explicit means this still reads correctly if the schema changes.
  console.log(`\n  Clearing existing data`);
  await prisma.weatherObservation.deleteMany();
  await prisma.settlement.deleteMany();
  await prisma.allocation.deleteMany();
  await prisma.allocationRun.deleteMany();
  await prisma.report.deleteMany();
  await prisma.needSignal.deleteMany();
  await prisma.meterReading.deleteMany();
  await prisma.deposit.deleteMany();
  await prisma.household.deleteMany();
  await prisma.pot.deleteMany();

  // -- The pot ------------------------------------------------------------

  await prisma.pot.create({
    data: {
      id: DEMO_POT.id,
      reference: DEMO_POT.reference,
      name: DEMO_POT.name,
      councilName: DEMO_POT.councilName,
      fundingSource: DEMO_POT.fundingSource,
    },
  });
  console.log(`  Pot       ${DEMO_POT.name} (${DEMO_POT.reference})`);

  // -- Households ---------------------------------------------------------

  await prisma.household.createMany({
    data: EXPORTERS.map((exporter) => ({
      id: householdId(exporter.reference),
      reference: exporter.reference,
      role: HouseholdRole.EXPORTER,
      displayName: exporter.displayName,
      locality: exporter.locality,
      latitude: exporter.latitude,
      longitude: exporter.longitude,
      solarCapacityKw: exporter.solarCapacityKw,
    })),
  });

  await prisma.household.createMany({
    data: RECIPIENTS.map((recipient) => ({
      id: householdId(recipient.reference),
      reference: recipient.reference,
      role: HouseholdRole.RECIPIENT,
      displayName: recipient.displayName,
      locality: recipient.locality,
      latitude: recipient.latitude,
      longitude: recipient.longitude,
      onMeansTestedBenefit: recipient.onMeansTestedBenefit,
      epcBand: recipient.epcBand,
      occupants: recipient.occupants,
      hasChildUnderFive: recipient.hasChildUnderFive,
      hasResidentOverSixtyFive: recipient.hasResidentOverSixtyFive,
      hasHealthCondition: recipient.hasHealthCondition,
      onPrepaymentMeter: recipient.onPrepaymentMeter,
      coldWeatherBaselineKwh: recipient.coldWeatherBaselineKwh,
      // The only identifier that ever reaches the chain.
      recipientHash: recipientHash(recipient.reference),
    })),
  });
  console.log(`  Households ${EXPORTERS.length + RECIPIENTS.length} created`);

  // -- Case notes ---------------------------------------------------------

  const needSignals = RECIPIENTS.flatMap((recipient) =>
    recipient.caseNotes.map((note, index) => ({
      id: `ns_${recipient.reference.toLowerCase()}_${index + 1}`,
      householdId: householdId(recipient.reference),
      recordedAt: new Date(endDate.getTime() - note.daysAgo * 86_400_000),
      caseNote: note.text,
      // Deliberately left unparsed. The AI parser fills these in, and until it
      // has run the engine simply has no case-note signal to work with.
      parsedJson: null,
      vulnerabilityScore: null,
      parserModel: null,
      parserVersion: null,
      parsedAt: null,
    })),
  );

  await prisma.needSignal.createMany({ data: needSignals });
  console.log(`  Case notes ${needSignals.length} recorded, none parsed yet`);

  // -- Weather ------------------------------------------------------------

  const weather = generateWeatherSeries(startDate, endDate, DATA_SEED);

  const temperatures = [...weather.values()].map((d) => d.meanTemperatureC);
  const coldest = Math.min(...temperatures);
  const warmest = Math.max(...temperatures);
  console.log(
    `  Weather   ${weather.size} days, daily means ${coldest.toFixed(1)}°C to ${warmest.toFixed(1)}°C`,
  );

  // The allocation engine needs a temperature series to say "this household is
  // using less than the weather requires". Without it a cold home and a frugal
  // one are indistinguishable.
  await prisma.weatherObservation.createMany({
    data: [...weather.values()].map((day) => ({
      id: `wx_${isoDate(day.date)}`,
      date: day.date,
      meanTemperatureC: Math.round(day.meanTemperatureC * 100) / 100,
      heatingDegreeHours: Math.round(day.heatingDegreeHours * 100) / 100,
      simulated: true,
    })),
  });

  // -- Meter readings -----------------------------------------------------

  const readings: GeneratedReading[] = [];

  for (const exporter of EXPORTERS) {
    readings.push(
      ...generateExporterReadings(exporter, weather, startDate, endDate, DATA_SEED),
    );
  }

  for (const recipient of RECIPIENTS) {
    readings.push(
      ...generateRecipientReadings(recipient, weather, startDate, endDate, DATA_SEED),
    );
  }

  // SQLite has a limit on how many parameters one statement may bind, so this
  // is written in chunks rather than as a single enormous insert.
  const CHUNK_SIZE = 2_000;
  for (let offset = 0; offset < readings.length; offset += CHUNK_SIZE) {
    const chunk = readings.slice(offset, offset + CHUNK_SIZE);
    await prisma.meterReading.createMany({
      data: chunk.map((reading) => ({
        id: readingId(reading),
        householdId: householdId(reading.householdReference),
        intervalStart: reading.intervalStart,
        channel: reading.channel,
        kwh: reading.kwh,
        simulated: true,
      })),
    });
  }

  console.log(`  Readings  ${readings.length.toLocaleString("en-GB")} half-hourly records`);

  await reportSummary(readings);
}

/**
 * Print what was generated, in the terms the demonstration cares about.
 *
 * This is a sanity check as much as a progress report. If surplus were larger
 * than demand the allocation engine would have nothing to decide, and the whole
 * exercise would be trivial. Seeing the two figures side by side confirms the
 * problem is real.
 */
async function reportSummary(readings: GeneratedReading[]): Promise<void> {
  const totalExportKwh = readings
    .filter((r) => r.channel === MeterChannel.EXPORT)
    .reduce((sum, r) => sum + r.kwh, 0);

  const recipientReferences = new Set(RECIPIENTS.map((r) => r.reference));
  const totalDemandKwh = readings
    .filter(
      (r) =>
        r.channel === MeterChannel.CONSUMPTION &&
        recipientReferences.has(r.householdReference),
    )
    .reduce((sum, r) => sum + r.kwh, 0);

  const tariff = Number(process.env.SOLACE_TARIFF_PENCE_PER_KWH ?? 28);

  console.log(`\n  Over the window`);
  console.log(`    Surplus available   ${formatKwh(totalExportKwh)}`);
  console.log(`    Recipient demand    ${formatKwh(totalDemandKwh)}`);
  console.log(
    `    Surplus covers      ${((totalExportKwh / totalDemandKwh) * 100).toFixed(1)}% of demand`,
  );
  console.log(
    `    Surplus worth       ${formatPence(Math.round(totalExportKwh * tariff))} at ${tariff}p per kWh`,
  );
  console.log(
    `    Pot                 ${formatPence(DEMO_POT.openingDepositPence)}`,
  );

  console.log(`\n  Per recipient, daily average`);
  for (const recipient of RECIPIENTS) {
    const householdReadings = readings.filter(
      (r) => r.householdReference === recipient.reference,
    );
    const total = householdReadings.reduce((sum, r) => sum + r.kwh, 0);
    const days = householdReadings.length / 48;
    const daily = total / days;
    const share = (daily / recipient.coldWeatherBaselineKwh) * 100;

    console.log(
      `    ${recipient.reference}  ${daily.toFixed(1).padStart(5)} kWh` +
        `  (${share.toFixed(0).padStart(3)}% of its cold-weather baseline)` +
        `  ${recipient.locality}`,
    );
  }

  console.log("");
}

try {
  await main();
} catch (error) {
  console.error(
    `\nSeeding failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
