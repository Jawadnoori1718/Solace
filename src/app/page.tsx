import { AllocationList } from "@/components/allocation-list";
import { BalanceChart } from "@/components/balance-chart";
import { HouseholdPanel } from "@/components/household-panel";
import { Masthead } from "@/components/masthead";
import { PotSummary } from "@/components/pot-summary";
import { configurationWarnings } from "@/lib/config";
import {
  getBalanceSeries,
  getHouseholds,
  getPotOverview,
  getRecentAllocations,
  type BalancePoint,
  type PotOverview,
} from "@/lib/dashboard/queries";

/**
 * The councillor's dashboard.
 *
 * Read from the database on the server on every request. Nothing is cached,
 * because a balance that is thirty seconds stale is a balance that is wrong,
 * and this page exists to be trusted.
 */
export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const pot = await getPotOverview();

  if (pot === null) {
    return <NotSeeded />;
  }

  const [allocations, households, series] = await Promise.all([
    getRecentAllocations(12),
    getHouseholds(),
    getBalanceSeries(),
  ]);

  const warnings = configurationWarnings();

  return (
    <>
      <Masthead
        councilName={pot.councilName}
        potName={pot.name}
        fundingSource={pot.fundingSource}
        potReference={pot.reference}
      />

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <PotSummarySection pot={pot} series={series} />

        <div className="mt-8 grid gap-8 lg:grid-cols-5">
          <section className="lg:col-span-3">
            <SectionHeading
              title="Recent allocations"
              note="Newest first. Every settled row is a transaction on a public ledger."
            />
            <AllocationList allocations={allocations} />
          </section>

          <section className="lg:col-span-2">
            <SectionHeading
              title="Households"
              note="Ordered by the share of each household's electricity that Solace covered."
            />
            <HouseholdPanel households={households} />
          </section>
        </div>

        {warnings.length > 0 && (
          <section className="mt-8 rounded-lg border border-caution/30 bg-caution/5 p-4">
            <h2 className="text-sm font-semibold text-caution">
              Not yet configured
            </h2>
            <ul className="mt-2 space-y-1 text-sm text-ink-secondary">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </section>
        )}
      </main>

      <Provenance pot={pot} />
    </>
  );
}

function PotSummarySection({
  pot,
  series,
}: {
  pot: PotOverview;
  series: BalancePoint[];
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="lg:col-span-3">
        <PotSummary pot={pot} />
      </div>

      <div className="rounded-lg border border-hairline bg-surface p-5 lg:col-span-2">
        <h2 className="font-display text-base font-semibold text-ink">
          The pot over {series.length} days
        </h2>
        <p className="mt-0.5 text-xs text-ink-muted">
          What remained at the end of each day.
        </p>
        <div className="mt-3">
          <BalanceChart series={series} />
        </div>
      </div>
    </div>
  );
}

function SectionHeading({ title, note }: { title: string; note: string }) {
  return (
    <div className="mb-3">
      <h2 className="font-display text-lg font-semibold text-ink">{title}</h2>
      <p className="mt-0.5 text-xs text-ink-muted">{note}</p>
    </div>
  );
}

/**
 * What is real and what is not, stated at the foot of every page.
 *
 * Solace's entire argument is that a system handling public money should be
 * able to say what it knows and what it does not. That has to be visible on the
 * page, not buried in a repository.
 */
function Provenance({
  pot,
}: {
  pot: NonNullable<Awaited<ReturnType<typeof getPotOverview>>>;
}) {
  return (
    <footer className="border-t border-hairline bg-surface">
      <div className="mx-auto grid max-w-6xl gap-6 px-6 py-6 text-xs leading-relaxed text-ink-secondary sm:grid-cols-3">
        <div>
          <p className="overline mb-1.5">Meter data</p>
          <p>
            Simulated. Integration path: DCC and supplier APIs. No real household
            is described anywhere in this system.
          </p>
        </div>

        <div>
          <p className="overline mb-1.5">Privacy</p>
          <p>
            No personal data reaches the chain. Recipients appear only as a keyed
            HMAC of an internal reference; the mapping back to a household exists
            only in the council&rsquo;s own database.
          </p>
        </div>

        <div>
          <p className="overline mb-1.5">Settlement</p>
          <p>
            <span className="font-medium text-ink">SolacePound</span> is a testnet
            demonstration token standing in for a regulated GBP stablecoin. It
            holds no value.
          </p>
          {pot.contract.address !== null && (
            <p className="mt-1.5 tabular break-all text-ink-muted">
              {pot.contract.explorerUrl === null ? (
                pot.contract.address
              ) : (
                <a
                  href={pot.contract.explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-ink"
                >
                  {pot.contract.address} ↗
                </a>
              )}
            </p>
          )}
        </div>
      </div>
    </footer>
  );
}

/** Shown before the seed has run, rather than an empty page or a crash. */
function NotSeeded() {
  return (
    <main className="mx-auto flex max-w-xl flex-1 flex-col justify-center px-6 py-20">
      <p className="overline">Solace</p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">
        No pot has been set up yet
      </h1>
      <p className="mt-3 text-ink-secondary">
        The database is empty. Build the demonstration universe, decide the
        allocations, and settle them:
      </p>
      <ol className="mt-5 space-y-2 text-sm">
        {[
          ["npm run db:seed", "eleven households and thirty days of meter data"],
          ["npm run chain", "a local chain, in another terminal"],
          ["npm run deploy:local", "deploy SolacePound"],
          ["npm run allocate", "run the allocation engine"],
          ["npm run settle", "settle every allocation on chain"],
        ].map(([command, note]) => (
          <li key={command} className="flex flex-wrap items-baseline gap-x-3">
            <code className="rounded bg-sunken px-2 py-1 text-xs text-ink">
              {command}
            </code>
            <span className="text-xs text-ink-muted">{note}</span>
          </li>
        ))}
      </ol>
    </main>
  );
}
