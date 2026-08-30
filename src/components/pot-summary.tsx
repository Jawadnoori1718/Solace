import { formatKwh, formatPence } from "@/lib/format";
import type { HouseholdRow, PotOverview } from "@/lib/dashboard/queries";

/**
 * The headline.
 *
 * One number dominates — what is left — because that is the question being
 * asked. It is set at a size meant to be read from the back of a committee
 * room, in the display serif, because a figure about public money should look
 * like a figure in a public record.
 *
 * The bar beneath it is not a progress indicator. It is the spend itself,
 * divided into one segment per household that received energy, in proportion to
 * what each received. The eye reads "a quarter of the pot is gone" and then,
 * without being told, "and it went to five places". A plain progress bar would
 * carry the first fact and lose the second.
 *
 * Segments share a single amber and are separated by two-pixel gaps of the
 * background. Five categorical colours would have been decoration; the gaps do
 * the same work and mean nothing has to be invented.
 */
export function PotSummary({
  pot,
  households,
}: {
  pot: PotOverview;
  households: HouseholdRow[];
}) {
  const spentPercent = Math.round(pot.spentFraction * 100);

  const served = households
    .filter((household) => household.pencePaid > 0)
    .sort((a, b) => b.pencePaid - a.pencePaid);

  return (
    <section className="mx-auto max-w-6xl px-6 pt-8 pb-10">
      <p className="overline-on-ink">
        {pot.name}
        <span className="mx-2 opacity-40" aria-hidden="true">
          ·
        </span>
        <span className="tabular">{pot.reference}</span>
      </p>

      {/*
        An explicit two-column grid rather than a wrapping flex row. The
        headline figure is wide enough that flex-wrap sends the statistics onto
        their own line and leaves half the band empty, which reads as an
        unfinished layout rather than a deliberate one.
      */}
      <div className="mt-5 grid items-end gap-x-14 gap-y-9 lg:grid-cols-[minmax(0,auto)_1fr]">
        <div>
          <p className="text-sm font-medium text-on-ink-secondary">
            Remaining in the pot
          </p>

          <p className="figure mt-1.5 text-[4.25rem] leading-[0.92] font-semibold text-on-ink sm:text-[5.25rem]">
            {formatPence(pot.balancePence)}
          </p>

          <p className="mt-4 text-sm text-on-ink-secondary">
            of{" "}
            <span className="tabular font-medium text-on-ink">
              {formatPence(pot.depositedPence)}
            </span>{" "}
            deposited
            <span className="mx-2 opacity-40" aria-hidden="true">
              ·
            </span>
            <span className="tabular font-medium text-warmth-bright">
              {formatPence(pot.spentPence)}
            </span>{" "}
            committed
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-x-8 gap-y-7 sm:grid-cols-4 lg:pb-2">
          <Stat
            label="Energy delivered"
            value={formatKwh(pot.totalKwh, 0)}
            tone="warmth"
          />
          <Stat
            label="Households reached"
            value={`${pot.householdsServed}`}
            note={`of ${pot.householdsAssessed} assessed`}
          />
          <Stat
            label="Settled on chain"
            value={pot.settlementsConfirmed.toLocaleString("en-GB")}
            note={
              pot.settlementsFailed > 0
                ? `${pot.settlementsFailed} failed`
                : "transactions"
            }
          />
          <Stat
            label="Worth on the grid"
            value={formatPence(pot.gridValuePence)}
            note="had it been exported"
          />
        </dl>
      </div>

      {/* The spend, divided by household. */}
      <div className="mt-10">
        <div
          className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-on-ink/10"
          role="img"
          aria-label={`${spentPercent}% of the pot committed across ${served.length} households, ${formatPence(pot.balancePence)} remaining`}
        >
          {served.map((household) => (
            <div
              key={household.reference}
              className="h-full rounded-full bg-warmth-bright first:rounded-l-full"
              style={{
                width: `${(household.pencePaid / Math.max(1, pot.depositedPence)) * 100}%`,
              }}
              title={`${household.locality}: ${formatPence(household.pencePaid)}`}
            />
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-on-ink-muted">
            {served.map((household) => (
              <span key={household.reference}>
                <span className="text-on-ink-secondary">
                  {household.locality}
                </span>{" "}
                <span className="tabular">
                  {formatPence(household.pencePaid)}
                </span>
              </span>
            ))}
          </p>

          <p className="tabular shrink-0 text-xs text-on-ink-muted">
            {spentPercent}% committed
          </p>
        </div>
      </div>

      {/*
        The independent check. Everything above is this application's own
        account of itself; this is the link that lets somebody go and look at
        the record without taking our word for any of it.
      */}
      {pot.latestSettlement !== null && (
        <div className="mt-8">
          {pot.latestSettlement.explorerUrl === null ? (
            <p className="text-xs text-on-ink-muted">
              Settled on a local chain, which has no public explorer. Live mode
              settles on Base Sepolia, where every transaction is publicly
              verifiable.
            </p>
          ) : (
            <a
              href={pot.latestSettlement.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-2 rounded-full border border-warmth-bright/40 bg-warmth-bright/10 px-4 py-2 text-sm font-medium text-warmth-bright transition-colors hover:bg-warmth-bright/20"
            >
              Verify the most recent settlement on the public block explorer
              <span
                className="transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              >
                →
              </span>
            </a>
          )}
        </div>
      )}
    </section>
  );
}

function Stat({
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
      <dt className="overline-on-ink">{label}</dt>
      <dd
        className={`figure mt-1.5 text-[1.75rem] leading-none font-semibold ${
          tone === "warmth" ? "text-warmth-bright" : "text-on-ink"
        }`}
      >
        {value}
      </dd>
      {note !== undefined && (
        <p className="mt-1.5 text-xs text-on-ink-muted">{note}</p>
      )}
    </div>
  );
}
