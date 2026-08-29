import { CHAINS, MODE, isLiveMode } from "@/lib/config";
import type { ChainName } from "@/lib/domain";

/**
 * The page header.
 *
 * Names the council, the pot and the funding stream, because those three
 * together are what makes this a public record rather than a product screen.
 * The operating mode sits here too — stated plainly, never hidden. A viewer
 * should be able to tell at a glance whether they are looking at a public chain
 * or a local one.
 */
export function Masthead({
  councilName,
  potName,
  fundingSource,
  potReference,
}: {
  councilName: string;
  potName: string;
  fundingSource: string;
  potReference: string;
}) {
  const chain = CHAINS[(isLiveMode ? "BASE_SEPOLIA" : "HARDHAT_LOCAL") as ChainName];

  return (
    <header className="border-b border-hairline bg-surface">
      <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-4 px-6 py-5">
        <div>
          <div className="flex items-baseline gap-3">
            <span className="font-display text-xl font-semibold tracking-tight text-ink">
              Solace
            </span>
            <span className="h-4 w-px bg-edge" aria-hidden="true" />
            <span className="text-sm text-ink-secondary">{councilName}</span>
          </div>

          <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight text-ink">
            {potName}
          </h1>

          <p className="mt-0.5 text-sm text-ink-secondary">
            {fundingSource}
            <span className="mx-2 text-edge" aria-hidden="true">
              ·
            </span>
            <span className="tabular">{potReference}</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
              isLiveMode
                ? "border-good/30 bg-good/10 text-good"
                : "border-edge bg-sunken text-ink-secondary"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                isLiveMode ? "bg-good" : "bg-ink-muted"
              }`}
              aria-hidden="true"
            />
            {MODE} mode
          </span>

          <span className="rounded-full border border-hairline bg-sunken px-2.5 py-1 text-xs text-ink-secondary">
            {chain.label}
          </span>
        </div>
      </div>
    </header>
  );
}
