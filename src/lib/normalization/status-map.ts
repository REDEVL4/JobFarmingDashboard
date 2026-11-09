import { CANONICAL_STATES } from "./states";
import type { NormalizedStatus } from "@/types/dashboard";

/**
 * Normalizes raw database or tracker status string.
 * Strips formatting, handles case-insensitivity, Turkish characters, and aliases.
 * Preserves original raw status if unmapped without coercing.
 */
export function normalizeStatus(rawStatus: string | null | undefined): {
  normalized: NormalizedStatus;
  canonicalLabel: string;
  isUnmapped: boolean;
} {
  if (!rawStatus || !rawStatus.trim()) {
    return {
      normalized: "unmapped",
      canonicalLabel: "Unspecified",
      isUnmapped: true,
    };
  }

  // Strip markdown, dates, or bold brackets: e.g. "**Applied** (2026-10-30)" -> "applied"
  const cleaned = rawStatus
    .replace(/\*\*/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[❌✅]/g, "")
    .trim()
    .toLowerCase();

  for (const state of CANONICAL_STATES) {
    if (state.id.toLowerCase() === cleaned || state.label.toLowerCase() === cleaned) {
      return {
        normalized: state.group,
        canonicalLabel: state.label,
        isUnmapped: false,
      };
    }

    if (state.aliases.some((alias) => alias.toLowerCase() === cleaned)) {
      return {
        normalized: state.group,
        canonicalLabel: state.label,
        isUnmapped: false,
      };
    }
  }

  // Partial substring matching for common compounds (e.g. "interviewing with manager")
  if (cleaned.includes("interview") || cleaned.includes("screen")) {
    return {
      normalized: "interviewing",
      canonicalLabel: "Interview",
      isUnmapped: false,
    };
  }
  if (cleaned.includes("reject") || cleaned.includes("declined")) {
    return {
      normalized: "rejected",
      canonicalLabel: "Rejected",
      isUnmapped: false,
    };
  }
  if (cleaned.includes("offer") || cleaned.includes("hired")) {
    return {
      normalized: "offer",
      canonicalLabel: "Offer",
      isUnmapped: false,
    };
  }
  if (cleaned.includes("assess") || cleaned.includes("coding")) {
    return {
      normalized: "assessment",
      canonicalLabel: "Assessment",
      isUnmapped: false,
    };
  }
  if (cleaned.includes("applied") || cleaned.includes("submit")) {
    return {
      normalized: "applied",
      canonicalLabel: "Applied",
      isUnmapped: false,
    };
  }
  if (cleaned.includes("skip") || cleaned.includes("closed") || cleaned.includes("withdrawn")) {
    return {
      normalized: "withdrawn",
      canonicalLabel: "Skipped / Closed",
      isUnmapped: false,
    };
  }

  // Preserve as unmapped explicitly
  return {
    normalized: "unmapped",
    canonicalLabel: rawStatus.trim(),
    isUnmapped: true,
  };
}

export function getStatusBadgeStyle(status: NormalizedStatus | "unmapped"): {
  bg: string;
  text: string;
  border: string;
  dotColor: string;
} {
  switch (status) {
    case "applied":
      return {
        bg: "bg-indigo-50 dark:bg-indigo-950/40",
        text: "text-indigo-700 dark:text-indigo-300",
        border: "border-indigo-200 dark:border-indigo-800/60",
        dotColor: "bg-indigo-500",
      };
    case "pending":
      return {
        bg: "bg-amber-50 dark:bg-amber-950/40",
        text: "text-amber-700 dark:text-amber-300",
        border: "border-amber-200 dark:border-amber-800/60",
        dotColor: "bg-amber-500",
      };
    case "under_review":
      return {
        bg: "bg-sky-50 dark:bg-sky-950/40",
        text: "text-sky-700 dark:text-sky-300",
        border: "border-sky-200 dark:border-sky-800/60",
        dotColor: "bg-sky-500",
      };
    case "assessment":
      return {
        bg: "bg-orange-50 dark:bg-orange-950/40",
        text: "text-orange-700 dark:text-orange-300",
        border: "border-orange-200 dark:border-orange-800/60",
        dotColor: "bg-orange-500",
      };
    case "interviewing":
      return {
        bg: "bg-purple-50 dark:bg-purple-950/40",
        text: "text-purple-700 dark:text-purple-300",
        border: "border-purple-200 dark:border-purple-800/60",
        dotColor: "bg-purple-500",
      };
    case "offer":
      return {
        bg: "bg-emerald-50 dark:bg-emerald-950/40",
        text: "text-emerald-700 dark:text-emerald-300",
        border: "border-emerald-200 dark:border-emerald-800/60",
        dotColor: "bg-emerald-500",
      };
    case "rejected":
      return {
        bg: "bg-rose-50 dark:bg-rose-950/40",
        text: "text-rose-700 dark:text-rose-300",
        border: "border-rose-200 dark:border-rose-800/60",
        dotColor: "bg-rose-500",
      };
    case "withdrawn":
      return {
        bg: "bg-slate-100 dark:bg-slate-900/40",
        text: "text-slate-700 dark:text-slate-300",
        border: "border-slate-200 dark:border-slate-800/60",
        dotColor: "bg-slate-400",
      };
    case "unmapped":
    default:
      return {
        bg: "bg-yellow-50 dark:bg-yellow-950/40",
        text: "text-yellow-800 dark:text-yellow-300",
        border: "border-yellow-200 dark:border-yellow-800/60",
        dotColor: "bg-yellow-500",
      };
  }
}
