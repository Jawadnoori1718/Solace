import { isDemoMode } from "@/lib/config";
import type { SystemHealth } from "@/lib/dashboard/queries";

/**
 * What is not working, said out loud.
 *
 * Solace's whole argument is that a system handling public money should be able
 * to say what it knows and what it does not. A dashboard that quietly shows
 * stale figures when the chain is unreachable fails that test far worse than
 * one that shows the figures and says where they came from.
 *
 * Renders nothing when everything is fine, so the ordinary case stays clean.
 */
export function HealthBanner({ health }: { health: SystemHealth }) {
  if (health.problems.length === 0) return null;

  // A ledger mismatch is a different order of problem from a node being down:
  // one means the figures may be wrong, the other means they are simply local.
  const severe = !health.ledgerAgrees;

  return (
    <section
      role="status"
      className={`rounded-lg border p-4 ${
        severe
          ? "border-critical/30 bg-critical/5"
          : "border-caution/30 bg-caution/5"
      }`}
    >
      <h2
        className={`text-sm font-semibold ${severe ? "text-critical" : "text-caution"}`}
      >
        {severe
          ? "The ledger and the chain disagree"
          : "Some parts of the system are unavailable"}
      </h2>

      <ul className="mt-2 space-y-1 text-sm text-ink-secondary">
        {health.problems.map((problem) => (
          <li key={problem}>{problem}</li>
        ))}
      </ul>

      {!health.chainReachable && isDemoMode && (
        <p className="mt-2 text-xs text-ink-muted">
          Demo mode settles on a local chain. Start it with{" "}
          <code className="rounded bg-sunken px-1.5 py-0.5">npm run chain</code>,
          then{" "}
          <code className="rounded bg-sunken px-1.5 py-0.5">
            npm run demo:prepare
          </code>
          .
        </p>
      )}
    </section>
  );
}

/**
 * Where the figures on this page came from.
 *
 * Shown when the chain confirms the local ledger, because "these two
 * independently computed numbers agree" is the strongest thing this interface
 * can say, and it should not be invisible just because it is good news.
 */
export function LedgerAgreement({ health }: { health: SystemHealth }) {
  if (health.onChainBalancePence === null || !health.ledgerAgrees) return null;

  return (
    <p className="mt-4 flex items-center gap-2 text-xs text-ink-muted">
      <span
        className="inline-block h-1.5 w-1.5 rounded-full bg-good"
        aria-hidden="true"
      />
      The balance above was computed from the database and independently read
      from the contract. The two agree.
    </p>
  );
}
