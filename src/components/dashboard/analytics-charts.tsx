"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { DashboardMetrics } from "@/types/dashboard";
import { ArrowUpRight, TrendingUp, CheckCircle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface AnalyticsChartsProps {
  metrics: DashboardMetrics;
}

export function AnalyticsCharts({ metrics }: AnalyticsChartsProps) {
  const router = useRouter();
  const [period, setPeriod] = useState<"weekly" | "monthly">("weekly");

  const onPieClick = (data: any) => {
    if (data && data.status) {
      const statusKey = data.status.toLowerCase().replace(/\s+/g, "_");
      router.push(`/applications?status=${statusKey}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* 3 Progressive Telemetry Conversion Intelligence Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Employer Response Rate */}
        <div className="orbital-card rounded-xl p-4 space-y-3 relative overflow-hidden border-l-2 border-l-cyan-400">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-semibold text-muted-foreground uppercase tracking-wider">
              Employer Response Rate
            </span>
            <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
              {metrics.recruiterResponses} replies
            </span>
          </div>

          <div className="flex items-baseline justify-between">
            <h4 className="text-3xl font-mono font-bold tracking-tight text-foreground tabular-nums">
              {metrics.responseRate}%
            </h4>
            <span className="text-[11px] font-mono text-muted-foreground">Target: &gt;15%</span>
          </div>

          {/* Progressive Telemetry Bar */}
          <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full transition-all duration-500 shadow-[0_0_8px_#38bdf8]"
              style={{ width: `${Math.min(100, metrics.responseRate || 16)}%` }}
            />
          </div>
        </div>

        {/* Interview Conversion Rate */}
        <div className="orbital-card rounded-xl p-4 space-y-3 relative overflow-hidden border-l-2 border-l-amber-400">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-semibold text-muted-foreground uppercase tracking-wider">
              Interview Conversion Rate
            </span>
            <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30">
              {metrics.interviews} interviews
            </span>
          </div>

          <div className="flex items-baseline justify-between">
            <h4 className="text-3xl font-mono font-bold tracking-tight text-foreground tabular-nums">
              {metrics.interviewConversionRate}%
            </h4>
            <span className="text-[11px] font-mono text-muted-foreground">Screen & Tech</span>
          </div>

          {/* Progressive Telemetry Bar */}
          <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-amber-500 to-amber-300 rounded-full transition-all duration-500 shadow-[0_0_8px_#f59e0b]"
              style={{ width: `${Math.max(2, Math.min(100, metrics.interviewConversionRate || 1))}%` }}
            />
          </div>
        </div>

        {/* Rejection Rate */}
        <div className="orbital-card rounded-xl p-4 space-y-3 relative overflow-hidden border-l-2 border-l-rose-400">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-semibold text-muted-foreground uppercase tracking-wider">
              Rejection Rate
            </span>
            <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/30">
              {metrics.rejected} closed
            </span>
          </div>

          <div className="flex items-baseline justify-between">
            <h4 className="text-3xl font-mono font-bold tracking-tight text-foreground tabular-nums">
              {metrics.rejectionRate}%
            </h4>
            <span className="text-[11px] font-mono text-muted-foreground">Normal: 15-20%</span>
          </div>

          {/* Progressive Telemetry Bar */}
          <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-rose-600 to-rose-400 rounded-full transition-all duration-500 shadow-[0_0_8px_#f43f5e]"
              style={{ width: `${Math.min(100, metrics.rejectionRate || 15)}%` }}
            />
          </div>
        </div>
      </div>

      {/* 12-Column Bento Analytics Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Application & Response Volume Area Chart (8 Columns) */}
        <div className="lg:col-span-8 orbital-card rounded-xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border/60">
            <div>
              <h3 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-cyan-400" />
                Application & Response Volume
              </h3>
              <p className="text-xs text-muted-foreground font-mono mt-0.5">
                Submission cadence synchronized with recruiter response events
              </p>
            </div>

            {/* Segmented Pill Toggle */}
            <div className="flex items-center gap-1 bg-slate-900/90 p-1 rounded-lg border border-border/80 self-start sm:self-auto">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPeriod("weekly")}
                className={cn(
                  "h-6 px-2.5 text-xs font-mono rounded-md transition-all",
                  period === "weekly"
                    ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shadow-xs font-bold"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Weekly
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPeriod("monthly")}
                className={cn(
                  "h-6 px-2.5 text-xs font-mono rounded-md transition-all",
                  period === "monthly"
                    ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shadow-xs font-bold"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Monthly
              </Button>
            </div>
          </div>

          <div className="h-72 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={metrics.trendsByPeriod}
                margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="appliedGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="responsesGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148, 163, 184, 0.12)" />
                <XAxis
                  dataKey="period"
                  stroke="#94a3b8"
                  fontSize={11}
                  tickLine={false}
                  fontFamily="monospace"
                />
                <YAxis
                  stroke="#94a3b8"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  fontFamily="monospace"
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "rgba(15, 23, 42, 0.92)",
                    backdropFilter: "blur(12px)",
                    borderColor: "rgba(56, 189, 248, 0.3)",
                    borderRadius: "8px",
                    fontSize: "12px",
                    fontFamily: "monospace",
                    color: "#f8fafc",
                    boxShadow: "0 8px 30px rgba(0, 0, 0, 0.5)",
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: "11px", fontFamily: "monospace", paddingTop: "12px" }}
                />
                <Area
                  type="monotone"
                  dataKey="applied"
                  name="Applications Sent"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#appliedGradient)"
                />
                <Area
                  type="monotone"
                  dataKey="responses"
                  name="Employer Responses"
                  stroke="#06b6d4"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#responsesGradient)"
                />
                <Area
                  type="monotone"
                  dataKey="interviews"
                  name="Interviews"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  fill="#f59e0b"
                  fillOpacity={0.12}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Status Distribution Hollow Ring Chart with Centered Monospace Counter (4 Columns) */}
        <div className="lg:col-span-4 orbital-card rounded-xl p-5 space-y-4">
          <div className="pb-3 border-b border-border/60">
            <h3 className="text-sm font-semibold tracking-tight text-foreground">
              Status Distribution
            </h3>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">
              Click ring segment to filter application table
            </p>
          </div>

          <div className="relative h-60 w-full flex items-center justify-center">
            {/* Center Monospace Counter */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none z-10">
              <span className="font-mono text-3xl font-bold tracking-tight text-foreground tabular-nums drop-shadow-[0_0_10px_rgba(56,189,248,0.3)]">
                {metrics.totalApplications}
              </span>
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                Total Apps
              </span>
            </div>

            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={metrics.statusDistribution}
                  dataKey="count"
                  nameKey="status"
                  cx="50%"
                  cy="50%"
                  innerRadius={65}
                  outerRadius={88}
                  paddingAngle={3}
                  onClick={onPieClick}
                  cursor="pointer"
                  stroke="#050811"
                  strokeWidth={2}
                >
                  {metrics.statusDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: "rgba(15, 23, 42, 0.95)",
                    borderColor: "rgba(56, 189, 248, 0.3)",
                    borderRadius: "8px",
                    fontSize: "12px",
                    fontFamily: "monospace",
                  }}
                  formatter={(value: any) => [`${value} applications`, "Count"]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Legend Grid */}
          <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-border/60">
            {metrics.statusDistribution.map((item) => (
              <div
                key={item.status}
                onClick={() => onPieClick(item)}
                className="flex items-center gap-1.5 cursor-pointer p-1 rounded hover:bg-slate-800/60 transition-colors group"
              >
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                <span className="text-muted-foreground group-hover:text-foreground truncate text-[11px] font-mono">
                  {item.status}
                </span>
                <span className="font-mono font-bold text-foreground ml-auto tabular-nums text-[11px]">
                  {item.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Secondary Analytics: Top Companies & Classification Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="orbital-card rounded-xl p-5 space-y-4">
          <div className="pb-3 border-b border-border/60">
            <h3 className="text-sm font-semibold tracking-tight text-foreground">
              Top Companies Applied To
            </h3>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">
              Target organizations by volume
            </p>
          </div>
          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={metrics.topCompanies}
                layout="vertical"
                margin={{ top: 5, right: 30, left: 40, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(148, 163, 184, 0.12)" />
                <XAxis
                  type="number"
                  stroke="#94a3b8"
                  fontSize={11}
                  tickLine={false}
                  fontFamily="monospace"
                />
                <YAxis
                  dataKey="company"
                  type="category"
                  stroke="#94a3b8"
                  fontSize={11}
                  tickLine={false}
                  fontFamily="monospace"
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "rgba(15, 23, 42, 0.95)",
                    borderColor: "rgba(56, 189, 248, 0.3)",
                    borderRadius: "8px",
                    fontSize: "12px",
                    fontFamily: "monospace",
                  }}
                />
                <Bar dataKey="count" name="Applications" fill="#3b82f6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="orbital-card rounded-xl p-5 space-y-4">
          <div className="pb-3 border-b border-border/60">
            <h3 className="text-sm font-semibold tracking-tight text-foreground">
              Role Category Breakdown
            </h3>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">
              Applications classified by specialization
            </p>
          </div>
          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={metrics.categoryBreakdown}
                margin={{ top: 5, right: 20, left: -10, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148, 163, 184, 0.12)" />
                <XAxis
                  dataKey="category"
                  stroke="#94a3b8"
                  fontSize={10}
                  tickLine={false}
                  fontFamily="monospace"
                />
                <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} fontFamily="monospace" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "rgba(15, 23, 42, 0.95)",
                    borderColor: "rgba(56, 189, 248, 0.3)",
                    borderRadius: "8px",
                    fontSize: "12px",
                    fontFamily: "monospace",
                  }}
                />
                <Bar dataKey="count" name="Applications" fill="#06b6d4" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
