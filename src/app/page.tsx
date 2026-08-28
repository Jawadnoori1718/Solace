import {
  configurationWarnings,
  modeDescription,
  MODE,
  TARIFF_PENCE_PER_KWH,
} from "@/lib/config";

/**
 * Holding page for the scaffold.
 *
 * The councillor's dashboard replaces this in Phase 6. Until then this page
 * earns its keep by proving the configuration layer resolves and by reporting,
 * honestly, what is and is not set up.
 */
export default function Home() {
  const warnings = configurationWarnings();

  return (
    <div className="flex flex-1 items-center justify-center bg-slate-50 px-6 py-16">
      <main className="w-full max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
          Scaffold
        </p>

        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-900">
          Solace
        </h1>

        <p className="mt-4 text-lg leading-relaxed text-slate-700">
          An accountability layer for fuel poverty spending. Surplus rooftop
          solar routed to households in need, settled on a public ledger, and
          reported back to the councillor who funded it in plain English.
        </p>

        <dl className="mt-10 divide-y divide-slate-200 border-y border-slate-200 text-sm">
          <div className="flex justify-between gap-6 py-3">
            <dt className="text-slate-600">Operating mode</dt>
            <dd className="text-right font-medium text-slate-900">
              {MODE} — {modeDescription()}
            </dd>
          </div>
          <div className="flex justify-between gap-6 py-3">
            <dt className="text-slate-600">Tariff assumption</dt>
            <dd className="text-right font-medium text-slate-900">
              {TARIFF_PENCE_PER_KWH}p per kWh
            </dd>
          </div>
        </dl>

        {warnings.length > 0 && (
          <section className="mt-8 rounded-md border border-amber-300 bg-amber-50 p-4">
            <h2 className="text-sm font-semibold text-amber-900">
              Not yet configured
            </h2>
            <ul className="mt-2 space-y-1.5 text-sm text-amber-900">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </section>
        )}

        <p className="mt-8 text-sm text-slate-500">
          Meter data simulated. Integration path: DCC and supplier APIs.
        </p>
      </main>
    </div>
  );
}
