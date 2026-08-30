/**
 * Solace — the identity.
 *
 * The mark is a sun rising over a roofline: warmth reaching shelter. Those are
 * the only two things this project is about, and they are the only two shapes
 * in it.
 *
 * It is deliberately not heraldic. Nothing here echoes a portcullis, a crown or
 * any parliamentary or royal device — borrowing that authority would be both
 * inappropriate and, for a project whose entire argument is about being honest
 * with public money, exactly the wrong note.
 *
 * The mark reduces to two elements so it survives a 16-pixel favicon. Rays are
 * drawn only at larger sizes, where they have room to read.
 */

export function SolaceMark({
  size = 32,
  withRays = false,
  className,
}: {
  size?: number;
  withRays?: boolean;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Solace"
    >
      <defs>
        <linearGradient id="solace-ground" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#12314c" />
          <stop offset="100%" stopColor="#071624" />
        </linearGradient>

        <linearGradient id="solace-sun" x1="0.5" y1="0" x2="0.5" y2="1">
          <stop offset="0%" stopColor="#f7b955" />
          <stop offset="55%" stopColor="#e0891f" />
          <stop offset="100%" stopColor="#b45309" />
        </linearGradient>

        {/* A soft warmth behind the sun, so it sits in the ground rather than
            on top of it. */}
        <radialGradient id="solace-glow" cx="0.5" cy="0.42" r="0.5">
          <stop offset="0%" stopColor="#f7b955" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#f7b955" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width="32" height="32" rx="7.5" fill="url(#solace-ground)" />

      {/* The warmth. */}
      <circle cx="16" cy="12.3" r="10" fill="url(#solace-glow)" />

      {withRays && (
        <g
          stroke="#e0891f"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity="0.75"
        >
          <path d="M16 3.2v2.1" />
          <path d="M7.9 6.6l1.5 1.5" />
          <path d="M24.1 6.6l-1.5 1.5" />
        </g>
      )}

      {/* The sun. */}
      <circle cx="16" cy="12.3" r="5.1" fill="url(#solace-sun)" />

      {/* The roofline. Drawn over the sun, so the home is what the eye
          resolves first and the warmth is what it resolves second. */}
      <path
        d="M6.4 24.9 L16 16.5 L25.6 24.9"
        stroke="#fbf9f5"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

/**
 * The full lock-up: mark, wordmark, and an optional line of positioning.
 *
 * The wordmark is set in the display serif because that is what the figures on
 * this page are set in, and an identity that does not share a typeface with its
 * own content always looks applied rather than designed.
 */
export function SolaceLogo({
  size = 34,
  tone = "ink",
  showTagline = false,
}: {
  size?: number;
  /** `ink` for the dark band, `paper` for a light surface. */
  tone?: "ink" | "paper";
  showTagline?: boolean;
}) {
  const wordmarkColour = tone === "ink" ? "text-on-ink" : "text-body";
  const taglineColour =
    tone === "ink" ? "text-on-ink-muted" : "text-body-muted";

  return (
    <div className="flex items-center gap-3">
      <SolaceMark size={size} />

      <div className="leading-none">
        <span
          className={`font-display block text-[1.35rem] font-semibold tracking-[-0.02em] ${wordmarkColour}`}
        >
          Solace
        </span>

        {showTagline && (
          <span
            className={`mt-1 block text-[0.6875rem] font-medium tracking-[0.1em] uppercase ${taglineColour}`}
          >
            Fuel poverty, accounted for
          </span>
        )}
      </div>
    </div>
  );
}
