"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { formatKwh, formatPence } from "@/lib/format";
import type { AllocationReasoning } from "@/lib/domain";

/**
 * Run the allocation engine, in public.
 *
 * Beat three: the engine runs and shows its reasoning — who receives what, and
 * why.
 *
 * The solver finishes in about fifty milliseconds, which is too fast to watch
 * and, more importantly, too fast to trust. So the run is shown as the three
 * steps it actually performs: every household assessed, the window solved, and
 * the highest-priority decisions published with their working. The pacing is
 * stated on screen rather than hidden, because the alternative is a progress
 * bar that implies work which is not happening.
 */

interface Assessment {
  reference: string;
  locality: string;
  needScore: number;
  eligible: boolean;
  reason: string | null;
  actualDailyKwh: number;
  expectedDailyKwh: number;
}

interface Decision {
  rank: number;
  kwh: number;
  amountPence: number;
  recipientLocality: string;
  exporterLocality: string;
  reasoning: AllocationReasoning;
}

interface Solved {
  decisions: number;
  totalKwh: number;
  totalPence: number;
  unallocatedKwh: number;
  inputDigest: string;
  outputDigest: string;
  engineVersion: string;
  elapsedMs: number;
  notes: string[];
}

type Phase = "idle" | "running" | "finished" | "error";

