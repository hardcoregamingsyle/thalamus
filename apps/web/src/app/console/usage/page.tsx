"use client";

import { BarChart3 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { EmptyState } from "@/components/app/EmptyState";
import { Skeleton } from "@/components/app/Skeleton";
import { useMe } from "@/components/app/useMe";
import type { UsageRow } from "@/lib/types";

const DAYS = 30;
const CHART_HEIGHT = 160;

const METRICS = [
  { key: "requests", label: "Requests" },
  { key: "charsIn", label: "Characters in" },
  { key: "charsOut", label: "Characters out" },
] as const;
type MetricKey = (typeof METRICS)[number]["key"];
type DayTotals = { day: string; requests: number; charsIn: number; charsOut: number };

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

// 3–4 "nice" y-axis ticks (0, then even steps of 1/2/5 × a power of ten) up to
// a round number at or above the real maximum.
function niceTicks(max: number): number[] {
  if (max <= 0) return [0];
  const rough = max / 3;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const step = (normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1) * magnitude;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v));
  return ticks;
}

export default function UsagePage() {
  const { loading: meLoading } = useMe();
  const [rows, setRows] = useState<UsageRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [metric, setMetric] = useState<MetricKey>("charsOut");
  const [hover, setHover] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/usage?days=30");
      if (!res.ok) {
        setError("Couldn't load usage.");
        return;
      }
      const data = (await res.json()) as { days: UsageRow[] };
      setRows(data.days);
    } catch {
      setError("Couldn't reach Thalamus.");
    }
  }, []);

  useEffect(() => {
    if (!meLoading) void load();
  }, [meLoading, load]);

  const byDay = useMemo<DayTotals[]>(() => {
    const totals = new Map<string, DayTotals>();
    for (const row of rows ?? []) {
      const entry = totals.get(row.day) ?? { day: row.day, requests: 0, charsIn: 0, charsOut: 0 };
      entry.requests += row.requests;
      entry.charsIn += row.charsIn;
      entry.charsOut += row.charsOut;
      totals.set(row.day, entry);
    }
    return lastNDays(DAYS).map(
      (day) => totals.get(day) ?? { day, requests: 0, charsIn: 0, charsOut: 0 },
    );
  }, [rows]);

  const totals = useMemo(
    () =>
      byDay.reduce(
        (acc, d) => ({
          requests: acc.requests + d.requests,
          charsIn: acc.charsIn + d.charsIn,
          charsOut: acc.charsOut + d.charsOut,
        }),
        { requests: 0, charsIn: 0, charsOut: 0 },
      ),
    [byDay],
  );

  const hasUsage = rows !== null && totals.requests + totals.charsIn + totals.charsOut > 0;
  const max = Math.max(1, ...byDay.map((d) => d[metric]));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] ?? max;
  const hoveredDay = hover !== null ? byDay[hover] : undefined;

  if (meLoading || rows === null) {
    return (
      <div>
        <PageHeader title="Usage" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Usage" description="The last 30 days, across every API key." />

      {error ? (
        <p role="alert" className="mb-4 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {METRICS.map((m) => (
          <div key={m.key} className="rounded-2xl border border-border bg-surface p-4">
            <p className="text-xs font-medium uppercase tracking-[0.1em] text-fg-subtle">
              {m.label}
            </p>
            <p className="mt-1.5 text-2xl font-semibold tracking-tight text-fg">
              {totals[m.key].toLocaleString()}
            </p>
          </div>
        ))}
      </div>

      {!hasUsage ? (
        <EmptyState
          icon={BarChart3}
          message="No usage yet. It shows up here once you make a request."
        />
      ) : (
        <div className="rounded-2xl border border-border bg-surface p-5">
          <div
            role="tablist"
            aria-label="Metric"
            className="mb-6 inline-flex rounded-xl border border-border p-1"
          >
            {METRICS.map((m) => (
              <button
                key={m.key}
                type="button"
                role="tab"
                aria-selected={metric === m.key}
                onClick={() => setMetric(m.key)}
                className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
                  metric === m.key ? "bg-surface-strong text-fg" : "text-fg-muted hover:text-fg"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <div className="relative min-w-0">
            {hoveredDay ? (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-border-strong bg-bg-elevated px-2.5 py-1.5 text-xs shadow-lg"
                style={{ left: `${((hover ?? 0) + 0.5) * (100 / DAYS)}%` }}
              >
                <p className="font-medium text-fg">{formatDay(hoveredDay.day)}</p>
                <p className="text-fg-muted">{hoveredDay[metric].toLocaleString()}</p>
              </div>
            ) : null}

            <div className="flex gap-3">
              <div
                className="flex w-11 shrink-0 flex-col-reverse justify-between text-right text-[11px] text-fg-subtle"
                style={{ height: CHART_HEIGHT }}
              >
                {ticks.map((t) => (
                  <span key={t}>{t.toLocaleString()}</span>
                ))}
              </div>
              <svg
                viewBox={`0 0 ${DAYS * 10} ${CHART_HEIGHT}`}
                preserveAspectRatio="none"
                className="w-full min-w-0"
                style={{ height: CHART_HEIGHT }}
                role="img"
                aria-label={`${METRICS.find((m) => m.key === metric)?.label ?? "Usage"} per day, last ${DAYS} days`}
              >
                {ticks.map((t) => (
                  <line
                    key={t}
                    x1={0}
                    x2={DAYS * 10}
                    y1={CHART_HEIGHT - (t / top) * (CHART_HEIGHT - 4)}
                    y2={CHART_HEIGHT - (t / top) * (CHART_HEIGHT - 4)}
                    className="stroke-border"
                    strokeWidth={1}
                  />
                ))}
                {byDay.map((d, i) => {
                  const value = d[metric];
                  const barHeight = value > 0 ? Math.max((value / top) * (CHART_HEIGHT - 4), 2) : 0;
                  return (
                    <rect
                      key={d.day}
                      x={i * 10 + 1.5}
                      y={CHART_HEIGHT - barHeight}
                      width={7}
                      height={barHeight}
                      rx={1.5}
                      className={`transition-[fill,opacity] ${hover === i ? "fill-grad-2" : "fill-fg-subtle opacity-60"}`}
                      onMouseEnter={() => setHover(i)}
                      onMouseLeave={() => setHover((current) => (current === i ? null : current))}
                    />
                  );
                })}
              </svg>
            </div>
            <div className="ml-[calc(2.75rem+0.75rem)] mt-1.5 flex justify-between text-[11px] text-fg-subtle">
              <span>{formatDay(byDay[0]?.day ?? "")}</span>
              <span>{formatDay(byDay[byDay.length - 1]?.day ?? "")}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
