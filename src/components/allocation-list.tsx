import { formatKwh, formatPence, shortenHash } from "@/lib/format";
import { SettlementStatus } from "@/lib/domain";
import { ExpandableRow, ReasoningPanel } from "./reasoning-panel";
import type { AllocationRow } from "@/lib/dashboard/queries";

/**
 * The ledger, most recent first.
 *
 * Every row opens to reveal the engine's full reasoning: each factor, its
 * weight, and what it contributed. This is the part that answers a councillor
 * being asked in committee why a particular household was chosen.
 */
export function AllocationList({ allocations }: { allocations: AllocationRow[] }) {
  if (allocations.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-edge bg-surface px-6 py-12 text-center text-sm text-body-muted">
        No allocations yet. Run{" "}
        <code className="rounded bg-sunken px-1.5 py-0.5 text-xs">
          npm run allocate
        </code>{" "}
        to decide, then settle them.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-hairline overflow-hidden rounded-lg border border-hairline bg-surface">
      {allocations.map((allocation, index) => (
        <li key={allocation.id}>
          <ExpandableRow
            // The first row opens by default. Reasoning that has to be
            // discovered is reasoning most people never see, and this is the
            // part of the interface that answers "why them".
            defaultOpen={index === 0}
            summary={
              <span className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1">
                <span className="min-w-0">
                  <span className="block text-sm text-body">
                    <span className="font-medium">
                      {allocation.recipient.locality}
                    </span>
                    <span className="mx-1.5 text-body-muted" aria-hidden="true">
                      ←
                    </span>
                    <span className="text-body-secondary">
                      {allocation.exporter.locality}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-xs text-body-muted">
                    {longDate(allocation.date)}
                    <span className="mx-1.5" aria-hidden="true">
                      ·
                    </span>
                    <span className="tabular">
                      {allocation.recipient.reference}
                    </span>
                    {allocation.reasoning !== null && (
                      <>
                        <span className="mx-1.5" aria-hidden="true">
                          ·
                        </span>
                        need{" "}
                        <span className="tabular">
                          {allocation.reasoning.needScore.toFixed(2)}
                        </span>
                      </>
                    )}
                  </span>
                </span>

                <span className="flex items-baseline gap-5">
                  <span className="figure tabular text-base font-semibold text-warmth">
                    {formatKwh(allocation.kwh)}
                  </span>
                  <span className="figure tabular text-base font-semibold text-body">
                    {formatPence(allocation.amountPence)}
                  </span>
                  <SettlementBadge settlement={allocation.settlement} />
                </span>
              </span>
            }
          >
            {allocation.reasoning === null ? (
              <p className="border-t border-hairline bg-sunken/40 px-5 py-4 text-sm text-body-muted">
                No reasoning was stored for this allocation.
              </p>
            ) : (
              <ReasoningPanel
                reasoning={allocation.reasoning}
                kwh={allocation.kwh}
                amountPence={allocation.amountPence}
                settlement={allocation.settlement}
              />
            )}
          </ExpandableRow>
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
 * explorer offers a link.
 *
 * Rendered as a span rather than an anchor inside the expandable row's button,
 * except where there is a real link — nesting interactive elements breaks
 * keyboard navigation, so the link stops the click from also toggling the row.
 */
function SettlementBadge({
  settlement,
}: {
  settlement: AllocationRow["settlement"];
}) {
  if (settlement === null) {
    return (
      <span className="rounded-full border border-hairline bg-sunken px-2 py-0.5 text-xs text-body-muted">
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

  return (
    <span
      className="tabular rounded-full border border-good/30 bg-good/10 px-2 py-0.5 text-xs text-good"
      title={
        settlement.explorerUrl === null
          ? "Confirmed on a local chain, which has no public explorer"
          : "Confirmed on a public testnet"
      }
    >
      {label}
    </span>
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
