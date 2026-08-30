"use client";

import { useCallback, useEffect, useState } from "react";

import { formatKwh } from "@/lib/format";
import type { LiveExport } from "@/lib/dashboard/queries";

/**
 * What the three roofs are exporting right now.
 *
 * Beat two. Polls every fifteen seconds, so the figure moves as the half-hour
 * turns over and the page is visibly alive rather than a snapshot.
 *
 * The reading is the real seeded value for the actual current half-hour. After
 * sunset it is zero, and the panel says so and shows the day's peak instead of
 * pretending. A dashboard that manufactures daylight to look impressive has
 * given up the only thing this project is arguing for.
 */
export function LiveExport({ initial }: { initial: LiveExport | null }) {
  const [live, setLive] = useState<LiveExport | null>(initial);
  const [pulse, setPulse] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/export-now", { cache: "no-store" });
      const data = (await response.json()) as { ok: boolean } & LiveExport;
      if (data.ok) {
        setLive(data);
        setPulse((value) => value + 1);
      }
    } catch {
      // A failed poll keeps the previous reading on screen. A blank panel
      // would be a worse answer than a slightly stale one.
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(refresh, 15_000);
    return () => clearInterval(timer);
  }, [refresh]);

  if (live === null) {
    return null;
  }

  const peakKwh = Math.max(
    0.001,
    ...live.exporters.flatMap((exporter) => exporter.series),
  );

  return (
    <section className="overflow-hidden rounded-xl border border-hairline bg-surface shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-hairline px-6 py-5">
        <div>
          <div className="mb-3 h-[3px] w-9 rounded-full bg-warmth" aria-hidden="true" />
          <h2 className="section-title text-xl text-body">
            Exporting right now
          </h2>
          <p className="mt-1 text-xs text-body-muted">
            Three rooftop arrays, read every half hour.{" "}
            <span className="text-body-secondary">
              {live.showingPreviousDay
                ? `Showing ${dateLabel(live.dataDate)}, the most recent day that produced`
                : `${timeLabel(live.periodIndex)} on ${dateLabel(live.dataDate)}`}
            </span>
          </p>
        </div>

        <div className="text-right">
          <p className="overline">
            {live.afterDark ? "Peak that day" : "Surplus available now"}
          </p>
          <p
            key={pulse}
            className="figure mt-1 text-3xl font-semibold text-warmth"
          >
            {live.afterDark
              ? formatKwh(live.peakToday?.kwh ?? 0, 2)
              : formatKwh(live.surplusNowKwh, 2)}
          </p>
          <p className="mt-1 text-xs text-body-muted">
            {formatKwh(live.surplusTodayKwh, 1)} total{" "}
            {live.showingPreviousDay ? "across that day" : "so far today"}
          </p>
        </div>
      </div>

      {live.afterDark && (
        <p className="border-b border-hairline bg-sunken/50 px-6 py-3 text-xs text-body-secondary">
          {live.showingPreviousDay
            ? "Nothing has been generated yet today — it is still dark. The curves below are the most recent full day"
            : "Nothing is being exported at this moment — the sun is down. The curves below are today's real readings"}
          {live.peakToday !== null && (
            <>
              , which peaked at{" "}
              <span className="tabular font-medium text-body">
                {formatKwh(live.peakToday.kwh, 2)}
              </span>{" "}
              around {timeLabel(live.peakToday.periodIndex)}
            </>
          )}
          .
        </p>
      )}

      <div className="grid gap-px bg-hairline sm:grid-cols-3">
        {live.exporters.map((exporter) => (
          <div key={exporter.reference} className="bg-surface px-6 py-5">
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-medium text-body">{exporter.locality}</p>
              <p className="tabular text-xs text-body-muted">
                {exporter.capacityKw.toFixed(1)} kW
              </p>
            </div>

            <p className="figure mt-2 text-2xl font-semibold text-body">
              {exporter.nowKwh > 0 ? (
                <>
                  {exporter.nowKwh.toFixed(2)}
                  <span className="ml-1 text-sm font-normal text-body-muted">
                    kWh this half hour
                  </span>
                </>
              ) : (
                <span className="text-lg font-normal text-body-muted">
                  Not exporting
                </span>
              )}
            </p>

            <DaySparkline
              series={exporter.series}
              periodIndex={live.periodIndex}
              peak={peakKwh}
            />

            <p className="mt-2 text-xs text-body-muted">
              <span className="tabular font-medium text-warmth">
                {formatKwh(exporter.todayKwh, 1)}
              </span>{" "}
              {live.showingPreviousDay ? "exported that day" : "exported today"}
            </p>
          </div>
        ))}
      </div>

      <p className="border-t border-hairline bg-sunken/50 px-6 py-3 text-xs text-body-muted">
        Meter data simulated. Integration path: DCC and supplier APIs. The
        figures update as the half hour turns over; nothing here is looped or
        replayed to manufacture daylight.
      </p>
    </section>
  );
}

/**
 * Today's export curve for one household, with the current half-hour marked.
 *
 * Deliberately unlabelled. Its job is to show the shape of a day at a glance
 * beside a figure that carries the precision; axes here would be clutter.
 */
function DaySparkline({
  series,
  periodIndex,
  peak,
}: {
  series: number[];
  periodIndex: number;
  peak: number;
}) {
  const width = 240;
  const height = 40;

  const x = (index: number): number => (index / 47) * width;
  const y = (kwh: number): number => height - (kwh / peak) * (height - 4) - 2;

  const line = series
    .map((kwh, index) => `${index === 0 ? "M" : "L"} ${x(index).toFixed(1)} ${y(kwh).toFixed(1)}`)
    .join(" ");

  const area = `${line} L ${width} ${height} L 0 ${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      className="mt-3 block"
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      <path d={area} fill="var(--color-warmth)" opacity="0.12" />
      <path
        d={line}
        fill="none"
        stroke="var(--color-warmth)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />

      {/* Where we are in the day. */}
      <line
        x1={x(periodIndex)}
        y1="0"
        x2={x(periodIndex)}
        y2={height}
        stroke="var(--color-body)"
        strokeWidth="1"
        opacity="0.35"
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={x(periodIndex)}
        cy={y(series[periodIndex] ?? 0)}
        r="3"
        fill="var(--color-warmth)"
        stroke="var(--color-surface)"
        strokeWidth="1.5"
      />
    </svg>
  );
}

/** "14:30" from a half-hourly period index. */
function timeLabel(periodIndex: number): string {
  const hours = Math.floor(periodIndex / 2);
  const minutes = periodIndex % 2 === 0 ? "00" : "30";
  return `${String(hours).padStart(2, "0")}:${minutes}`;
}

function dateLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}
