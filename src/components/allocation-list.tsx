import { formatKwh, formatPence, shortenHash } from "@/lib/format";
import { SettlementStatus } from "@/lib/domain";
import type { AllocationRow } from "@/lib/dashboard/queries";

/**
 * The ledger, most recent first.
 *
 * Each row states what moved, between whom, and whether it reached the chain.
 * The reasoning panel and the live feed arrive in Phase 7; this is the standing
 * record they will animate on top of.
 */
export function AllocationList({ allocations }: { allocations: AllocationRow[] }) {
  if (allocations.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-edge bg-surface px-6 py-12 text-center text-sm text-ink-muted">
        No allocations yet. Run{" "}
        <code className="rounded bg-sunken px-1.5 py-0.5 text-xs">
          npm run allocate
        </code>{" "}
        to decide, then{" "}
        <code className="rounded bg-sunken px-1.5 py-0.5 text-xs">
          npm run settle
        </code>{" "}
        to settle.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-hairline overflow-hidden rounded-lg border border-hairline bg-surface">
      {allocations.map((allocation) => (
        <li key={allocation.id} className="px-5 py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
            <div className="min-w-0">
              <p className="text-sm text-ink">
                <span className="font-medium">
                  {allocation.recipient.locality}
                </span>
                <span className="mx-1.5 text-ink-muted" aria-hidden="true">
                  ←
                </span>
                <span className="text-ink-secondary">
                  {allocation.exporter.locality}
                </span>
              </p>
              <p className="mt-0.5 text-xs text-ink-muted">
                {longDate(allocation.date)}
                <span className="mx-1.5" aria-hidden="true">
                  ·
                </span>
                <span className="tabular">{allocation.recipient.reference}</span>
              </p>
            </div>

            <div className="flex items-baseline gap-5">
              <span className="figure tabular text-base font-semibold text-warmth">
                {formatKwh(allocation.kwh)}
              </span>
              <span className="figure tabular text-base font-semibold text-ink">
                {formatPence(allocation.amountPence)}
              </span>
              <SettlementBadge settlement={allocation.settlement} />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Whether this allocation actually reached a chain, and where to check.
 *
 * A local-chain settlement is real but not public, and says so rather than
 * borrowing the credibility of a public one. Only a settlement with a working
 * explorer link offers one.
 */
function SettlementBadge({
  settlement,
}: {
  settlement: AllocationRow["settlement"];
}) {
  if (settlement === null) {
    return (
      <span className="rounded-full border border-hairline bg-sunken px-2 py-0.5 text-xs text-ink-muted">
        Not settled
      </span>
    );
  }

  if (settlement.status === SettlementStatus.FAILED) {
    return (
      <span
        className="rounded-full border border-critical/30 bg-critical/10 px-2 py-0.5 text-xs text-critical"
        title={settlement.failureReason ?? undefined}
      >
        Failed
      </span>
    );
  }

  if (settlement.status !== SettlementStatus.CONFIRMED) {
    return (
      <span className="rounded-full border border-caution/30 bg-caution/10 px-2 py-0.5 text-xs text-caution">
        Pending
      </span>
    );
  }

  const label = shortenHash(settlement.txHash ?? "", 6);

  if (settlement.explorerUrl === null) {
    return (
      <span
        className="rounded-full border border-good/30 bg-good/10 px-2 py-0.5 text-xs text-good tabular"
        title="Confirmed on a local chain, which has no public explorer"
      >
        {label}
      </span>
    );
  }

  return (
    <a
      href={settlement.explorerUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="rounded-full border border-good/30 bg-good/10 px-2 py-0.5 text-xs text-good tabular underline-offset-2 hover:underline"
    >
      {label} ↗
    </a>
  );
}

function longDate(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
