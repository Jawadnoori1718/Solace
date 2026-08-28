/**
 * Solace — formatting money and energy for people to read.
 *
 * Money moves through this system as integer pence and only becomes a decimal
 * at the moment it is displayed. Keeping that conversion in one place means
 * there is exactly one line of code capable of introducing a rounding error in
 * a figure a councillor might quote.
 */

const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const GBP_WHOLE = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** Format integer pence as pounds, e.g. 250000 becomes "£2,500.00". */
export function formatPence(pence: number): string {
  return GBP.format(pence / 100);
}

/**
 * Format integer pence as whole pounds, e.g. 250000 becomes "£2,500".
 *
 * For headline figures where the pennies are noise rather than information.
 */
export function formatPenceWhole(pence: number): string {
  return GBP_WHOLE.format(Math.round(pence / 100));
}

/** Format a kilowatt-hour figure, e.g. 14.706 becomes "14.7 kWh". */
export function formatKwh(kwh: number, decimalPlaces = 1): string {
  return `${kwh.toLocaleString("en-GB", {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces,
  })} kWh`;
}

/**
 * Convert kilowatt-hours to the integer milli-kWh written on chain.
 *
 * Rounds rather than truncates, so repeated conversions do not drift downwards.
 */
export function kwhToMilliKwh(kwh: number): number {
  return Math.round(kwh * 1000);
}

/** Convert integer milli-kWh back to kilowatt-hours. */
export function milliKwhToKwh(milliKwh: number): number {
  return milliKwh / 1000;
}

/**
 * Shorten a transaction hash or address for display, e.g. "0x7a3f…c21b".
 *
 * The full value always remains available behind the link; this is only to stop
 * a sixty-six character string wrecking a table layout.
 */
export function shortenHash(value: string, edge = 6): string {
  if (value.length <= edge * 2 + 2) return value;
  return `${value.slice(0, edge)}…${value.slice(-4)}`;
}
