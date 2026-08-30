"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { formatPence, shortenHash } from "@/lib/format";

/**
 * A council commits money to the pot.
 *
 * Beat one. The amount is typed rather than fixed, because a councillor
 * deciding what to commit is the entire premise — and because a figure somebody
 * chose in the room is far more convincing than one baked into a script.
 *
 * The button submits a real transaction and waits for its receipt. What comes
 * back is a hash, and where the chain is public, a link to it.
 */
export function DepositControl({
  depositedPence,
}: {
  depositedPence: number;
}) {
  const router = useRouter();

  const [pounds, setPounds] = useState("400");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [result, setResult] = useState<{
    amountPence?: number;
    txHash?: string | null;
    explorerUrl?: string | null;
    error?: string | null;
  } | null>(null);

  async function deposit(): Promise<void> {
    const amountPence = Math.round(Number(pounds) * 100);

    if (!Number.isFinite(amountPence) || amountPence < 100) {
      setState("error");
      setResult({ error: "Enter an amount of at least £1." });
      return;
    }

    setState("sending");
    setResult(null);

    try {
      const response = await fetch("/api/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountPence }),
      });
      const data = (await response.json()) as {
        ok: boolean;
        amountPence?: number;
        txHash?: string | null;
        explorerUrl?: string | null;
        error?: string;
      };

      if (!data.ok) {
        setState("error");
        setResult({ error: data.error ?? "The deposit did not go through." });
        return;
      }

      setState("done");
      setResult(data);
      router.refresh();
    } catch (error) {
      setState("error");
      setResult({
        error:
          error instanceof Error
            ? error.message
            : "The deposit request could not be sent.",
      });
    }
  }

  const sending = state === "sending";

  return (
    <section className="overflow-hidden rounded-xl border border-hairline bg-surface shadow-[var(--shadow-card)]">
      <div className="border-b border-hairline px-6 py-5">
        <div className="mb-3 h-[3px] w-9 rounded-full bg-warmth" aria-hidden="true" />
        <h2 className="section-title text-xl text-body">Commit council money</h2>
        <p className="mt-1 text-xs text-body-muted">
          {depositedPence > 0
            ? `${formatPence(depositedPence)} committed so far. Adding more increases the pot.`
            : "The pot is empty. Committing money is the first thing that happens on chain."}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4 px-6 py-5">
        <div>
          <label
            htmlFor="deposit-amount"
            className="overline block"
          >
            Amount
          </label>
          <div className="mt-2 flex items-center gap-2">
            <span className="figure text-2xl text-body-muted" aria-hidden="true">
              £
            </span>
            <input
              id="deposit-amount"
              type="number"
              min="1"
              step="1"
              inputMode="decimal"
              value={pounds}
              onChange={(event) => setPounds(event.target.value)}
              disabled={sending}
              className="figure w-36 rounded-lg border border-edge bg-paper px-3 py-2 text-2xl text-body focus:border-money focus:outline-2 focus:outline-offset-1 focus:outline-money disabled:opacity-60"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={deposit}
          disabled={sending}
          className="rounded-lg bg-ink px-5 py-3 text-sm font-medium text-paper transition-colors hover:bg-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-money disabled:cursor-not-allowed disabled:bg-edge disabled:text-body-muted"
        >
          {sending ? "Confirming on chain…" : "Deposit into the pot"}
        </button>

        <div className="flex flex-wrap gap-2">
          {[250, 400, 1000].map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setPounds(String(preset))}
              disabled={sending}
              className="tabular rounded-full border border-hairline px-3 py-1 text-xs text-body-secondary transition-colors hover:border-edge hover:bg-sunken disabled:opacity-50"
            >
              £{preset}
            </button>
          ))}
        </div>
      </div>

      {state === "done" && result !== null && (
        <div className="border-t border-hairline bg-good/5 px-6 py-4">
          <p className="text-sm text-body">
            <span className="font-medium">
              {formatPence(result.amountPence ?? 0)}
            </span>{" "}
            committed and confirmed on chain.
          </p>
          {result.txHash != null && (
            <p className="mt-1.5 text-xs">
              {result.explorerUrl != null ? (
                <a
                  href={result.explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tabular font-medium text-money underline underline-offset-2 hover:text-body"
                >
                  {shortenHash(result.txHash, 10)} — view on the block explorer
                </a>
              ) : (
                <span className="tabular text-body-muted">
                  {result.txHash} — confirmed on a local chain, which has no
                  public explorer
                </span>
              )}
            </p>
          )}
        </div>
      )}

      {state === "error" && result?.error != null && (
        <p className="border-t border-hairline bg-critical/5 px-6 py-4 text-sm text-critical">
          {result.error}
        </p>
      )}
    </section>
  );
}
