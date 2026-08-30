"use client";

import { useEffect } from "react";

/**
 * Solace — what a councillor sees when something breaks.
 *
 * Not a stack trace. A stack trace on a screen in Parliament is worse than a
 * blank page, because it looks like the system has lost the money rather than
 * failed to draw a chart.
 *
 * The message says what is still true — the ledger is unchanged — offers a
 * retry, and keeps the technical detail behind a disclosure for whoever is
 * actually going to fix it.
 */
export default function DashboardError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    // Server logs are where this belongs; the interface is not a debugger.
    console.error("Dashboard error:", error);
  }, [error]);

  return (
    <main className="mx-auto flex max-w-xl flex-1 flex-col justify-center px-6 py-20">
      <p className="overline">Solace</p>

      <h1 className="mt-2 font-display text-3xl font-semibold text-body">
        The dashboard could not be drawn
      </h1>

      <p className="mt-3 text-body-secondary">
        Something went wrong while assembling this page. Nothing has been spent
        or changed as a result — the ledger and the chain are exactly as they
        were.
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={retry}
          className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper transition-colors hover:bg-ink/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-money"
        >
          Try again
        </button>

        {/*
          A full reload rather than a client-side navigation. If the error came
          from stale client state, routing back to the same page can land
          straight back in it; reloading cannot.
        */}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-md border border-edge px-4 py-2 text-sm font-medium text-body transition-colors hover:bg-sunken"
        >
          Reload the dashboard
        </button>
      </div>

      <details className="mt-8 border-t border-hairline pt-4">
        <summary className="cursor-pointer text-xs font-medium text-body-secondary hover:text-body">
          Technical detail
        </summary>
        <p className="mt-2 break-words text-xs text-body-muted">{error.message}</p>
        {error.digest !== undefined && (
          <p className="mt-1 tabular text-xs text-body-muted">
            Digest {error.digest}
          </p>
        )}
      </details>
    </main>
  );
}
