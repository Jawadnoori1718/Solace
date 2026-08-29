/**
 * Solace — synthetic half-hourly meter data.
 *
 * SIMULATED. We have no smart meter access and the interface says so wherever
 * this data appears. The integration path for a real deployment is the Data
 * Communications Company and supplier APIs, which expose exactly this shape:
 * half-hourly consumption and export per meter point.
 *
 * The generator is built so that the patterns the allocation engine looks for
 * are genuinely present in the readings rather than asserted alongside them.
 * In particular, a household that rations electricity shows up here as
 * consumption falling below what the weather says it should be — which is a
 * thing the engine can measure from the readings alone, without being told.
 */

import { MeterChannel } from "../domain.ts";
import { clamp, createRng } from "./rng.ts";
import type {
  ExporterDefinition,
  RecipientDefinition,
} from "./households.ts";
import { PILOT_LOCATION } from "./households.ts";
import { halfHourlyGenerationKwh } from "./solar.ts";
import {
  HEATING_BASE_TEMP_C,
  PERIODS_PER_DAY,
  isoDate,
  startOfUtcDay,
  type DayWeather,
} from "./weather.ts";

export interface GeneratedReading {
  householdReference: string;
  intervalStart: Date;
  channel: MeterChannel;
  kwh: number;
}

/**
 * When a household uses electricity for things other than heating.
 *
 * Two peaks, morning and evening, with a trough overnight. Relative weights;
 * they are normalised to average one before use, so changing the shape does not
 * change a household's daily total.
 */
const ACTIVITY_WEIGHTS: readonly number[] = buildActivityWeights();

function buildActivityWeights(): number[] {
  const weights = new Array<number>(PERIODS_PER_DAY);

  for (let period = 0; period < PERIODS_PER_DAY; period++) {
    const hour = period / 2;

    let weight: number;
    if (hour < 6) {
      weight = 0.38; // Asleep. Fridge, standby, not much else.
    } else if (hour < 9) {
      weight = 1.65; // Kettles, showers, getting out of the house.
    } else if (hour < 16) {
      weight = 0.76; // Daytime.
    } else if (hour < 22) {
      weight = 1.82; // Cooking, lighting, television.
    } else {
      weight = 0.88; // Winding down.
    }

    weights[period] = weight;
  }

  const mean = weights.reduce((sum, w) => sum + w, 0) / weights.length;
  return weights.map((w) => w / mean);
}

/**
 * How heating demand is distributed across the day.
 *
 * Heating is not driven by the outside temperature alone. People heat rooms
 * they are in, so demand tracks occupancy as well as cold — a burst before
 * everyone leaves, then a longer period through the evening.
 */
function heatingWeight(period: number): number {
  const hour = period / 2;

  if (hour < 5.5) return 0.28;
  if (hour < 9) return 1.5;
  if (hour < 15) return 0.62;
  if (hour < 23) return 1.7;
  return 0.6;
}

/** Half-hourly interval starts across a day. */
function intervalsForDay(day: Date): Date[] {
  const start = startOfUtcDay(day).getTime();
  return Array.from(
    { length: PERIODS_PER_DAY },
    (_, period) => new Date(start + period * 30 * 60_000),
  );
}

/** Walk each day in a range, inclusive of both ends. */
function eachDay(from: Date, to: Date): Date[] {
  const days: Date[] = [];
  let cursor = startOfUtcDay(from);
  const last = startOfUtcDay(to);

  while (cursor.getTime() <= last.getTime()) {
    days.push(cursor);
    cursor = new Date(cursor.getTime() + 86_400_000);
  }

  return days;
}

// ---------------------------------------------------------------------------
// Exporting households
// ---------------------------------------------------------------------------

/**
 * Generate generation, consumption and export for a solar household.
 *
 * Export is surplus — what the array produced minus what the house used at that
 * moment. This is the quantity Solace has to work with, and it is much smaller
 * and much spikier than generation alone, which is exactly why routing it
 * usefully is a scheduling problem rather than a plumbing one.
 */
export function generateExporterReadings(
  household: ExporterDefinition,
  weather: Map<string, DayWeather>,
  from: Date,
  to: Date,
  seed: string,
): GeneratedReading[] {
  const readings: GeneratedReading[] = [];

  for (const day of eachDay(from, to)) {
    const dayWeather = weather.get(isoDate(day));
    if (dayWeather === undefined) continue;

    const rng = createRng(`${seed}:${household.reference}:${isoDate(day)}`);

    // A day-to-day wobble in household activity. People go away, or host.
    const activityScale = clamp(rng.normal(1, 0.16), 0.55, 1.6);

    for (const [period, intervalStart] of intervalsForDay(day).entries()) {
      const generationKwh = halfHourlyGenerationKwh(
        intervalStart,
        household.solarCapacityKw,
        dayWeather.cloudFactor[period],
        PILOT_LOCATION.latitude,
        PILOT_LOCATION.longitude,
      );

      const baseConsumption =
        (household.dailyConsumptionKwh / PERIODS_PER_DAY) *
        ACTIVITY_WEIGHTS[period] *
        activityScale *
        clamp(rng.normal(1, 0.22), 0.35, 2.2);

      const consumptionKwh = Math.max(0.01, baseConsumption);
      const exportKwh = Math.max(0, generationKwh - consumptionKwh);

      readings.push({
        householdReference: household.reference,
        intervalStart,
        channel: MeterChannel.CONSUMPTION,
        kwh: round3(consumptionKwh),
      });

      readings.push({
        householdReference: household.reference,
        intervalStart,
        channel: MeterChannel.EXPORT,
        kwh: round3(exportKwh),
      });
    }
  }

  return readings;
}

