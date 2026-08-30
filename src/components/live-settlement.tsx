"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { AnimatedPence } from "./animated-balance";
import { formatKwh, formatPence, shortenHash } from "@/lib/format";

/**
 * Settlement, live.
 *
 * Opens a stream, settles pending allocations one at a time, and shows each as
 * its transaction confirms while the pot balance counts down. Every row that
 * appears is a transaction that has already been mined — the feed reports the
 * chain, it does not anticipate it.
 */

interface FeedItem {
  id: string;
  ok: boolean;
  kwh: number;
  amountPence: number;
  exporterLocality: string;
  recipientLocality: string;
  recipientReference: string;
  txHash: string | null;
  explorerUrl: string | null;
  error: string | null;
}

type Phase = "idle" | "running" | "finished" | "error";

export function LiveSettlement({
  openingBalancePence,
  pendingCount,
}: {
  openingBalancePence: number;
  pendingCount: number;
}) {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("idle");
  const [balancePence, setBalancePence] = useState(openingBalancePence);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [message, setMessage] = useState<string | null>(null);

  const sourceRef = useRef<EventSource | null>(null);

  // Close the stream if the component goes away mid-run.
  useEffect(() => {
    return () => {
      sourceRef.current?.close();
      sourceRef.current = null;
    };
  }, []);

  const start = useCallback(() => {
    if (phase === "running") return;

    setPhase("running");
    setFeed([]);
    setMessage(null);
    setProgress({ done: 0, total: 0 });

    const source = new EventSource("/api/settle/stream?limit=12");
    sourceRef.current = source;

    source.onmessage = (event) => {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(event.data) as Record<string, unknown>;
      } catch {
        return;
      }

      switch (payload.type) {
        case "start": {
          setProgress({ done: 0, total: Number(payload.pending ?? 0) });
          setBalancePence(Number(payload.balancePence ?? openingBalancePence));
          break;
        }

        case "settled":
        case "failed": {
          const allocation = payload.allocation as Record<string, unknown>;
          const ok = payload.type === "settled";

          setFeed((current) => [
            {
              id: String(allocation.id),
              ok,
              kwh: Number(allocation.kwh ?? 0),
              amountPence: Number(allocation.amountPence ?? 0),
              exporterLocality: String(allocation.exporterLocality ?? ""),
              recipientLocality: String(allocation.recipientLocality ?? ""),
              recipientReference: String(allocation.recipientReference ?? ""),
              txHash: (payload.txHash as string | null) ?? null,
              explorerUrl: (payload.explorerUrl as string | null) ?? null,
              error: (payload.error as string | null) ?? null,
            },
            ...current,
          ]);

          setBalancePence(Number(payload.balancePence ?? 0));
          setProgress((current) => ({ ...current, done: current.done + 1 }));
          break;
        }

        case "done": {
          setBalancePence(Number(payload.balancePence ?? 0));
          if (typeof payload.message === "string") setMessage(payload.message);
          setPhase("finished");
          source.close();
          sourceRef.current = null;
          // Pull the server components back into step with what just happened.
          router.refresh();
          break;
        }

        case "error": {
          setMessage(String(payload.reason ?? "Settlement could not start."));
          setPhase("error");
          source.close();
          sourceRef.current = null;
          break;
        }
      }
    };

    // Fires when the connection drops. The stream closes itself on completion,
    // which also lands here, so only an unfinished run is a real failure.
    source.onerror = () => {
      source.close();
      sourceRef.current = null;
      setPhase((current) => {
        if (current === "running") {
          setMessage(
            "The connection to the settlement stream was lost. Anything already confirmed is recorded.",
          );
          return "error";
        }
        return current;
      });
    };
  }, [phase, openingBalancePence, router]);

  const running = phase === "running";

  return (
    <section className="rounded-lg border border-hairline bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-hairline px-5 py-4">
        <div>
          <div className="mb-3 h-[3px] w-9 rounded-full bg-warmth" aria-hidden="true" />
          <h2 className="section-title text-xl text-body">
            Settle live
          </h2>
          <p className="mt-1 text-xs text-body-muted">
            {pendingCount > 0
              ? `${pendingCount} allocation${pendingCount === 1 ? "" : "s"} awaiting settlement.`
              : "Nothing is awaiting settlement."}
          </p>
        </div>

        <div className="flex items-center gap-5">
          <div className="text-right">
            <p className="overline">Remaining</p>
            <AnimatedPence
              value={balancePence}
              className="figure block text-2xl font-semibold text-body"
            />
          </div>

          <button
            type="button"
            onClick={start}
            disabled={running || pendingCount === 0}
            className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper transition-colors hover:bg-ink/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-money disabled:cursor-not-allowed disabled:bg-edge disabled:text-body-muted"
          >
            {running ? "Settling…" : "Settle now"}
          </button>
        </div>
      </div>

      {running && progress.total > 0 && (
        <div className="border-b border-hairline px-5 py-2.5">
          <div className="flex items-center gap-3">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-sunken">
              <div
                className="h-full rounded-full bg-money transition-[width] duration-300 ease-out"
                style={{ width: `${(progress.done / progress.total) * 100}%` }}
              />
            </div>
            <span className="tabular text-xs text-body-muted">
              {progress.done} of {progress.total}
            </span>
          </div>
        </div>
      )}

      {message !== null && (
        <p
          className={`border-b border-hairline px-5 py-3 text-sm ${
            phase === "error" ? "text-critical" : "text-body-secondary"
          }`}
          role="status"
        >
          {message}
        </p>
      )}

      {feed.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-5 py-12 text-center">
          <span
            className={`inline-flex h-11 w-11 items-center justify-center rounded-full border ${
              running
                ? "border-warmth/30 bg-warmth/10"
                : "border-hairline bg-sunken"
            }`}
            aria-hidden="true"
          >
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                running ? "bg-warmth" : "bg-edge"
              }`}
              style={
                running
                  ? { animation: "soft-pulse 1.6s ease-in-out infinite" }
                  : undefined
              }
            />
          </span>

          <p className="max-w-sm text-sm text-body-secondary">
            {running
              ? "Waiting for the first transaction to confirm…"
              : pendingCount > 0
                ? "Each settlement appears here the moment its transaction is mined, and the balance above falls with it."
                : "Every allocation has already been settled."}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-hairline" aria-live="polite">
          {feed.map((item) => (
            <li
              key={item.id}
              className="animate-[settle-in_360ms_ease-out] px-5 py-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1">
                <div className="min-w-0">
                  <p className="text-sm text-body">
                    <span className="font-medium">{item.recipientLocality}</span>
                    <span className="mx-1.5 text-body-muted" aria-hidden="true">
                      ←
                    </span>
                    <span className="text-body-secondary">
                      {item.exporterLocality}
                    </span>
                  </p>
                  {item.error !== null && (
                    <p className="mt-0.5 text-xs text-critical">{item.error}</p>
                  )}
                </div>

                <div className="flex items-baseline gap-4">
                  <span className="tabular text-sm font-semibold text-warmth">
                    {formatKwh(item.kwh)}
                  </span>
                  <span className="tabular text-sm font-semibold text-body">
                    {formatPence(item.amountPence)}
                  </span>

                  {item.ok ? (
                    item.explorerUrl !== null ? (
                      <a
                        href={item.explorerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="tabular rounded-full border border-good/30 bg-good/10 px-2 py-0.5 text-xs text-good underline-offset-2 hover:underline"
                      >
                        {shortenHash(item.txHash ?? "")} ↗
                      </a>
                    ) : (
                      <span
                        className="tabular rounded-full border border-good/30 bg-good/10 px-2 py-0.5 text-xs text-good"
                        title="Confirmed on a local chain, which has no public explorer"
                      >
                        {shortenHash(item.txHash ?? "")}
                      </span>
                    )
                  ) : (
                    <span className="rounded-full border border-critical/30 bg-critical/10 px-2 py-0.5 text-xs text-critical">
                      Failed
                    </span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
