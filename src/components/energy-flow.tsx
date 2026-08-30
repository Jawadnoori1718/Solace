import { formatKwh } from "@/lib/format";
import type { FlowGraph } from "@/lib/dashboard/queries";

/**
 * The whole pilot in one picture.
 *
 * Three roofs on the left, eight homes on the right, and the energy that moved
 * between them. Line thickness is the quantity delivered, so the shape of the
 * diagram is the shape of the decision — and a reader who takes nothing else
 * from this page can still see that surplus from three streets is reaching five
 * homes and not three others.
 *
 * The households that received nothing are drawn, dimmed, with their need score
 * and the reason. Leaving them out would make the picture cleaner and would
 * hide the single most contestable thing the engine does.
 *
 * Drawn as one SVG with an explicit viewBox rather than positioned HTML, so the
 * geometry is computed once and scales to any width without the labels and the
 * lines drifting apart.
 */

const WIDTH = 940;
const ROW_PITCH = 50;
const TOP = 34;

/** Where the lines start and finish. */
const EXPORT_X = 272;
const RECEIVE_X = 668;

/** Thinnest and thickest a flow line may be drawn. */
const MIN_STROKE = 1.5;
const MAX_STROKE = 15;

export function EnergyFlow({ graph }: { graph: FlowGraph }) {
  const { exporters, recipients, links } = graph;

  if (exporters.length === 0 || recipients.length === 0) {
    return null;
  }

  const height = TOP * 2 + (recipients.length - 1) * ROW_PITCH;

  const recipientY = new Map(
    recipients.map((node, index) => [node.reference, TOP + index * ROW_PITCH]),
  );

  // Exporters are spread across the same vertical span as the recipients, so
  // the fan of lines is symmetrical rather than crowded at one end.
  const exporterSpan = height - TOP * 2;
  const exporterY = new Map(
    exporters.map((node, index) => [
      node.reference,
      exporters.length === 1
        ? height / 2
        : TOP + (exporterSpan / (exporters.length - 1)) * index,
    ]),
  );

  const maxLink = Math.max(...links.map((link) => link.kwh), 1);
  const strokeFor = (kwh: number): number =>
    MIN_STROKE + (kwh / maxLink) * (MAX_STROKE - MIN_STROKE);

  return (
    <figure className="overflow-hidden rounded-xl border border-hairline bg-surface shadow-[var(--shadow-card)]">
      <figcaption className="border-b border-hairline px-6 py-5">
        <div className="mb-3 h-[3px] w-9 rounded-full bg-warmth" aria-hidden="true" />
        <h2 className="section-title text-xl text-body">
          Where the energy went
        </h2>
        <p className="mt-0.5 text-xs text-body-muted">
          Line thickness is the energy delivered. Households the engine assessed
          and declined are shown in grey, with the reason.
        </p>
      </figcaption>

      <div className="overflow-x-auto px-4 py-5">
        <svg
          viewBox={`0 0 ${WIDTH} ${height}`}
          width="100%"
          style={{ minWidth: 760, display: "block" }}
          role="img"
          aria-label={`Energy flows from ${exporters.length} exporting households to ${
            recipients.filter((r) => r.kwh > 0).length
          } recipient households, totalling ${formatKwh(graph.totalKwh)}`}
        >
          <defs>
            <linearGradient id="flow-line" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#e0891f" stopOpacity="0.28" />
              <stop offset="50%" stopColor="#d97706" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#b45309" stopOpacity="0.72" />
            </linearGradient>
          </defs>

          {/* The flows, thickest first so small ones stay visible on top. */}
          <g>
            {[...links]
              .sort((a, b) => b.kwh - a.kwh)
              .map((link) => {
                const y1 = exporterY.get(link.from);
                const y2 = recipientY.get(link.to);
                if (y1 === undefined || y2 === undefined) return null;

                const curve = (RECEIVE_X - EXPORT_X) * 0.46;
                const path = `M ${EXPORT_X} ${y1} C ${EXPORT_X + curve} ${y1}, ${RECEIVE_X - curve} ${y2}, ${RECEIVE_X} ${y2}`;

                return (
                  <g key={`${link.from}-${link.to}`}>
                    <path
                      d={path}
                      fill="none"
                      stroke="url(#flow-line)"
                      strokeWidth={strokeFor(link.kwh)}
                      strokeLinecap="round"
                    />
                    {/* A slow drift along the line, suggesting movement
                        without animating anything that carries meaning. */}
                    <path
                      d={path}
                      fill="none"
                      stroke="#fbbf5b"
                      strokeWidth={Math.max(1, strokeFor(link.kwh) * 0.28)}
                      strokeLinecap="round"
                      strokeDasharray="3 25"
                      opacity="0.55"
                      style={{ animation: "flow-drift 2.8s linear infinite" }}
                    />
                  </g>
                );
              })}
          </g>

          {/* Exporting households. */}
          {exporters.map((node) => {
            const y = exporterY.get(node.reference) ?? 0;

            return (
              <g key={node.reference}>
                <text
                  x={EXPORT_X - 26}
                  y={y - 4}
                  textAnchor="end"
                  fontSize="15"
                  fontWeight="600"
                  fill="var(--color-body)"
                >
                  {node.locality}
                </text>
                <text
                  x={EXPORT_X - 26}
                  y={y + 13}
                  textAnchor="end"
                  fontSize="11.5"
                  fill="var(--color-body-muted)"
                >
                  {node.capacityKw?.toFixed(1)} kW array
                  {" · "}
                  {formatKwh(node.kwh, 0)} given
                </text>

                <circle
                  cx={EXPORT_X}
                  cy={y}
                  r="8"
                  fill="var(--color-ink)"
                  stroke="var(--color-surface)"
                  strokeWidth="3"
                />
                <circle cx={EXPORT_X} cy={y} r="3" fill="var(--color-warmth-bright)" />
              </g>
            );
          })}

          {/* Recipient households, served and not. */}
          {recipients.map((node) => {
            const y = recipientY.get(node.reference) ?? 0;
            const served = node.kwh > 0;

            return (
              <g key={node.reference} opacity={served ? 1 : node.eligible === true ? 0.6 : 0.42}>
                <circle
                  cx={RECEIVE_X}
                  cy={y}
                  r={served ? 8 : 6}
                  fill={
                    served
                      ? "var(--color-warmth)"
                      : node.eligible === true
                        ? "var(--color-warmth)"
                        : "var(--color-edge)"
                  }
                  stroke="var(--color-surface)"
                  strokeWidth="3"
                />

                <text
                  x={RECEIVE_X + 24}
                  y={y - 4}
                  fontSize="15"
                  fontWeight={served ? "600" : "500"}
                  fill="var(--color-body)"
                >
                  {node.locality}
                </text>

                <text
                  x={RECEIVE_X + 24}
                  y={y + 13}
                  fontSize="11.5"
                  fill="var(--color-body-muted)"
                >
                  {served
                    ? `${formatKwh(node.kwh, 0)} · ${node.sharePercent}% of its bill`
                    : node.eligible === true
                      ? `need ${node.needScore?.toFixed(2) ?? "—"} · eligible, nothing allocated yet`
                      : `need ${node.needScore?.toFixed(2) ?? "—"} · below the threshold`}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-hairline bg-sunken/50 px-6 py-3 text-xs text-body-muted">
        <p>
          <span className="font-medium text-body">
            {formatKwh(graph.totalKwh)}
          </span>{" "}
          allocated across {links.length} exporter-to-household pairings.
        </p>
        <p>
          {graph.settledCount === graph.decisionCount
            ? "Every line is a settled transaction on a public ledger, not an estimate."
            : `${graph.settledCount.toLocaleString("en-GB")} of ${graph.decisionCount.toLocaleString("en-GB")} decisions have been settled on chain so far.`}
        </p>
      </div>
    </figure>
  );
}
