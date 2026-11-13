"use client";

import React from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: number | string;
  subtext?: string;
  icon: React.ElementType;
  tone?: "primary" | "info" | "purple" | "emerald" | "amber" | "rose" | "neutral" | "cyan";
  filterLink?: string;
  isActive?: boolean;
  isHero?: boolean;
}

const TONE_STYLES = {
  primary: {
    badgeBg: "bg-blue-500/10",
    badgeText: "text-blue-400",
    border: "border-blue-500/20",
    glow: "group-hover:border-blue-400/50 group-hover:shadow-[0_0_20px_rgba(59,130,246,0.2)]",
    indicator: "bg-blue-500",
  },
  cyan: {
    badgeBg: "bg-cyan-500/10",
    badgeText: "text-cyan-400",
    border: "border-cyan-500/20",
    glow: "group-hover:border-cyan-400/50 group-hover:shadow-[0_0_20px_rgba(6,182,212,0.25)]",
    indicator: "bg-cyan-400",
  },
  info: {
    badgeBg: "bg-sky-500/10",
    badgeText: "text-sky-400",
    border: "border-sky-500/20",
    glow: "group-hover:border-sky-400/50 group-hover:shadow-[0_0_20px_rgba(14,165,233,0.2)]",
    indicator: "bg-sky-400",
  },
  purple: {
    badgeBg: "bg-purple-500/10",
    badgeText: "text-purple-400",
    border: "border-purple-500/20",
    glow: "group-hover:border-purple-400/50 group-hover:shadow-[0_0_20px_rgba(168,85,247,0.2)]",
    indicator: "bg-purple-400",
  },
  emerald: {
    badgeBg: "bg-emerald-500/10",
    badgeText: "text-emerald-400",
    border: "border-emerald-500/20",
    glow: "group-hover:border-emerald-400/50 group-hover:shadow-[0_0_20px_rgba(16,185,129,0.2)]",
    indicator: "bg-emerald-400",
  },
  amber: {
    badgeBg: "bg-amber-500/10",
    badgeText: "text-amber-400",
    border: "border-amber-500/20",
    glow: "group-hover:border-amber-400/50 group-hover:shadow-[0_0_20px_rgba(245,158,11,0.25)]",
    indicator: "bg-amber-400",
  },
  rose: {
    badgeBg: "bg-rose-500/10",
    badgeText: "text-rose-400",
    border: "border-rose-500/20",
    glow: "group-hover:border-rose-400/50 group-hover:shadow-[0_0_20px_rgba(244,63,94,0.2)]",
    indicator: "bg-rose-400",
  },
  neutral: {
    badgeBg: "bg-slate-500/10",
    badgeText: "text-slate-400",
    border: "border-slate-500/20",
    glow: "group-hover:border-slate-400/50 group-hover:shadow-[0_0_15px_rgba(148,163,184,0.15)]",
    indicator: "bg-slate-400",
  },
};

export function KpiCard({
  label,
  value,
  subtext,
  icon: Icon,
  tone = "primary",
  filterLink,
  isActive = false,
  isHero = false,
}: KpiCardProps) {
  const styles = TONE_STYLES[tone] || TONE_STYLES.primary;
  const isZero = typeof value === "number" && value === 0;

  const cardContent = (
    <div
      className={cn(
        "group relative rounded-xl orbital-card transition-all duration-200 select-none cursor-pointer flex flex-col justify-between overflow-hidden",
        isHero ? "p-4 sm:p-5" : "p-3 sm:p-3.5",
        styles.glow,
        isActive && "ring-1 ring-cyan-400 border-cyan-400/60 shadow-[0_0_20px_rgba(6,182,212,0.3)]",
        isZero && "opacity-65 hover:opacity-100"
      )}
    >
      {/* Top subtle light accent */}
      <div className="absolute top-0 inset-x-0 h-[1px] bg-gradient-to-r from-transparent via-cyan-400/20 to-transparent" />

      {/* Header Row */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground truncate uppercase tracking-wider font-mono">
          {label}
        </span>
        <div
          className={cn(
            "p-2 rounded-lg shrink-0 border transition-all duration-200 group-hover:scale-105",
            styles.badgeBg,
            styles.badgeText,
            styles.border
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
      </div>

      {/* Metric Value */}
      <div className="mt-3 flex items-baseline justify-between">
        <span
          className={cn(
            "font-mono font-bold tracking-tight tabular-nums text-foreground",
            isHero ? "text-2xl sm:text-3xl" : "text-xl sm:text-2xl",
            isZero ? "text-slate-400" : ""
          )}
        >
          {value}
        </span>

        {filterLink && (
          <span className="text-[11px] font-mono text-muted-foreground group-hover:text-cyan-400 flex items-center transition-colors">
            Filter <ArrowUpRight className="h-3 w-3 ml-0.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </span>
        )}
      </div>

      {/* Telemetry Subtext */}
      {subtext && (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground font-mono truncate">
          <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", isZero ? "bg-slate-500" : styles.indicator)} />
          <span className="truncate">{subtext}</span>
        </div>
      )}
    </div>
  );

  if (filterLink) {
    return (
      <Link href={filterLink} className="block h-full">
        {cardContent}
      </Link>
    );
  }

  return cardContent;
}
