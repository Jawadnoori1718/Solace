"use client";

import { useState } from "react";

import { formatKwh, formatPence } from "@/lib/format";
import type { ReportFacts } from "@/lib/domain";

/**
 * The accountability report.
 *
 * One click turns the ledger into prose a councillor could read out in
 * committee. The figures beneath it are the exact ones the model was given, so
 * a reader can check any sentence against the arithmetic that produced it.
 */

interface ReportResponse {
  ok: boolean;
  narrative?: string | null;
  error?: string | null;
  facts?: ReportFacts;
  model?: string;
  unverifiedFigures?: string[];
  generatedAt?: string | null;
  stale?: boolean;
}

export function ReportPanel() {
  const [state, setState] = useState<"idle" | "working" | "done">("idle");
  const [result, setResult] = useState<ReportResponse | null>(null);

  async function generate(): Promise<void> {
    setState("working");
    try {
      const response = await fetch("/api/report", { method: "POST" });
      setResult((await response.json()) as ReportResponse);
    } catch (error) {
      setResult({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "The report request could not be sent.",
      });
    } finally {
      setState("done");
    }
  }

  return (
    <section className="rounded-lg border border-hairline bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-hairline px-5 py-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">
            Accountability report
          </h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            Written from the ledger, in plain English, for a scrutiny committee.
          </p>
        </div>

        <button
          type="button"
          onClick={generate}
          disabled={state === "working"}
          className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper transition-colors hover:bg-ink/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-money disabled:cursor-not-allowed disabled:bg-edge disabled:text-ink-muted"
        >
          {state === "working" ? "Writing…" : "Generate report"}
        </button>
      </div>

      {result === null ? (
        <p className="px-5 py-8 text-center text-sm text-ink-muted">
          {state === "working"
            ? "Gathering the figures and writing the report…"
            : "The report is generated from the ledger on demand."}
        </p>
      ) : (
        <div className="px-5 py-4">
          {result.error != null && (
            <p
              className={`mb-4 rounded-md border px-3 py-2 text-sm ${
                result.stale === true
                  ? "border-caution/30 bg-caution/5 text-ink-secondary"
                  : "border-critical/30 bg-critical/5 text-critical"
              }`}
              role="status"
            >
              {result.error}
              {result.stale === true &&
                " The most recent stored report is shown below."}
            </p>
          )}

          {result.narrative != null && (
            <article className="space-y-3 text-sm leading-relaxed text-ink">
              {result.narrative
                .split(/\n\s*\n/)
                .filter((paragraph) => paragraph.trim() !== "")
                .map((paragraph, index) => (
                  <p key={index}>{paragraph.trim()}</p>
                ))}
            </article>
          )}

          {/*
            The integrity check. Instructions alone are not a guarantee, so
            every number in the prose is compared against the facts the model
            was given. Silence here is the expected result and is worth stating.
          */}
          {result.ok === true && (
            <p
              className={`mt-4 rounded-md border px-3 py-2 text-xs ${
                (result.unverifiedFigures?.length ?? 0) === 0
                  ? "border-good/30 bg-good/5 text-ink-secondary"
                  : "border-critical/30 bg-critical/5 text-critical"
              }`}
            >
              {(result.unverifiedFigures?.length ?? 0) === 0 ? (
                <>
                  Every figure in this report was checked against the ledger it
                  was generated from. None was introduced by the model.
                </>
              ) : (
                <>
                  These figures appear in the report but are not supported by the
                  ledger:{" "}
                  <span className="tabular font-medium">
                    {result.unverifiedFigures?.join(", ")}
                  </span>
                  . Treat them as unverified.
                </>
              )}
            </p>
          )}

          {result.facts !== undefined && <FactTable facts={result.facts} />}
        </div>
      )}
    </section>
  );
}

/** The exact figures handed to the model, so the prose can be checked. */
function FactTable({ facts }: { facts: ReportFacts }) {
  const rows: Array<[string, string]> = [
    ["Deposited", formatPence(facts.depositedPence)],
    ["Spent", formatPence(facts.spentPence)],
    ["Remaining", formatPence(facts.remainingPence)],
    ["Energy delivered", formatKwh(facts.totalKwh)],
    ["Households served", String(facts.householdsServed)],
    [
      "Average per household",
      `${formatKwh(facts.averageKwhPerHousehold)}, ${formatPence(facts.averagePencePerHousehold)}`,
    ],
    ["Confirmed on chain", String(facts.confirmedOnChainCount)],
  ];

  return (
    <details className="mt-4 border-t border-hairline pt-3">
      <summary className="cursor-pointer text-xs font-medium text-ink-secondary hover:text-ink">
        The figures this report was written from
      </summary>

      <dl className="mt-2 space-y-1 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-4">
            <dt className="text-ink-muted">{label}</dt>
            <dd className="tabular text-ink-secondary">{value}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-2 text-xs text-ink-muted">
        The model was given these figures and nothing else. It wrote the
        sentences; it did not source the facts.
      </p>
    </details>
  );
}
