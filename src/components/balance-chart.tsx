"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatKwh, formatPence } from "@/lib/format";
import type { BalancePoint } from "@/lib/dashboard/queries";

/**
 * The pot draining, day by day.
 *
 * One measure on one axis. Delivered energy appears in the tooltip as context
 * but never as a second series — two scales on one chart is the fastest way to
 * make a figure that looks informative and cannot be read.
 *
 * A single series needs no legend; the heading names it. The marks are thin,
 * the grid is recessive, and every piece of text wears an ink colour rather
 * than the series colour.
 */
export function BalanceChart({ series }: { series: BalancePoint[] }) {
  if (series.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-body-muted">
        Nothing has been settled yet, so there is no balance to plot.
      </p>
    );
  }

  const opening = series[0].balancePence + series[0].spentPence;

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={series}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
        >
          <defs>
            <linearGradient id="balanceFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-money)" stopOpacity={0.16} />
              <stop offset="100%" stopColor="var(--color-money)" stopOpacity={0.01} />
            </linearGradient>
          </defs>

          <CartesianGrid
            stroke="var(--color-hairline)"
            strokeDasharray="0"
            vertical={false}
          />

          <XAxis
            dataKey="date"
            tickFormatter={shortDate}
            tick={{ fill: "var(--color-body-muted)", fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "var(--color-hairline)" }}
            minTickGap={28}
          />

          <YAxis
            domain={[0, opening]}
            tickFormatter={(pence: number) => `£${Math.round(pence / 100)}`}
            tick={{ fill: "var(--color-body-muted)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={46}
          />

          <Tooltip
            content={<BalanceTooltip />}
            cursor={{ stroke: "var(--color-edge)", strokeWidth: 1 }}
          />

          <Area
            type="monotone"
            dataKey="balancePence"
            stroke="var(--color-money)"
            strokeWidth={2}
            fill="url(#balanceFill)"
            // A dot on every one of thirty points is noise; the hover layer is
            // what lets a reader interrogate an individual day.
            dot={false}
            activeDot={{
              r: 4,
              fill: "var(--color-money)",
              stroke: "var(--color-surface)",
              strokeWidth: 2,
            }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

interface TooltipPayload {
  payload: BalancePoint;
}

function BalanceTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
}) {
  if (active !== true || payload === undefined || payload.length === 0) {
    return null;
  }

  const point = payload[0].payload;

  return (
    <div className="rounded-md border border-hairline bg-surface px-3 py-2 shadow-lg">
      <p className="text-xs font-medium text-body">{longDate(point.date)}</p>
      <dl className="mt-1.5 space-y-0.5 text-xs">
        <Row label="Remaining" value={formatPence(point.balancePence)} strong />
        <Row label="Spent that day" value={formatPence(point.spentPence)} />
        <Row label="Delivered" value={formatKwh(point.deliveredKwh)} />
      </dl>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <dt className="text-body-muted">{label}</dt>
      <dd
        className={`tabular ${strong === true ? "font-semibold text-body" : "text-body-secondary"}`}
      >
        {value}
      </dd>
    </div>
  );
}

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}