export function RunAllocation({ canRun }: { canRun: boolean }) {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("idle");
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [solved, setSolved] = useState<Solved | null>(null);
  const [replayIdentical, setReplayIdentical] = useState<boolean | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [stage, setStage] = useState<string>("");

  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    return () => {
      sourceRef.current?.close();
      sourceRef.current = null;
    };
  }, []);

  const start = useCallback(() => {
    if (phase === "running") return;

    setPhase("running");
    setAssessments([]);
    setDecisions([]);
    setSolved(null);
    setReplayIdentical(null);
    setMessage(null);
    setStage("Loading meter data and council records…");

    const source = new EventSource("/api/allocate/stream");
    sourceRef.current = source;

    source.onmessage = (event) => {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(event.data) as Record<string, unknown>;
      } catch {
        return;
      }

      switch (payload.type) {
        case "loaded":
          setStage(
            `Assessing ${payload.recipients} households against ${payload.days} days of meter data…`,
          );
          break;

        case "assessed":
          setAssessments((current) => [
            ...current,
            payload as unknown as Assessment,
          ]);
          break;

        case "solved":
          setSolved(payload as unknown as Solved);
          setStage("Checking the run reproduces…");
          break;

        case "replayed":
          setReplayIdentical(payload.identical === true);
          setStage("Publishing the highest-priority decisions…");
          break;

        case "decision":
          setDecisions((current) => [
            ...current,
            payload as unknown as Decision,
          ]);
          break;

        case "done":
          setStage("");
          setPhase("finished");
          source.close();
          sourceRef.current = null;
          router.refresh();
          break;

        case "error":
          setMessage(String(payload.reason ?? "The engine could not run."));
          setPhase("error");
          source.close();
          sourceRef.current = null;
          break;
      }
    };

    source.onerror = () => {
      source.close();
      sourceRef.current = null;
      setPhase((current) => {
        if (current === "running") {
          setMessage("The connection to the engine was lost.");
          return "error";
        }
        return current;
      });
    };
  }, [phase, router]);

  const running = phase === "running";

  return (
    <section className="overflow-hidden rounded-xl border border-hairline bg-surface shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-hairline px-6 py-5">
        <div>
          <div className="mb-3 h-[3px] w-9 rounded-full bg-warmth" aria-hidden="true" />
          <h2 className="section-title text-xl text-body">
            Run the allocation engine
          </h2>
          <p className="mt-1 max-w-xl text-xs text-body-muted">
            Deterministic and reproducible. No language model takes any part in
            deciding who receives energy.
          </p>
        </div>

        <button
          type="button"
          onClick={start}
          disabled={running || !canRun}
          className="rounded-lg bg-ink px-5 py-3 text-sm font-medium text-paper transition-colors hover:bg-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-money disabled:cursor-not-allowed disabled:bg-edge disabled:text-body-muted"
          title={canRun ? undefined : "Commit money to the pot first"}
        >
          {running ? "Running…" : "Run the engine"}
        </button>
      </div>

      {!canRun && phase === "idle" && (
        <p className="border-b border-hairline bg-caution/5 px-6 py-3 text-xs text-body-secondary">
          The pot holds nothing yet. Commit money above, then the engine has
          something to allocate.
        </p>
      )}

      {message !== null && (
        <p
          className="border-b border-hairline bg-critical/5 px-6 py-3 text-sm text-critical"
          role="status"
        >
          {message}
        </p>
      )}

      {running && stage !== "" && (
        <p className="flex items-center gap-2.5 border-b border-hairline px-6 py-3 text-sm text-body-secondary">
          <span
            className="h-2 w-2 shrink-0 rounded-full bg-warmth"
            style={{ animation: "soft-pulse 1.2s ease-in-out infinite" }}
            aria-hidden="true"
          />
          {stage}
        </p>
      )}

      {assessments.length > 0 && (
        <div className="border-b border-hairline px-6 py-5">
          <p className="overline mb-3">
            Step one — every household assessed
          </p>

          <ul className="space-y-1.5" aria-live="polite">
            {assessments.map((assessment) => (
              <li
                key={assessment.reference}
                className="animate-[settle-in_320ms_ease-out] flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm"
              >
                <span className="tabular w-14 shrink-0 text-body-muted">
                  {assessment.reference}
                </span>
                <span className="w-28 shrink-0 font-medium text-body">
                  {assessment.locality}
                </span>

                <span
                  className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-sunken"
                  aria-hidden="true"
                >
                  <span
                    className={`block h-full rounded-full ${
                      assessment.eligible ? "bg-warmth" : "bg-edge"
                    }`}
                    style={{ width: `${assessment.needScore * 100}%` }}
                  />
                </span>

                <span className="tabular w-10 shrink-0 text-body-secondary">
                  {assessment.needScore.toFixed(2)}
                </span>

                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] ${
                    assessment.eligible
                      ? "bg-good/10 text-good"
                      : "bg-sunken text-body-muted"
                  }`}
                >
                  {assessment.eligible ? "eligible" : "below threshold"}
                </span>

                <span className="tabular text-xs text-body-muted">
                  using {assessment.actualDailyKwh.toFixed(1)} of{" "}
                  {assessment.expectedDailyKwh.toFixed(1)} kWh expected
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {solved !== null && (
        <div className="border-b border-hairline bg-sunken/40 px-6 py-5">
          <p className="overline mb-3">Step two — the window solved</p>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            <Figure label="Decisions" value={solved.decisions.toLocaleString("en-GB")} />
            <Figure label="Energy" value={formatKwh(solved.totalKwh, 0)} />
            <Figure label="Committed" value={formatPence(solved.totalPence)} />
            <Figure
              label="Solved in"
              value={`${solved.elapsedMs} ms`}
              note={`engine ${solved.engineVersion}`}
            />
          </dl>

          {replayIdentical !== null && (
            <p
              className={`mt-4 rounded-md border px-3 py-2 text-xs ${
                replayIdentical
                  ? "border-good/30 bg-good/5 text-body-secondary"
                  : "border-critical/30 bg-critical/5 text-critical"
              }`}
            >
              {replayIdentical ? (
                <>
                  Re-run on the same input, the engine produced a byte-identical
                  result. Output digest{" "}
                  <span className="tabular">
                    {solved.outputDigest.slice(0, 16)}…
                  </span>
                </>
              ) : (
                "The replay did not match. The engine is not behaving deterministically."
              )}
            </p>
          )}

          {solved.unallocatedKwh > 0 && (
            <p className="mt-2 text-xs text-body-muted">
              {formatKwh(solved.unallocatedKwh, 0)} of surplus could not be
              placed — generated when nobody nearby was drawing power.
            </p>
          )}
        </div>
      )}

      {decisions.length > 0 && (
        <div className="px-6 py-5">
          <p className="overline mb-3">
            Step three — the highest-priority decisions, and why
          </p>

          <ul className="space-y-3" aria-live="polite">
            {decisions.map((decision) => (
              <li
                key={decision.rank}
                className="animate-[settle-in_320ms_ease-out] rounded-lg border border-hairline px-4 py-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="text-sm text-body">
                    <span className="tabular mr-2 text-body-muted">
                      #{decision.rank}
                    </span>
                    <span className="font-medium">
                      {decision.recipientLocality}
                    </span>
                    <span className="mx-1.5 text-body-muted" aria-hidden="true">
                      ←
                    </span>
                    <span className="text-body-secondary">
                      {decision.exporterLocality}
                    </span>
                  </p>

                  <p className="flex items-baseline gap-4">
                    <span className="tabular text-sm font-semibold text-warmth">
                      {formatKwh(decision.kwh)}
                    </span>
                    <span className="tabular text-sm font-semibold text-body">
                      {formatPence(decision.amountPence)}
                    </span>
                  </p>
                </div>

                <p className="mt-1.5 text-xs leading-relaxed text-body-secondary">
                  {decision.reasoning.summary}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {phase === "finished" && (
        <p className="border-t border-hairline bg-sunken/40 px-6 py-3 text-xs text-body-muted">
          Every decision is stored with its full reasoning. Open any row in the
          allocations list below to see the arithmetic. Nothing has been settled
          yet — that is the next step.
        </p>
      )}
    </section>
  );
}

function Figure({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div>
      <dt className="overline">{label}</dt>
      <dd className="figure mt-1 text-xl font-semibold text-body">{value}</dd>
      {note !== undefined && (
        <p className="mt-0.5 text-xs text-body-muted">{note}</p>
      )}
    </div>
  );
}
