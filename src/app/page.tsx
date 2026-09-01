import { AllocationList } from "@/components/allocation-list";
import { DemoSteps } from "@/components/demo-steps";
import { DepositControl } from "@/components/deposit-control";
import { LiveExport } from "@/components/live-export";
import { RunAllocation } from "@/components/run-allocation";
import { BalanceChart } from "@/components/balance-chart";
import { ChainLedgerPanel } from "@/components/chain-ledger";
import { EnergyFlow } from "@/components/energy-flow";
import { HealthBanner, LedgerAgreement } from "@/components/health-banner";
import { HouseholdPanel } from "@/components/household-panel";
import { LiveSettlement } from "@/components/live-settlement";
import { Masthead } from "@/components/masthead";
import { PotSummary } from "@/components/pot-summary";
import { ReportPanel } from "@/components/report-panel";
import { RunProvenance, UnservedPanel } from "@/components/unserved-panel";
import { SolaceMark } from "@/components/brand";
import { configurationWarnings } from "@/lib/config";
import {
  getBalanceSeries,
  getChainLedger,
  getEnergyFlowGraph,
  getHouseholds,
  getLatestRun,
  getPendingCount,
  getLiveExport,
  getPotOverview,
  getRecentAllocations,
  getReportCount,
  getSystemHealth,
} from "@/lib/dashboard/queries";

/**
 * The councillor's dashboard.
 *
 * Read from the database on the server on every request. Nothing is cached,
 * because a balance that is thirty seconds stale is a balance that is wrong,
 * and this page exists to be trusted.
 *
 * The page is built in two registers: an ink band carrying the identity and the
 * headline figure, and warm paper below carrying the working detail. That is
 * the structure of a public report, and it is the structure a reader already
 * knows how to navigate.
 */
