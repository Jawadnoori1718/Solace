"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The six beats, and where the demonstration has got to.
 *
 * On stage this is a map: it says what has been done, what is next, and what
 * each step is called, so nobody has to remember the running order under
 * pressure. Off stage it is the fastest way to see whether the machine is in a
 * state worth demonstrating.
 *
 * The reset exists because a demonstration that can only be given once cannot
 * be rehearsed, and an unrehearsed demonstration is one that fails.
 */

export interface StepState {
  deposited: boolean;
  allocated: boolean;
  settled: boolean;
  reported: boolean;
  verifiable: boolean;
}

const BEATS = [
  { key: "deposit", label: "Deposit", detail: "Council commits money" },
  { key: "export", label: "Export", detail: "Roofs producing surplus" },
  { key: "allocate", label: "Allocate", detail: "Engine decides, and explains" },
  { key: "settle", label: "Settle", detail: "Tokens move, pot drains" },
  { key: "report", label: "Report", detail: "Plain English for committee" },
  { key: "verify", label: "Verify", detail: "Open the block explorer" },
] as const;

export function DemoSteps({ state }: { state: StepState }) {
  const router = useRouter();
  const [resetting, setResetting] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const done: Record<string, boolean> = {
    deposit: state.deposited,
    // Export is always happening; it is a fact about the world, not a step the
    // operator performs.
    export: true,
    allocate: state.allocated,
    settle: state.settled,
    report: state.reported,
    verify: state.verifiable,
  };

  // The first beat that has not happened yet is the one to do next.
  const nextKey = BEATS.find((beat) => !done[beat.key])?.key ?? null;

  async function reset(): Promise<void> {
    if (!window.confirm(
      "Clear all deposits, allocations, settlements and reports, so the demonstration can be run again from the beginning?\n\nHouseholds and thirty days of meter data are kept.",
    )) {
      return;
    }

    setResetting(true);
    setNote(null);

    try {
      const response = await fetch("/api/demo/reset", { method: "POST" });
      const data = (await response.json()) as { ok: boolean; error?: string };

      setNote(
        data.ok
          ? "Reset. Start again with a deposit."
          : (data.error ?? "The reset did not complete."),
      );
      router.refresh();
    } catch {
      setNote("The reset request could not be sent.");
    } finally {
      setResetting(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-xl border border-hairline bg-surface shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-5 py-3">
        <p className="text-xs font-semibold tracking-[0.14em] text-body-muted uppercase">
          The demonstration
        </p>

        <div className="flex items-center gap-3">
          {note !== null && (
            <span className="text-xs text-body-secondary">{note}</span>
          )}
          <button
            type="button"
            onClick={reset}
            disabled={resetting}
            className="rounded-full border border-hairline px-3 py-1 text-xs text-body-secondary transition-colors hover:border-edge hover:bg-sunken disabled:opacity-50"
          >
            {resetting ? "Resetting…" : "Start over"}
          </button>
        </div>
      </div>

      <ol className="grid gap-px bg-hairline sm:grid-cols-3 lg:grid-cols-6">
        {BEATS.map((beat, index) => {
          const complete = done[beat.key];
          const isNext = beat.key === nextKey;

          return (
            <li
              key={beat.key}
              className={`bg-surface px-4 py-3.5 ${isNext ? "bg-warmth/5" : ""}`}
              aria-current={isNext ? "step" : undefined}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.625rem] font-semibold ${
                    complete
                      ? "bg-good text-white"
                      : isNext
                        ? "bg-warmth text-white"
                        : "border border-edge text-body-muted"
                  }`}
                  aria-hidden="true"
                >
                  {complete ? "✓" : index + 1}
                </span>

                <span
                  className={`text-sm font-medium ${
                    complete || isNext ? "text-body" : "text-body-muted"
                  }`}
                >
                  {beat.label}
                </span>
              </div>

              <p className="mt-1 pl-7.5 text-xs leading-snug text-body-muted">
                {beat.detail}
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
