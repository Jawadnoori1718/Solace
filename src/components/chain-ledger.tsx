import { formatKwh, formatPence, shortenHash } from "@/lib/format";
import type { ChainLedger } from "@/lib/dashboard/queries";

/**
 * What the chain itself says, read straight from the contract.
 *
 * Every figure in this panel comes from contract storage. Nothing in it is
 * computed by this application. That is the point: a councillor can compare
 * what the dashboard claims against what an independent system says, and the
 * two are produced by entirely different means.
 *
 * It also makes the privacy model concrete rather than a paragraph in a
 * README. The chain holds a list of hashes and amounts. The locality beside
 * each hash is resolved on this server, using the salt, and is shown here
 * precisely to demonstrate what an outsider would not be able to do.
 */
export function ChainLedgerPanel({ ledger }: { ledger: ChainLedger | null }) {
  if (ledger === null) {
    return (
      <section className="rounded-xl border border-hairline bg-surface px-6 py-5 shadow-[var(--shadow-card)]">
        <div className="mb-3 h-[3px] w-9 rounded-full bg-warmth" aria-hidden="true" />
        <h2 className="section-title text-xl text-body">On the chain</h2>
        <p className="mt-2 text-sm text-body-muted">
          The contract could not be read. The figures elsewhere on this page come
          from the local ledger.
        </p>
      </section>
    );
  }

  const isPublic = ledger.explorerUrl !== null;

  return (
    <section className="overflow-hidden rounded-xl border border-hairline bg-surface shadow-[var(--shadow-card)]">
      <div className="border-b border-hairline px-6 py-5">
        <div className="mb-3 h-[3px] w-9 rounded-full bg-warmth" aria-hidden="true" />
        <h2 className="section-title text-xl text-body">On the chain</h2>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-body-muted">
          Every figure below was read from the contract, not from this
          application&rsquo;s own database. If the two ever disagreed, this is
          the column that would be right.
        </p>
      </div>

      {/* What the token actually is. */}
      <div className="border-b border-hairline bg-sunken/40 px-6 py-4">
        <p className="text-sm leading-relaxed text-body-secondary">
          <span className="font-medium text-body">
            {ledger.tokenName} ({ledger.tokenSymbol})
          </span>{" "}
          is a token with {ledger.decimals} decimal places, so{" "}
          <span className="font-medium text-body">one unit is one pound</span>{" "}
          and the smallest amount it can express is one penny. There are{" "}
          <span className="tabular font-medium text-body">
            {formatPence(ledger.totalSupplyPence)}
          </span>{" "}
          of it in existence, which is exactly what the council has committed —
          the token is created when money goes into a pot and it is the council
          that holds it.
        </p>
      </div>

      <dl className="grid gap-px bg-hairline sm:grid-cols-3">
        <Figure
          label="Committed to this pot"
          value={formatPence(ledger.potFundedPence)}
          note="recorded against the pot on chain"
        />
        <Figure
          label="Spent on energy"
          value={formatPence(ledger.potSpentPence)}
          note={`${ledger.settlementCount} settlements`}
          tone="warmth"
        />
        <Figure
          label="Still in the pot"
          value={formatPence(ledger.potRemainingPence)}
          note="the contract refuses to spend past this"
        />
      </dl>

      {/* The privacy model, made concrete. */}
      <div className="border-t border-hairline px-6 py-5">
        <p className="overline mb-1">Who the chain says received energy</p>
        <p className="mb-4 max-w-2xl text-xs leading-relaxed text-body-muted">
          The chain holds the left-hand column and nothing else. The right-hand
          column exists on this server, and only because it holds the salt. To
          anybody reading the chain — including us, without that salt — these are
          opaque values.
        </p>

        {ledger.credits.length === 0 ? (
          <p className="text-sm text-body-muted">
            Nothing has been settled yet, so the chain records no recipients.
          </p>
        ) : (
          <ul className="space-y-2">
            {ledger.credits.map((credit) => (
              <li
                key={credit.hash}
                className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-lg border border-hairline px-4 py-2.5"
              >
                <span className="flex items-center gap-3">
                  <span
                    className="tabular rounded bg-sunken px-2 py-1 text-xs text-body-secondary"
                    title={credit.hash}
                  >
                    {shortenHash(credit.hash, 14)}
                  </span>
                  <span className="text-xs text-body-muted">
                    resolves locally to{" "}
                    <span className="font-medium text-body-secondary">
                      {credit.locality}
                    </span>
                  </span>
                </span>

                <span className="flex items-baseline gap-5">
                  <span className="tabular text-sm font-semibold text-warmth">
                    {formatKwh(credit.kwh)}
                  </span>
                  <span className="tabular text-sm font-semibold text-body">
                    {formatPence(credit.pencePaid)}
                  </span>
                  <span className="tabular w-20 text-right text-xs text-body-muted">
                    {credit.settlements}{" "}
                    {credit.settlements === 1 ? "payment" : "payments"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-hairline bg-sunken/40 px-6 py-3 text-xs text-body-muted">
        <p>
          Contract{" "}
          {isPublic ? (
            <a
              href={ledger.explorerUrl ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="tabular font-medium text-money underline underline-offset-2 hover:text-body"
            >
              {shortenHash(ledger.contractAddress, 10)} ↗
            </a>
          ) : (
            <span className="tabular">
              {shortenHash(ledger.contractAddress, 10)}
            </span>
          )}
        </p>
        <p>
          {isPublic
            ? "Anyone can read these same figures from the public chain."
            : "A local chain, so these figures are real but not public. Live mode settles on Base Sepolia."}
        </p>
      </div>
    </section>
  );
}

function Figure({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone?: "warmth";
}) {
  return (
    <div className="bg-surface px-6 py-4">
      <dt className="overline">{label}</dt>
      <dd
        className={`figure mt-1.5 text-2xl font-semibold ${
          tone === "warmth" ? "text-warmth" : "text-body"
        }`}
      >
        {value}
      </dd>
      <p className="mt-1 text-xs text-body-muted">{note}</p>
    </div>
  );
}
