/**
 * Solace — synthetic weather.
 *
 * Two quantities drive everything downstream: how cloudy it is, which sets what
 * the solar arrays export, and how cold it is, which sets what the recipient
 * households need.
 *
 * The important property here is autocorrelation. Real weather persists —
 * cloudy half-hours cluster into cloudy afternoons, and cold days arrive in
 * runs. Drawing each half-hour independently would produce a dataset that
 * looked plausible in aggregate and obviously wrong in a chart, with generation
 * flickering between full sun and overcast every thirty minutes. So a whole
 * day is generated at once, as a correlated series.
 *
 * These are typical values for northern England, not measurements. The data is
 * simulated and labelled as such throughout.
 */

import { clamp, createRng } from "./rng.ts";

/** Half-hourly settlement periods in a day. */
export const PERIODS_PER_DAY = 48;

/**
 * The base temperature for heating demand, in Celsius.
 *
 * The long-standing UK convention: below roughly 15.5°C, buildings need heating
 * to stay comfortable. Degree-days are counted from here.
 */
export const HEATING_BASE_TEMP_C = 15.5;

export interface DayWeather {
  /** The date, at midnight UTC. */
  date: Date;
  /** Mean temperature for the day, in Celsius. */
  meanTemperatureC: number;
  /** Temperature at the start of each half-hourly period. */
  temperatureC: number[];
  /** Fraction of clear-sky irradiance reaching the ground, 0.15 to 1. */
  cloudFactor: number[];
  /** Heating degree-hours accumulated across the day. */
  heatingDegreeHours: number;
}

/**
 * The seasonal temperature curve for northern England.
 *
 * A sinusoid peaking in late July and bottoming in late January. Roughly 4°C in
 * midwinter and 17°C in midsummer.
 */
function seasonalMeanTemperature(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const day = Math.floor((date.getTime() - start) / 86_400_000);

  const annualMean = 10.5;
  const amplitude = 6.5;
  // Day 205 is around 24 July, the warmest part of the year.
  const phase = ((day - 205) / 365) * 2 * Math.PI;

  return annualMean + amplitude * Math.cos(phase);
}

/**
 * The seasonal cloud baseline.
 *
 * British winters are not only colder but greyer, which compounds the problem
 * Solace addresses: solar surplus is scarcest exactly when household need
 * peaks. Summer averages a little over half of clear-sky irradiance; December
 * rather less.
 */
function seasonalCloudBase(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const day = Math.floor((date.getTime() - start) / 86_400_000);

  const meanClearness = 0.55;
  const amplitude = 0.12;
  const phase = ((day - 180) / 365) * 2 * Math.PI;

  return meanClearness + amplitude * Math.cos(phase);
}

/** Midnight UTC on the day containing the given instant. */
export function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/** ISO date, e.g. "2026-08-14". Used to seed a day deterministically. */
export function isoDate(date: Date): string {
  return startOfUtcDay(date).toISOString().slice(0, 10);
}

/**
 * Generate a full day of weather.
 *
 * Seeded by the date, so any day can be regenerated on its own and will come
 * out identical — the caller does not have to walk the whole month in order to
 * reproduce one afternoon.
 */
export function generateDayWeather(date: Date, seed: string): DayWeather {
  const day = startOfUtcDay(date);
  const rng = createRng(`${seed}:weather:${isoDate(day)}`);

  // Daily mean wanders around the seasonal curve. Some days are simply warmer
  // than the time of year suggests.
  const meanTemperatureC =
    seasonalMeanTemperature(day) + rng.normal(0, 2.6);

  // The day's overall character: bright, dull, or somewhere between.
  const cloudBase = clamp(seasonalCloudBase(day) + rng.normal(0, 0.18), 0.2, 0.95);

  // How far the temperature swings between night and afternoon. Clear days
  // swing further, because cloud traps heat overnight and blocks it by day.
  const diurnalRange = clamp(3 + cloudBase * 6 + rng.normal(0, 1.2), 1.5, 12);

  const temperatureC: number[] = [];
  const cloudFactor: number[] = [];

  // The cloud series is a random walk that is pulled back towards the day's
  // baseline. This is what makes cloudy spells last rather than flicker.
  let cloud = cloudBase;
  const reversion = 0.25;
  const volatility = 0.09;

  let heatingDegreeHours = 0;

  for (let period = 0; period < PERIODS_PER_DAY; period++) {
    const hour = period / 2;

    // Coldest around 05:00, warmest around 15:00.
    const phase = ((hour - 15) / 24) * 2 * Math.PI;
    const temperature =
      meanTemperatureC + (diurnalRange / 2) * Math.cos(phase) + rng.normal(0, 0.3);
    temperatureC.push(temperature);

    heatingDegreeHours += Math.max(0, HEATING_BASE_TEMP_C - temperature) * 0.5;

    cloud =
      cloud + reversion * (cloudBase - cloud) + rng.normal(0, volatility);
    cloud = clamp(cloud, 0.15, 1);
    cloudFactor.push(cloud);
  }

  return {
    date: day,
    meanTemperatureC,
    temperatureC,
    cloudFactor,
    heatingDegreeHours,
  };
}

/**
 * Generate weather for a range of days, inclusive of both ends.
 *
 * Keyed by ISO date so callers can look a day up directly.
 */
export function generateWeatherSeries(
  from: Date,
  to: Date,
  seed: string,
): Map<string, DayWeather> {
  const series = new Map<string, DayWeather>();

  let cursor = startOfUtcDay(from);
  const last = startOfUtcDay(to);

  while (cursor.getTime() <= last.getTime()) {
    series.set(isoDate(cursor), generateDayWeather(cursor, seed));
    cursor = new Date(cursor.getTime() + 86_400_000);
  }

  return series;
}
