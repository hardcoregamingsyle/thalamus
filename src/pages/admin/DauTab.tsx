// DAU tab — daily active-user counts and trend chart.
// Drives api.admin.getDauStats and api.admin.getTodayDau.

import { useState } from "react";
import { motion } from "framer-motion";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Activity, TrendingUp, Users, Loader2 } from "lucide-react";

export function DauTab({ adminToken }: { adminToken: string }) {
  const [days, setDays] = useState(30);
  const dauStats = useQuery(api.admin.getDauStats, { adminToken, days });
  const todayDau = useQuery(api.admin.getTodayDau, { adminToken });

  const maxDau = dauStats ? Math.max(...dauStats.map((d: { date: string; dau: number }) => d.dau), 1) : 1;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-foreground">Daily Active Users (DAU)</h2>
        <p className="text-sm text-muted-foreground">Real-time tracking of unique active users per day</p>
      </div>

      {/* Today's DAU card */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-card border border-primary/40 rounded-xl p-6 shadow-lg"
      >
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-primary/20 border border-primary/40 flex items-center justify-center">
            <Activity className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-xs font-bold text-muted-foreground">TODAY'S DAU</p>
            <p className="text-xs text-muted-foreground">{new Date().toLocaleDateString()}</p>
          </div>
        </div>
        <p className="text-5xl font-bold text-primary">
          {todayDau !== undefined ? todayDau.toLocaleString() : <Loader2 className="h-10 w-10 animate-spin text-muted-foreground inline-block" />}
        </p>
        <p className="text-xs text-muted-foreground mt-2">Unique users active today</p>
      </motion.div>

      {/* Time range selector */}
      <div className="flex items-center gap-2">
        <p className="text-xs font-bold text-muted-foreground">TIME RANGE:</p>
        {[7, 14, 30, 60, 90].map(d => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`px-3 py-1.5 text-xs rounded-lg transition-all ${
              days === d
                ? "bg-primary/15 text-primary border border-primary/30 font-bold"
                : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {d} days
          </button>
        ))}
      </div>

      {/* DAU chart */}
      {!dauStats ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-foreground">DAU Trend</h3>
            <div className="flex items-center gap-4 text-xs">
              <div className="flex items-center gap-1.5">
                <TrendingUp className="h-3 w-3 text-emerald-400" />
                <span className="text-muted-foreground">Peak:</span>
                <span className="font-bold text-emerald-400">{maxDau.toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Activity className="h-3 w-3 text-primary" />
                <span className="text-muted-foreground">Avg:</span>
                <span className="font-bold text-primary">
                  {dauStats.length > 0 ? Math.round(dauStats.reduce((sum: number, d: { date: string; dau: number }) => sum + d.dau, 0) / dauStats.length).toLocaleString() : 0}
                </span>
              </div>
            </div>
          </div>

          {/* Bar chart */}
          <div className="space-y-1">
            {dauStats.map((stat: { date: string; dau: number }, idx: number) => {
              const pct = maxDau > 0 ? (stat.dau / maxDau) * 100 : 0;
              const isToday = stat.date === new Date().toISOString().slice(0, 10);
              const dateObj = new Date(stat.date + "T00:00:00Z");
              const dateLabel = dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" });

              return (
                <motion.div
                  key={stat.date}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.01 }}
                  className="flex items-center gap-3"
                >
                  <div className="w-16 text-[10px] text-muted-foreground text-right shrink-0">
                    {dateLabel}
                  </div>
                  <div className="flex-1 relative">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.5, delay: idx * 0.01 }}
                      className={`h-8 rounded-lg flex items-center justify-end px-2 ${
                        isToday
                          ? "bg-primary/20 border border-primary/40"
                          : pct > 70
                          ? "bg-emerald-400/20 border border-emerald-400/30"
                          : pct > 40
                          ? "bg-blue-400/20 border border-blue-400/30"
                          : "bg-muted/60 border border-border"
                      }`}
                    >
                      <span className={`text-xs font-bold ${
                        isToday ? "text-primary" : pct > 40 ? "text-foreground" : "text-muted-foreground"
                      }`}>
                        {stat.dau}
                      </span>
                    </motion.div>
                  </div>
                  {isToday && (
                    <span className="text-[10px] bg-primary/15 text-primary border border-primary/30 px-1.5 py-0.5 rounded-full font-bold shrink-0">
                      TODAY
                    </span>
                  )}
                </motion.div>
              );
            })}
          </div>

          {dauStats.length === 0 && (
            <p className="text-center text-muted-foreground py-12 text-sm">No DAU data available</p>
          )}
        </div>
      )}

      {/* Stats summary */}
      {dauStats && dauStats.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="h-4 w-4 text-emerald-400" />
              <p className="text-xs font-bold text-muted-foreground">PEAK DAU</p>
            </div>
            <p className="text-2xl font-bold text-emerald-400">{maxDau.toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground mt-1">Highest in selected period</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="h-4 w-4 text-primary" />
              <p className="text-xs font-bold text-muted-foreground">AVERAGE DAU</p>
            </div>
            <p className="text-2xl font-bold text-primary">
              {Math.round(dauStats.reduce((sum: number, d: { date: string; dau: number }) => sum + d.dau, 0) / dauStats.length).toLocaleString()}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">Mean across {days} days</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <Users className="h-4 w-4 text-blue-400" />
              <p className="text-xs font-bold text-muted-foreground">TOTAL DAYS</p>
            </div>
            <p className="text-2xl font-bold text-blue-400">{dauStats.length.toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground mt-1">Days with activity tracked</p>
          </div>
        </div>
      )}
    </div>
  );
}
