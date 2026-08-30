import { formatKwh, formatPence } from "@/lib/format";
import type { HouseholdRow } from "@/lib/dashboard/queries";

/**
 * Every recipient household, including the ones that received nothing.
 *
 * Households are ordered by the share of their electricity that Solace covered,
 * not by raw kilowatt-hours. A five-person terrace absorbs far more energy than
 * a single pensioner in a flat, so absolute figures flatter large households and
 * understate what a delivery meant to a small one. The share is the honest
 * measure of whether support reached the people who needed it.
 *
 * Laid out as a list rather than a table. Four columns of figures do not fit
 * the width this panel gets, and a table that scrolls sideways is a table
 * nobody reads.
 */
export function HouseholdPanel({ households }: { households: HouseholdRow[] }) {
  const ordered = [...households].sort(
    (a, b) =>
      (b.shareOfConsumption ?? 0) - (a.shareOfConsumption ?? 0) ||
      (b.needScore ?? 0) - (a.needScore ?? 0),
  );

  const widest = Math.max(
    0.01,
    ...ordered.map((household) => household.shareOfConsumption ?? 0),
  );

  return (
    <ul className="divide-y divide-hairline overflow-hidden rounded-lg border border-hairline bg-surface">
      {ordered.map((household) => {
        const share = household.shareOfConsumption ?? 0;
        const served = household.timesServed > 0;

        return (
          <li
            key={household.reference}
            className={`px-5 py-3.5 ${served ? "" : "bg-sunken/50"}`}
          >
            <div className="flex items-baseline justify-between gap-4">
              <p className="font-medium text-body">{household.locality}</p>

              {served ? (
                <p className="shrink-0 text-right">
                  <span className="tabular text-sm font-semibold text-warmth">
                    {formatKwh(household.kwhReceived, 0)}
                  </span>
                  <span className="tabular ml-2 text-xs text-body-muted">
                    {formatPence(household.pencePaid)}
                  </span>
                </p>
              ) : (
                <p className="shrink-0 text-xs text-body-muted">Not served</p>
              )}
            </div>

            <p className="mt-0.5 text-xs text-body-muted">
              <span className="tabular">{household.reference}</span>
              {household.epcBand !== null && <> · EPC {household.epcBand}</>}
              {household.onPrepaymentMeter && <> · prepayment</>}
              {household.hasHealthCondition && <> · health condition</>}
              {household.onMeansTestedBenefit && <> · on benefits</>}
            </p>

            <div className="mt-2 flex items-center gap-3">
              <span className="w-16 shrink-0 text-xs text-body-muted">
                Need{" "}
                <span className="tabular text-body-secondary">
                  {household.needScore === null
                    ? "—"
                    : household.needScore.toFixed(2)}
                </span>
              </span>

              <div
                className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken"
                aria-hidden="true"
              >
                <div
                  className="h-full rounded-full bg-warmth"
                  style={{ width: `${(share / widest) * 100}%` }}
                />
              </div>

              <span className="tabular w-9 shrink-0 text-right text-xs text-body">
                {share > 0 ? `${Math.round(share * 100)}%` : "—"}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
