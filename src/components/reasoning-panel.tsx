"use client";

import { useId, useState } from "react";

import { formatKwh, formatPence } from "@/lib/format";
import type { AllocationReasoning } from "@/lib/domain";

/**
 * Why this household, and why this much.
 *
 * The panel shows every factor, its raw value, its published weight, and what it
 * contributed — so a reader can add up the column themselves and arrive at the
 * total. That is the difference between an explanation and an assertion.
 *
 * The bars are scaled to each factor's maximum possible contribution, not to
 * the largest one present. A factor contributing half of what it could shows a
 * half-full bar, which is the honest reading; scaling to the observed maximum
 * would make the biggest contributor look complete whatever its size.
 */
export function ReasoningPanel({
  reasoning,
  kwh,
  amountPence,
  settlement,
}: {
  reasoning: AllocationReasoning;
  kwh: number;
  amountPence: number;
  settlement?: {
    txHash: string | null;
    explorerUrl: string | null;
    chain: string;
  } | null;
}) {
  const factors = [...reasoning.factors].sort(
    (a, b) => b.contribution - a.contribution,
  );

  return (
    <div className="border-t border-hairline bg-sunken/40 px-5 py-4 text-sm">
      <p className="text-body-secondary">{reasoning.summary}</p>

      {/* The arithmetic, laid out so it can be checked. */}
      <div className="mt-4">
        <div className="flex items-baseline justify-between">
          <h4 className="text-xs font-semibold text-body">
            Need score {reasoning.needScore.toFixed(3)}
          </h4>
          <span className="text-xs text-body-muted">
            factor × weight = contribution
          </span>
        </div>

        <ul className="mt-2 space-y-1.5">
          {factors.map((factor) => {
            const share = factor.weight > 0 ? factor.contribution / factor.weight : 0;

            return (
              <li key={factor.key} className="grid grid-cols-[1fr_auto] gap-x-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div
                      className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-hairline"
                      aria-hidden="true"
                    >
                      <div
                        className="h-full rounded-full bg-money"
                        style={{ width: `${Math.min(100, share * 100)}%` }}
                      />
                    </div>
                    <span className="truncate text-xs text-body">
                      {factor.label}
                    </span>
                  </div>
                  <p className="ml-[4.5rem] mt-0.5 text-xs leading-snug text-body-muted">
                    {factor.explanation}
                  </p>
                </div>

                <span className="tabular whitespace-nowrap text-xs text-body-secondary">
                  {factor.weight.toFixed(2)} → {factor.contribution.toFixed(4)}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <dl className="mt-4 grid gap-3 border-t border-hairline pt-3 text-xs sm:grid-cols-2">
        <div>
          <dt className="font-semibold text-body">
            Fairness × {reasoning.fairnessMultiplier.toFixed(3)}
          </dt>
          <dd className="mt-0.5 text-body-muted">{reasoning.fairness.note}</dd>
        </div>

        <div>
          <dt className="font-semibold text-body">
            {reasoning.proximity.distanceKm.toFixed(1)} km away
          </dt>
          <dd className="mt-0.5 text-body-muted">
            Within the {reasoning.proximity.withinRadiusKm} km radius, from{" "}
            {reasoning.proximity.exporterReference}. Surplus delivered locally
            puts less strain on the distribution network.
          </dd>
        </div>
      </dl>

      <p className="mt-3 border-t border-hairline pt-3 text-xs text-body-muted">
        Priority{" "}
        <span className="tabular text-body-secondary">
          {reasoning.needScore.toFixed(3)} × {reasoning.fairnessMultiplier.toFixed(3)} ={" "}
          {reasoning.priorityScore.toFixed(3)}
        </span>
        <span className="mx-2" aria-hidden="true">
          ·
        </span>
        {formatKwh(kwh)} at {formatPence(amountPence)}
        <span className="mx-2" aria-hidden="true">
          ·
        </span>
        decided by engine {reasoning.engineVersion}, with no language model
        involved
      </p>

      {/* The link out to an independent record. Placed here rather than in the
          row's header because an anchor inside a button breaks keyboard
          navigation. */}
      {settlement?.txHash != null && (
        <p className="mt-3 border-t border-hairline pt-3 text-xs">
          {settlement.explorerUrl === null ? (
            <span className="text-body-muted">
              Settled on a local chain, which has no public explorer. Transaction{" "}
              <span className="tabular break-all">{settlement.txHash}</span>
            </span>
          ) : (
            <a
              href={settlement.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-money underline underline-offset-2 hover:text-body"
            >
              Verify this settlement on the public block explorer ↗
            </a>
          )}
        </p>
      )}
    </div>
  );
}

/**
 * A row that can be opened to reveal its reasoning.
 *
 * Uses a real button with `aria-expanded` rather than a click handler on a div,
 * so the panel is reachable by keyboard and announced correctly.
 */
export function ExpandableRow({
  summary,
  children,
  defaultOpen = false,
}: {
  summary: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-sunken/50 focus-visible:bg-sunken/50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-money"
      >
        <span
          className={`shrink-0 text-body-muted transition-transform duration-200 ${
            open ? "rotate-90" : ""
          }`}
          aria-hidden="true"
        >
          ›
        </span>
        <span className="min-w-0 flex-1">{summary}</span>
      </button>

      {open && <div id={panelId}>{children}</div>}
    </div>
  );
}
