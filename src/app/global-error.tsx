"use client";

/**
 * Solace — the last line of defence.
 *
 * Replaces the root layout when the layout itself fails, so it renders its own
 * document and cannot rely on the application's stylesheet or fonts. Everything
 * here is inline for that reason, and it is deliberately plain: if this is on
 * screen, the priority is telling someone what is and is not true, not looking
 * good while doing it.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en-GB">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#faf8f4",
          color: "#10233a",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
        }}
      >
        <title>Solace — something went wrong</title>

        <main style={{ maxWidth: "34rem", padding: "2rem" }}>
          <p
            style={{
              margin: 0,
              fontSize: "0.6875rem",
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "#74818e",
            }}
          >
            Solace
          </p>

          <h1
            style={{
              margin: "0.5rem 0 0",
              fontSize: "1.75rem",
              fontWeight: 600,
              letterSpacing: "-0.02em",
            }}
          >
            The application could not start
          </h1>

          <p style={{ marginTop: "0.75rem", lineHeight: 1.6, color: "#4f5f6f" }}>
            Nothing has been spent or changed. The ledger and the chain are
            exactly as they were.
          </p>

          <button
            type="button"
            onClick={retry}
            style={{
              marginTop: "1.5rem",
              padding: "0.5rem 1rem",
              borderRadius: "0.375rem",
              border: "none",
              background: "#10233a",
              color: "#faf8f4",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>

          {error.digest !== undefined && (
            <p
              style={{
                marginTop: "2rem",
                fontSize: "0.75rem",
                color: "#74818e",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              Digest {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
