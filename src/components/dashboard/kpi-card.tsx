import React from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: number | string;
  subtext?: string;
  icon: React.ElementType;
  tone?: "primary" | "info" | "purple" | "emerald" | "amber" | "rose" | "neutral";
  filterLink?: string;
  isActive?: boolean;
}

const TONE_STYLES = {
  primary: {
    bg: "bg-indigo-500/10 dark:bg-indigo-500/15",
    text: "text-indigo-600 dark:text-indigo-400",
    border: "border-indigo-500/20",
    glow: "group-hover:border-indigo-500/40",
  },
  info: {
    bg: "bg-sky-500/10 dark:bg-sky-500/15",
    text: "text-sky-600 dark:text-sky-400",
    border: "border-sky-500/20",
    glow: "group-hover:border-sky-500/40",
  },
  purple: {
    bg: "bg-purple-500/10 dark:bg-purple-500/15",
    text: "text-purple-600 dark:text-purple-400",
    border: "border-purple-500/20",
    glow: "group-hover:border-purple-500/40",
  },
  emerald: {
    bg: "bg-emerald-500/10 dark:bg-emerald-500/15",
    text: "text-emerald-600 dark:text-emerald-400",
    border: "border-emerald-500/20",
    glow: "group-hover:border-emerald-500/40",
  },
  amber: {
    bg: "bg-amber-500/10 dark:bg-amber-500/15",
    text: "text-amber-600 dark:text-amber-400",
    border: "border-amber-500/20",
    glow: "group-hover:border-amber-500/40",
  },
  rose: {
    bg: "bg-rose-500/10 dark:bg-rose-500/15",
    text: "text-rose-600 dark:text-rose-400",
    border: "border-rose-500/20",
    glow: "group-hover:border-rose-500/40",
  },
  neutral: {
    bg: "bg-slate-500/10 dark:bg-slate-500/15",
    text: "text-slate-600 dark:text-slate-400",
    border: "border-slate-500/20",
    glow: "group-hover:border-slate-500/40",
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
}: KpiCardProps) {
  const styles = TONE_STYLES[tone];

  const content = (
    <div
      className={cn(
        "group relative p-4 rounded-xl border bg-card text-card-foreground shadow-subtle transition-all card-hover-effect flex flex-col justify-between h-full select-none cursor-pointer",
        styles.glow,
        isActive && "ring-2 ring-primary border-transparent"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-muted-foreground truncate">{label}</span>
        <div className={cn("p-2 rounded-lg shrink-0", styles.bg, styles.text)}>
          <Icon className="h-4 w-4" />
        </div>
      </div>

      <div className="mt-3 flex items-baseline justify-between">
        <span className="text-2xl font-bold tracking-tight text-foreground">{value}</span>
        {filterLink && (
          <span className="text-[11px] text-muted-foreground group-hover:text-primary flex items-center transition-colors">
            Filter <ArrowUpRight className="h-3 w-3 ml-0.5" />
          </span>
        )}
      </div>

      {subtext && (
        <span className="mt-1 text-[11px] text-muted-foreground truncate">{subtext}</span>
      )}
    </div>
  );

  if (filterLink) {
    return <Link href={filterLink}>{content}</Link>;
  }

  return content;
}
