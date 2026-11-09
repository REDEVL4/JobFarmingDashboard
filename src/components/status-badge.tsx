import React from "react";
import { getStatusBadgeStyle, normalizeStatus } from "@/lib/normalization/status-map";
import { cn } from "@/lib/utils";
import type { NormalizedStatus } from "@/types/dashboard";

interface StatusBadgeProps {
  status: string | NormalizedStatus;
  size?: "sm" | "default" | "lg";
  showDot?: boolean;
  className?: string;
}

export function StatusBadge({ status, size = "default", showDot = true, className }: StatusBadgeProps) {
  const { normalized, canonicalLabel, isUnmapped } = normalizeStatus(status);
  const style = getStatusBadgeStyle(normalized);

  const sizeClasses = {
    sm: "px-2 py-0.5 text-[11px]",
    default: "px-2.5 py-1 text-xs",
    lg: "px-3 py-1.5 text-sm",
  };

  const dotSizes = {
    sm: "w-1.5 h-1.5",
    default: "w-2 h-2",
    lg: "w-2.5 h-2.5",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-medium border select-none transition-colors",
        style.bg,
        style.text,
        style.border,
        sizeClasses[size],
        className
      )}
    >
      {showDot && (
        <span
          className={cn("rounded-full animate-pulse-subtle", style.dotColor, dotSizes[size])}
        />
      )}
      <span>{canonicalLabel}</span>
      {isUnmapped && (
        <span className="text-[10px] uppercase font-bold tracking-wider opacity-75 ml-0.5">
          (Unmapped)
        </span>
      )}
    </span>
  );
}
