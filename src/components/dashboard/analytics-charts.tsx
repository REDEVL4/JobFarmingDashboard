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
      {/* Conversion Rate Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-l-4 border-l-sky-500">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Employer Response Rate
              </p>
              <h4 className="text-2xl font-bold mt-1 text-foreground">
                {metrics.responseRate}%
              </h4>
            </div>
            <span className="text-xs font-medium px-2 py-1 rounded bg-sky-500/10 text-sky-600 dark:text-sky-400">
              {metrics.recruiterResponses} replies
            </span>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-purple-500">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Interview Conversion Rate
              </p>
              <h4 className="text-2xl font-bold mt-1 text-foreground">
                {metrics.interviewConversionRate}%
              </h4>
            </div>
            <span className="text-xs font-medium px-2 py-1 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400">
              {metrics.interviews} interviews
            </span>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-rose-500">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Rejection Rate
              </p>
              <h4 className="text-2xl font-bold mt-1 text-foreground">
                {metrics.rejectionRate}%
              </h4>
            </div>
            <span className="text-xs font-medium px-2 py-1 rounded bg-rose-500/10 text-rose-600 dark:text-rose-400">
              {metrics.rejected} closed
            </span>
          </CardContent>
        </Card>
      </div>

      {/* Main Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Trend Line Chart */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-base font-semibold">Application & Response Volume</CardTitle>
              <CardDescription className="text-xs">
                Submission cadence compared with recruiter activity
              </CardDescription>
            </div>
            <div className="flex items-center gap-1 bg-muted p-0.5 rounded-lg text-xs">
              <Button
                variant={period === "weekly" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setPeriod("weekly")}
                className="h-7 px-2.5 text-xs font-medium"
              >
                Weekly
              </Button>
              <Button
                variant={period === "monthly" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setPeriod("monthly")}
                className="h-7 px-2.5 text-xs font-medium"
              >
                Monthly
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={metrics.trendsByPeriod}
                  margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="appliedGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="responsesGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="period" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      borderColor: "hsl(var(--border))",
                      borderRadius: "8px",
                      fontSize: "12px",
                      color: "hsl(var(--foreground))",
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "12px" }} />
                  <Area
                    type="monotone"
                    dataKey="applied"
                    name="Applications Sent"
                    stroke="#6366f1"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#appliedGradient)"
                  />
                  <Area
                    type="monotone"
                    dataKey="responses"
                    name="Employer Responses"
                    stroke="#0ea5e9"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#responsesGradient)"
                  />
                  <Area
                    type="monotone"
                    dataKey="interviews"
                    name="Interviews"
                    stroke="#a855f7"
                    strokeWidth={2}
                    fill="#a855f7"
                    fillOpacity={0.1}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Status Distribution Donut */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Status Distribution</CardTitle>
            <CardDescription className="text-xs">
              Click any segment to filter application table
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={metrics.statusDistribution}
                    dataKey="count"
                    nameKey="status"
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={80}
                    paddingAngle={3}
                    onClick={onPieClick}
                    cursor="pointer"
                  >
                    {metrics.statusDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      borderColor: "hsl(var(--border))",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                    formatter={(value: any) => [`${value} applications`, "Count"]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t">
              {metrics.statusDistribution.map((item) => (
                <div
                  key={item.status}
                  onClick={() => onPieClick(item)}
                  className="flex items-center gap-1.5 cursor-pointer p-1 rounded hover:bg-muted transition-colors"
                >
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                  <span className="text-muted-foreground truncate">{item.status}</span>
                  <span className="font-semibold ml-auto">{item.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Secondary Charts: Top Companies & Categories */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Top Companies Applied To</CardTitle>
            <CardDescription className="text-xs">Target organizations by volume</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={metrics.topCompanies} layout="vertical" margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                  <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} />
                  <YAxis dataKey="company" type="category" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      borderColor: "hsl(var(--border))",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  />
                  <Bar dataKey="count" name="Applications" fill="#6366f1" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Role Category Breakdown</CardTitle>
            <CardDescription className="text-xs">Applications classified by specialization</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={metrics.categoryBreakdown} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="category" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      borderColor: "hsl(var(--border))",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  />
                  <Bar dataKey="count" name="Applications" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

