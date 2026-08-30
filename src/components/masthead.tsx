import { CHAINS, MODE, isLiveMode } from "@/lib/config";
import { ChainName } from "@/lib/domain";
import { SolaceLogo } from "./brand";

/**
 * The top of the ink band.
 *
 * Names the identity, the council and the funding stream, because those three
 * together are what make this a public record rather than a product screen.
 *
 * The operating mode sits here too, stated plainly and never hidden. A viewer
 * should be able to tell at a glance whether they are looking at a public chain
 * or a local one — a system arguing for transparency cannot be coy about its
 * own status.
 */
export function Masthead({
  councilName,
  fundingSource,
}: {
  councilName: string;
  fundingSource: string;
}) {
  const chain = CHAINS[isLiveMode ? ChainName.BASE_SEPOLIA : ChainName.HARDHAT_LOCAL];

  return (
    <header>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 pt-7 pb-6">
        <SolaceLogo size={38} tone="ink" showTagline />

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="text-right">
            <p className="text-sm font-medium text-on-ink">{councilName}</p>
            <p className="text-xs text-on-ink-muted">{fundingSource}</p>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.6875rem] font-medium tracking-wide ${
                isLiveMode
                  ? "border-good-bright/40 bg-good-bright/10 text-good-bright"
                  : "border-on-ink-muted/30 bg-on-ink/5 text-on-ink-secondary"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  isLiveMode ? "bg-good-bright" : "bg-on-ink-muted"
                }`}
                style={
                  isLiveMode
                    ? { animation: "soft-pulse 2.4s ease-in-out infinite" }
                    : undefined
                }
                aria-hidden="true"
              />
              {MODE}
            </span>

            <span className="rounded-full border border-on-ink-muted/25 px-2.5 py-1 text-[0.6875rem] text-on-ink-muted">
              {chain.label}
            </span>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6">
        <div className="rule-fade h-px" />
      </div>
    </header>
  );
}
