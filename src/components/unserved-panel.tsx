import type { NeedSummaryRow, RunSummary, UnservedRow } from "@/lib/dashboard/queries";

/**
 * The households that received nothing, and why.
 *
 * This panel exists because a system that explains only its positive decisions
 * cannot answer the question it will actually be asked. The household that got
 * nothing is the one most likely to complain, and the councillor who signed the
 * money off is the one who will have to account for it.
 *
 * Each entry carries the engine's own reason in its own words, alongside the
 * need score that produced it.
 */
export function UnservedPanel({ run }: { run: RunSummary }) {
  if (run.unserved.length === 0) {
    return null;
  }

  const scoreFor = new Map<string, NeedSummaryRow>(
    run.assessments.map((assessment) => [
      assessment.recipientReference,
      assessment,
    ]),
  );

  return (
    <section className="rounded-lg border border-hairline bg-surface">
      <div className="border-b border-hairline px-5 py-4">
        <h2 className="font-display text-lg font-semibold text-ink">
          Households that received nothing
        </h2>
        <p className="mt-0.5 text-xs text-ink-muted">
          Every decision the engine made against a household, with its reason.
        </p>
      </div>

      <ul className="divide-y divide-hairline">
        {run.unserved.map((entry: UnservedRow) => {
          const assessment = scoreFor.get(entry.recipientReference);

          return (
            <li key={entry.recipientReference} className="px-5 py-3.5">
              <div className="flex items-baseline justify-between gap-4">
                <p className="tabular text-sm font-medium text-ink">
                  {entry.recipientReference}
                </p>
                {assessment !== undefined && (
                  <p className="shrink-0 text-xs text-ink-muted">
                    need{" "}
                    <span className="tabular text-ink-secondary">
                      {assessment.needScore.toFixed(2)}
                    </span>
                  </p>
                )}
              </div>

              <p className="mt-1 text-xs leading-relaxed text-ink-secondary">
                {entry.reason}
              </p>

              {assessment !== undefined && assessment.expectedDailyKwh > 0 && (
                <p className="mt-1 text-xs text-ink-muted tabular">
                  Using {assessment.actualDailyKwh.toFixed(1)} kWh a day against{" "}
                  {assessment.expectedDailyKwh.toFixed(1)} expected for this
                  weather.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * What the run itself was, so it can be replayed.
 *
 * The digests are the attestation. Anybody holding the same input can re-run
 * the engine and check that these two values come out the same, which is what
 * makes "reproducible" a claim rather than a slogan.
 */
export function RunProvenance({ run }: { run: RunSummary }) {
  return (
    <section className="rounded-lg border border-hairline bg-surface px-5 py-4">
      <h2 className="font-display text-base font-semibold text-ink">
        This allocation run
      </h2>
      <p className="mt-0.5 text-xs text-ink-muted">
        Deterministic. The same input always produces the same decisions, and
        these digests are how anyone can check that.
      </p>

      <dl className="mt-3 space-y-2 text-xs">
        <Entry label="Engine" value={run.engineVersion} />
        <Entry label="Seed" value={run.seed} />
        <Entry label="Decisions" value={run.decisionCount.toLocaleString("en-GB")} />
        {run.unallocatedKwh !== null && (
          <Entry
            label="Surplus unplaced"
            value={`${run.unallocatedKwh.toFixed(1)} kWh`}
            note="generated when nobody nearby was drawing power"
          />
        )}
        <Entry label="Input digest" value={run.inputDigest} mono />
        <Entry label="Output digest" value={run.outputDigest} mono />
      </dl>
    </section>
  );
}

function Entry({
  label,
  value,
  note,
  mono,
}: {
  label: string;
  value: string;
  note?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <dt className="shrink-0 text-ink-muted">{label}</dt>
        <dd
          className={`min-w-0 text-right text-ink-secondary ${
            mono === true ? "tabular break-all text-[0.6875rem]" : "tabular"
          }`}
        >
          {value}
        </dd>
      </div>
      {note !== undefined && (
        <p className="mt-0.5 text-right text-ink-muted">{note}</p>
      )}
    </div>
  );
}