export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const pot = await getPotOverview();

  if (pot === null) {
    return <NotSeeded />;
  }

  const [
    allocations,
    households,
    series,
    run,
    pendingCount,
    health,
    flow,
    liveExport,
    reportCount,
    chainLedger,
  ] = await Promise.all([
    getRecentAllocations(12),
    getHouseholds(),
    getBalanceSeries(),
    getLatestRun(),
    getPendingCount(),
    getSystemHealth(),
    getEnergyFlowGraph(),
    getLiveExport(),
    getReportCount(),
    getChainLedger(),
  ]);

  const warnings = configurationWarnings();

  return (
    <>
      <div className="ink-band">
        <Masthead
          councilName={pot.councilName}
          fundingSource={pot.fundingSource}
        />
        <PotSummary pot={pot} households={households} />
      </div>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
        {health.problems.length > 0 && (
          <div className="mb-8">
            <HealthBanner health={health} />
          </div>
        )}

        <DemoSteps
          state={{
            deposited: pot.depositedPence > 0,
            allocated: (run?.decisionCount ?? 0) > 0,
            settled: pot.settlementsConfirmed > 0,
            reported: reportCount > 0,
            verifiable: pot.latestSettlement !== null,
          }}
        />

        <div className="mt-8 grid items-start gap-8 lg:grid-cols-2">
          <DepositControl depositedPence={pot.depositedPence} />
          <LiveExport initial={liveExport} />
        </div>

        <div className="mt-8">
          <RunAllocation canRun={pot.depositedPence > 0} />
        </div>

        <div className="mt-8">
          <EnergyFlow graph={flow} />
        </div>

        <div className="mt-8">
          <LiveSettlement
            openingBalancePence={pot.balancePence}
            pendingCount={pendingCount}
          />
        </div>

        <div className="mt-8">
          <ChainLedgerPanel ledger={chainLedger} />
        </div>

        <div className="mt-8 grid gap-8 lg:grid-cols-5">
          <section className="lg:col-span-3">
            <SectionHeading
              title="Recent allocations"
              note="Newest first. Open any row to see exactly why that household was chosen."
            />
            <AllocationList allocations={allocations} />

            <div className="mt-8">
              <SectionHeading
                title="The pot over time"
                note="What remained at the end of each day."
              />
              <div className="rounded-xl border border-hairline bg-surface p-5 shadow-[var(--shadow-card)]">
                <BalanceChart series={series} />
                <LedgerAgreement health={health} />
              </div>
            </div>
          </section>

          <div className="space-y-8 lg:col-span-2">
            <section>
              <SectionHeading
                title="Households"
                note="Ordered by the share of each household's electricity that Solace covered."
              />
              <HouseholdPanel households={households} />
            </section>

            <ReportPanel />
            {run !== null && <UnservedPanel run={run} />}
            {run !== null && <RunProvenance run={run} />}
          </div>
        </div>

        {warnings.length > 0 && (
          <section className="mt-8 rounded-xl border border-caution/30 bg-caution/5 p-4">
            <h2 className="text-sm font-semibold text-caution">
              Not yet configured
            </h2>
            <ul className="mt-2 space-y-1 text-sm text-body-secondary">
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

/**
 * A section title with a short amber rule above it.
 *
 * The rule is the one piece of pure ornament on the page, and it earns its
 * place by giving the long working area a rhythm the eye can navigate. It is
 * amber because everything else amber on this page is energy, and these are the
 * sections about where the energy went.
 */
function SectionHeading({ title, note }: { title: string; note: string }) {
  return (
    <div className="mb-4">
      <div className="mb-3 h-[3px] w-9 rounded-full bg-warmth" aria-hidden="true" />
      <h2 className="section-title text-xl text-body">{title}</h2>
      <p className="mt-1 text-xs text-body-muted">{note}</p>
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
    <footer className="ink-band mt-4">
      <div className="mx-auto max-w-6xl px-6 py-9">
        <div className="grid gap-8 text-xs leading-relaxed text-on-ink-secondary sm:grid-cols-3">
          <div>
            <p className="overline-on-ink mb-2">Meter data</p>
            <p>
              Simulated. Integration path: DCC and supplier APIs. No real
              household is described anywhere in this system.
            </p>
          </div>

          <div>
            <p className="overline-on-ink mb-2">Privacy</p>
            <p>
              No personal data reaches the chain. Recipients appear only as a
              keyed HMAC of an internal reference; the mapping back to a
              household exists only in the council&rsquo;s own database.
            </p>
          </div>

          <div>
            <p className="overline-on-ink mb-2">Settlement</p>
            <p>
              <span className="font-medium text-on-ink">SolacePound</span> is a
              testnet demonstration token standing in for a regulated GBP
              stablecoin. It holds no value.
            </p>
            {pot.contract.address !== null && (
              <p className="tabular mt-2 break-all text-on-ink-muted">
                {pot.contract.explorerUrl === null ? (
                  pot.contract.address
                ) : (
                  <a
                    href={pot.contract.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2 hover:text-on-ink"
                  >
                    {pot.contract.address}
                  </a>
                )}
              </p>
            )}
          </div>
        </div>

        <div className="rule-fade mt-8 h-px" />

        <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <SolaceMark size={22} withRays={false} />
            <span className="text-xs text-on-ink-muted">
              An accountability layer for fuel poverty spending
            </span>
          </div>
          <p className="text-xs text-on-ink-muted">
            {pot.councilName}
            <span className="mx-2 opacity-40" aria-hidden="true">
              ·
            </span>
            <span className="tabular">{pot.reference}</span>
          </p>
        </div>
      </div>
    </footer>
  );
}

/** Shown before the seed has run, rather than an empty page or a crash. */
function NotSeeded() {
  return (
    <main className="mx-auto flex max-w-xl flex-1 flex-col justify-center px-6 py-20">
      <SolaceMark size={44} />
      <h1 className="mt-5 font-display text-3xl font-semibold text-body">
        No pot has been set up yet
      </h1>
      <p className="mt-3 text-body-secondary">
        The database is empty. Build the demonstration in one command:
      </p>
      <code className="mt-5 self-start rounded-lg bg-ink px-4 py-2.5 text-sm text-paper">
        npm run demo:setup
      </code>
      <p className="mt-4 text-xs text-body-muted">
        It starts a local chain, generates thirty days of meter data, deploys the
        token, runs the allocation engine, and settles the history on chain.
      </p>
    </main>
  );
}
