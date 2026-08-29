/**
 * Solace — modelling rooftop solar generation.
 *
 * This computes real solar geometry rather than drawing a bell curve over the
 * middle of the day. The difference matters: day length, the height of the sun
 * at noon, and the rate at which output ramps in the morning all vary through
 * the year in ways a generic curve gets wrong, and anyone who has looked at
 * half-hourly export data would notice.
 *
 * The chain of reasoning is the standard one:
 *
 *   date and location -> where the sun is
 *   sun's elevation   -> how much atmosphere the light crosses
 *   air mass          -> clear-sky irradiance at the panel
 *   irradiance, cloud -> AC output of the array
 *
 * Every step is an approximation, and the constants are typical values rather
 * than measurements of any real installation. This is simulated data and the
 * interface says so. What it is not is arbitrary.
 */

/** Convert degrees to radians. */
const rad = (degrees: number): number => (degrees * Math.PI) / 180;

/** Day of the year, 1 to 366, in UTC. */
export function dayOfYear(date: Date): number {
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 0);
  return Math.floor((date.getTime() - startOfYear) / 86_400_000);
}

/**
 * The sun's declination in degrees: how far north or south of the equator it
 * sits on a given day. This is what produces seasons, and with them the
 * difference between a sixteen-hour June day and an eight-hour December one.
 *
 * Cooper's equation. Accurate to well under a degree, which is far finer than
 * anything else in this model.
 */
export function solarDeclination(day: number): number {
  return 23.45 * Math.sin(rad((360 / 365) * (284 + day)));
}

/**
 * The equation of time, in minutes.
 *
 * Solar noon is not clock noon. The Earth's orbit is elliptical and its axis is
 * tilted, so the sun runs up to about sixteen minutes fast or slow depending on
 * the date. Ignoring this would skew every generation curve by up to a quarter
 * of an hour, which is half a settlement period.
 */
export function equationOfTime(day: number): number {
  const b = rad((360 / 364) * (day - 81));
  return 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
}

/**
 * The sun's elevation above the horizon, in degrees.
 *
 * Negative means the sun is below the horizon and the array produces nothing.
 *
 * @param date      Instant to evaluate, in UTC.
 * @param latitude  Degrees north.
 * @param longitude Degrees east. Negative for the UK.
 */
export function solarElevation(
  date: Date,
  latitude: number,
  longitude: number,
): number {
  const day = dayOfYear(date);
  const declination = solarDeclination(day);

  const utcHours =
    date.getUTCHours() +
    date.getUTCMinutes() / 60 +
    date.getUTCSeconds() / 3600;

  // Local solar time: clock time, shifted for how far east or west the site is
  // of the Greenwich meridian, then corrected by the equation of time.
  const solarTime = utcHours + longitude / 15 + equationOfTime(day) / 60;

  // The hour angle is zero at solar noon and moves fifteen degrees per hour.
  const hourAngle = 15 * (solarTime - 12);

  const sinElevation =
    Math.sin(rad(latitude)) * Math.sin(rad(declination)) +
    Math.cos(rad(latitude)) *
      Math.cos(rad(declination)) *
      Math.cos(rad(hourAngle));

  return (Math.asin(Math.max(-1, Math.min(1, sinElevation))) * 180) / Math.PI;
}

/**
 * Clear-sky irradiance on a horizontal surface, in watts per square metre.
 *
 * Light arriving at a low sun angle crosses more atmosphere and loses more
 * energy on the way. `airMass` captures that, and the 0.7^(airMass^0.678) term
 * is the Meinel model for atmospheric transmittance.
 *
 * Returns zero when the sun is below the horizon.
 */
export function clearSkyIrradiance(elevationDegrees: number): number {
  if (elevationDegrees <= 0) return 0;

  const sinElevation = Math.sin(rad(elevationDegrees));

  // Air mass: 1.0 with the sun directly overhead, rising steeply near sunrise.
  const airMass = 1 / sinElevation;

  // Above about 38 air masses the model stops meaning anything, and the output
  // is negligible regardless.
  if (airMass > 38) return 0;

  const directNormal = 1361 * 0.7 ** airMass ** 0.678;

  // Direct beam projected onto a horizontal surface, plus a diffuse component.
  // Diffuse light is why a panel still produces on an overcast day.
  const direct = directNormal * sinElevation;
  const diffuse = 0.1 * direct;

  return direct + diffuse;
}

/**
 * AC output of a rooftop array, in kilowatts.
 *
 * @param capacityKw       Installed peak capacity.
 * @param irradiance       Plane-of-array irradiance, W/m².
 * @param cloudFactor      0 for total overcast, 1 for clear sky.
 * @param performanceRatio Everything the datasheet does not promise: inverter
 *                         losses, wiring, dust, panel temperature, ageing. A
 *                         well-installed domestic array runs around 0.8.
 */
export function arrayOutputKw(
  capacityKw: number,
  irradiance: number,
  cloudFactor: number,
  performanceRatio = 0.8,
): number {
  // Panels are rated at 1000 W/m², so irradiance divided by 1000 is the
  // fraction of nameplate capacity available.
  const output = capacityKw * (irradiance / 1000) * cloudFactor * performanceRatio;
  return Math.max(0, output);
}

/**
 * Energy generated across one half-hourly settlement period, in kWh.
 *
 * Evaluated at the midpoint of the period rather than its start. Over half an
 * hour near sunrise the difference is material, and taking the start would bias
 * every day's total downwards.
 */
export function halfHourlyGenerationKwh(
  intervalStart: Date,
  capacityKw: number,
  cloudFactor: number,
  latitude: number,
  longitude: number,
  performanceRatio = 0.8,
): number {
  const midpoint = new Date(intervalStart.getTime() + 15 * 60_000);
  const elevation = solarElevation(midpoint, latitude, longitude);
  const irradiance = clearSkyIrradiance(elevation);
  const powerKw = arrayOutputKw(
    capacityKw,
    irradiance,
    cloudFactor,
    performanceRatio,
  );

  // Power held for half an hour.
  return powerKw * 0.5;
}