// ---------------------------------------------------------------------------
// Recipient households
// ---------------------------------------------------------------------------

/**
 * Generate consumption for a recipient household.
 *
 * Three components combine:
 *
 *   1. A base load that scales with the number of occupants.
 *   2. A heating load proportional to how cold the day was, calibrated so the
 *      household hits its stated cold-weather baseline in genuinely cold
 *      weather.
 *   3. Rationing — the household using less than it needs because it cannot
 *      afford more.
 *
 * The third is the one that matters. Fuel poverty does not usually appear in
 * meter data as a large bill; it appears as a household consuming less than the
 * weather says it should, and as prepayment meters going dark for hours at a
 * time. Both are generated here, and both are detectable from the readings
 * alone.
 */
export function generateRecipientReadings(
  household: RecipientDefinition,
  weather: Map<string, DayWeather>,
  from: Date,
  to: Date,
  seed: string,
): GeneratedReading[] {
  const readings: GeneratedReading[] = [];

  // Base load: a fixed standing draw plus a per-occupant amount.
  const dailyBaseLoadKwh = 2.9 + household.occupants * 2.65;

  // Calibrate heating so that on a genuinely cold day — a daily mean of 4°C,
  // which is 276 heating degree-hours — total consumption reaches the stated
  // cold-weather baseline.
  const coldReferenceDegreeHours = (HEATING_BASE_TEMP_C - 4) * 24;
  const heatingKwhPerDegreeHour = Math.max(
    0,
    (household.coldWeatherBaselineKwh - dailyBaseLoadKwh) /
      coldReferenceDegreeHours,
  );

  for (const day of eachDay(from, to)) {
    const dayWeather = weather.get(isoDate(day));
    if (dayWeather === undefined) continue;

    const rng = createRng(`${seed}:${household.reference}:${isoDate(day)}`);

    const activityScale = clamp(rng.normal(1, 0.14), 0.6, 1.5);

    // How hard money is this particular day. Prepayment households swing more,
    // because their constraint is the balance on the meter rather than a bill
    // that arrives next month.
    const pressure = household.onPrepaymentMeter
      ? clamp(rng.normal(0.5, 0.3), 0, 1)
      : clamp(rng.normal(0.3, 0.22), 0, 1);

    // The fraction of heating the household actually allows itself. A household
    // with no rationing tendency gets all of it.
    const rationingSeverity = household.rationingTendency * pressure;
    const heatingAllowed = clamp(1 - rationingSeverity * 0.8, 0.12, 1);

    // Self-disconnection: a prepayment meter running out. Not a choice, an
    // event — the power simply stops until the household can top up.
    const disconnection = planDisconnection(household, rng, rationingSeverity);

    for (const [period, intervalStart] of intervalsForDay(day).entries()) {
      const temperature = dayWeather.temperatureC[period];
      const degreeHours = Math.max(0, HEATING_BASE_TEMP_C - temperature) * 0.5;

      const baseKwh =
        (dailyBaseLoadKwh / PERIODS_PER_DAY) *
        ACTIVITY_WEIGHTS[period] *
        activityScale *
        clamp(rng.normal(1, 0.2), 0.4, 2.1);

      const heatingKwh =
        degreeHours *
        heatingKwhPerDegreeHour *
        heatingWeight(period) *
        heatingAllowed *
        clamp(rng.normal(1, 0.18), 0.4, 1.8);

      let kwh = baseKwh + heatingKwh;

      // During a disconnection almost nothing runs. Not exactly nothing: a
      // household on the priority services register keeps medical equipment
      // going, and some appliances hold a trickle.
      if (
        disconnection !== null &&
        period >= disconnection.startPeriod &&
        period < disconnection.startPeriod + disconnection.periods
      ) {
        kwh *= household.hasHealthCondition ? 0.12 : 0.03;
      }

      readings.push({
        householdReference: household.reference,
        intervalStart,
        channel: MeterChannel.CONSUMPTION,
        kwh: round3(Math.max(0.005, kwh)),
      });
    }
  }

  return readings;
}

interface Disconnection {
  startPeriod: number;
  periods: number;
}

/**
 * Decide whether the meter runs out today, and for how long.
 *
 * Only prepayment households can self-disconnect, because only they have a
 * balance that can reach zero. Credit-meter households in difficulty accrue
 * arrears instead, which is a different kind of harm and does not show up in
 * half-hourly data.
 */
function planDisconnection(
  household: RecipientDefinition,
  rng: ReturnType<typeof createRng>,
  rationingSeverity: number,
): Disconnection | null {
  if (!household.onPrepaymentMeter) return null;

  // Severity drives frequency. A household rationing hard runs out often.
  const probability = rationingSeverity * 0.34;
  if (!rng.chance(probability)) return null;

  // Meters tend to run out in the evening, when consumption is highest, and
  // stay out until someone can get to a shop to top up.
  const startPeriod = rng.int(34, 44); // 17:00 to 22:00
  const periods = rng.int(2, 9); // one to four and a half hours

  return {
    startPeriod,
    periods: Math.min(periods, PERIODS_PER_DAY - startPeriod),
  };
}

/** Meter data is reported to three decimal places. */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
