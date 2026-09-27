"use client";

import { useMemo, useState } from "react";
import type { UsageRow } from "@/lib/types";

const DAYS = 30;
const CHART_HEIGHT = 120;
const BAR_WIDTH = 8;
const BAR_GAP = 2;

function lastNDays(n: number): string[] {
  const days: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

function formatDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function UsageSection({ rows }: { rows: UsageRow[] }) {
  const [hovered, setHovered] = useState<string | null>(null);

  const byDay = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of rows) {
      totals.set(row.day, (totals.get(row.day) ?? 0) + row.requests);
    }
    return lastNDays(DAYS).map((day) => ({ day, requests: totals.get(day) ?? 0 }));
  }, [rows]);

  const max = Math.max(1, ...byDay.map((d) => d.requests));
  const width = DAYS * (BAR_WIDTH + BAR_GAP);
  const hoveredEntry = byDay.find((d) => d.day === hovered);

  return (
    <div className="mt-4">
      <div className="relative">
        <svg
          viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
          width={width}
          height={CHART_HEIGHT}
          role="img"
          aria-label={`Requests per day, last ${DAYS} days`}
        >
          <line
            x1={0}
            y1={CHART_HEIGHT - 0.5}
            x2={width}
            y2={CHART_HEIGHT - 0.5}
            stroke="var(--raw-border)"
            strokeWidth={1}
          />
          {byDay.map((d, i) => {
            const barHeight = Math.round((d.requests / max) * (CHART_HEIGHT - 8));
            const x = i * (BAR_WIDTH + BAR_GAP);
            const y = CHART_HEIGHT - barHeight;
            return (
              <rect
                key={d.day}
                x={x}
                y={y}
                width={BAR_WIDTH}
                height={Math.max(barHeight, 1)}
                rx={4}
                fill={hovered === d.day ? "var(--raw-accent)" : "var(--chart-bar)"}
                onMouseEnter={() => setHovered(d.day)}
                onMouseLeave={() => setHovered((current) => (current === d.day ? null : current))}
              />
            );
          })}
        </svg>
        <p className="mt-1 flex justify-between text-xs text-muted-foreground">
          <span>{formatDay(byDay[0]?.day ?? "")}</span>
          <span>{formatDay(byDay[byDay.length - 1]?.day ?? "")}</span>
        </p>
        {hoveredEntry ? (
          <p className="mt-1 text-sm">
            <strong>{formatDay(hoveredEntry.day)}</strong>: {hoveredEntry.requests} request
            {hoveredEntry.requests === 1 ? "" : "s"}
          </p>
        ) : null}
      </div>

      <table className="mt-6 w-full text-left text-sm">
        <caption className="sr-only">Usage by day and model, last {DAYS} days</caption>
        <thead className="text-muted-foreground">
          <tr className="border-b border-border">
            <th className="py-2 font-normal">Day</th>
            <th className="py-2 font-normal">Model</th>
            <th className="py-2 font-normal">Requests</th>
            <th className="py-2 font-normal">Chars in</th>
            <th className="py-2 font-normal">Chars out</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="py-4 text-muted-foreground">
                No usage yet.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={`${row.day}-${row.model}`} className="border-b border-border">
                <td className="py-2">{formatDay(row.day)}</td>
                <td className="py-2">{row.model}</td>
                <td className="py-2">{row.requests}</td>
                <td className="py-2">{row.charsIn}</td>
                <td className="py-2">{row.charsOut}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
