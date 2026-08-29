import { formatKwh, formatPence } from "@/lib/format";
import type { PotOverview } from "@/lib/dashboard/queries";

/**
 * The pot, as a councillor would want it stated.
 *
 * One number dominates — what is left — because that is the question being
 * asked. Everything else supports it: what went in, what has gone out, and what
 * the money actually bought.
 *
 * The bar is a plain proportion rather than a chart. It answers "how much is
 * gone" at a glance from across a room, and a chart would answer it more slowly.
 */
export function PotSummary({ pot }: { pot: PotOverview }) {
  const spentPercent = Math.round(pot.spentFraction * 100);

  return (
    <section className="rounded-lg border border-hairline bg-surface p-6 shadow-[0_1px_2px_rgba(16,35,58,0.04)]">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <p className="overline">Remaining in the pot</p>
          <p className="figure mt-1 text-5xl font-semibold text-ink">
            {formatPence(pot.balancePence)}
          </p>
          <p className="mt-1.5 text-sm text-ink-secondary">
            of{" "}
            <span className="tabular font-medium text-ink">
              {formatPence(pot.depositedPence)}
            </span>{" "}
            deposited
          </p>
        </div>

        <div className="text-right">
          <p className="overline">Committed</p>
          <p className="figure mt-1 text-3xl font-semibold text-money">
            {formatPence(pot.spentPence)}
          </p>
          <p className="mt-1.5 text-sm text-ink-secondary tabular">
            {spentPercent}% of the pot
          </p>
        </div>
      </div>

      {/* The proportion spent. Labelled for screen readers, since the bar
          itself carries the meaning visually. */}
      <div
        className="mt-6 h-2.5 w-full overflow-hidden rounded-full bg-sunken"
        role="img"
        aria-label={`${spentPercent}% of the pot committed, ${formatPence(pot.balancePence)} remaining`}
      >
        <div
          className="h-full rounded-full bg-money transition-[width] duration-700 ease-out"
          style={{ width: `${Math.min(100, Math.max(0, pot.spentFraction * 100))}%` }}
        />
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-hairline pt-5 sm:grid-cols-4">
        <Figure
          label="Energy delivered"
          value={formatKwh(pot.totalKwh, 0)}
          tone="warmth"
        />
        <Figure
          label="Households reached"
          value={`${pot.householdsServed} of ${pot.householdsAssessed}`}
        />
        <Figure
          label="Settled on chain"
          value={pot.settlementsConfirmed.toLocaleString("en-GB")}
          note={
            pot.settlementsFailed > 0
              ? `${pot.settlementsFailed} failed`
              : undefined
          }
        />
        <Figure
          label="Worth on the grid"
          value={formatPence(pot.gridValuePence)}
          note="had it been exported instead"
        />
      </dl>
    </section>
  );
}

function Figure({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "warmth";
}) {
  return (
    <div>
      <dt className="overline">{label}</dt>
      <dd
        className={`figure mt-1 text-2xl font-semibold ${
          tone === "warmth" ? "text-warmth" : "text-ink"
        }`}
      >
        {value}
      </dd>
      {note !== undefined && (
        <p className="mt-0.5 text-xs text-ink-muted">{note}</p>
      )}
    </div>
  );
}
