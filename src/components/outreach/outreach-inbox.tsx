"use client";

import React, { useState, useEffect, useRef, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Search,
  ExternalLink,
  Linkedin,
  MessageSquare,
  Check,
  X,
  RotateCw,
  ArrowLeft,
  Bot,
  Clock,
  ShieldAlert,
  ShieldCheck,
  Zap,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, formatDateTime, formatRelativeTime } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import type { DbOutreachContact } from "@/types/database";
import type {
  OutreachConversationItem,
  OutreachInteraction,
  OutreachProposal,
} from "@/types/dashboard";

interface OutreachInboxProps {
  conversations: OutreachConversationItem[];
  selectedContactId: string | null;
  selectedContact: DbOutreachContact | null;
  initialInteractions: OutreachInteraction[];
  initialProposals: OutreachProposal[];
  initialOutreachMode?: "review" | "auto";
}

function getInitials(name: string): string {
  if (!name) return "?";
  const cleaned = name.replace(/,\s*MBA/i, "").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const OUTREACH_REGENERATE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL
    ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/outreach-regenerate`
    : "https://mldtysploensrrulchdl.supabase.co/functions/v1/outreach-regenerate";

export function OutreachInbox({
  conversations,
  selectedContactId,
  selectedContact,
  initialInteractions,
  initialProposals,
  initialOutreachMode = "review",
}: OutreachInboxProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const isRefreshing = isPending || isManualRefreshing;

  const [searchQuery, setSearchQuery] = useState("");
  const [proposals, setProposals] = useState<OutreachProposal[]>(initialProposals);
  const [interactions, setInteractions] = useState<OutreachInteraction[]>(initialInteractions);

  // Outreach mode state ("review" | "auto")
  const [outreachMode, setOutreachMode] = useState<"review" | "auto">(initialOutreachMode);
  const [isUpdatingMode, setIsUpdatingMode] = useState(false);

  // Active proposal in pending_approval (or approved_for_send)
  const activeProposal = proposals.find(
    (p) => p.state === "pending_approval" || p.state === "approved_for_send"
  );

  const [composerText, setComposerText] = useState(
    activeProposal?.approved_text || activeProposal?.proposed_text || ""
  );
  const [isResolving, setIsResolving] = useState(false);
  const [justApproved, setJustApproved] = useState(
    activeProposal?.state === "approved_for_send"
  );
  const [errorFeedback, setErrorFeedback] = useState<string | null>(null);

  // Rewrite & Customize State
  const [customizeInstruction, setCustomizeInstruction] = useState("");
  const [isRewriting, setIsRewriting] = useState(false);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Refs to preserve user edits during refreshes
  const savedProposalTextRef = useRef<string>(
    activeProposal?.approved_text || activeProposal?.proposed_text || ""
  );
  const prevContactIdRef = useRef<string | null>(selectedContactId);
  const prevProposalIdRef = useRef<string | null>(activeProposal?.id || null);

  // Cleanup polling interval on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, []);

  // Sync state when selected contact or proposals change from server
  useEffect(() => {
    setProposals(initialProposals);
    setInteractions(initialInteractions);

    const curr = initialProposals.find(
      (p) => p.state === "pending_approval" || p.state === "approved_for_send"
    );
    const newSavedText = curr?.approved_text || curr?.proposed_text || "";
    const isDifferentContact = selectedContactId !== prevContactIdRef.current;
    const isDifferentProposal = (curr?.id || null) !== prevProposalIdRef.current;

    setJustApproved(curr?.state === "approved_for_send");
    setErrorFeedback(null);

    if (isDifferentContact || isDifferentProposal) {
      // Switched contact or proposal: cancel any active rewriting poll
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      setIsRewriting(false);

      // Switched contact or proposal: load the new proposal text
      setComposerText(newSavedText);
      savedProposalTextRef.current = newSavedText;
      prevContactIdRef.current = selectedContactId;
      prevProposalIdRef.current = curr?.id || null;
    } else {
      // Same contact and proposal on server refresh:
      // Do not clear the composer if the user has edited the draft text and it differs from the saved proposal text
      setComposerText((prevText) => {
        const userHasEdited =
          prevText !== savedProposalTextRef.current && prevText !== newSavedText;
        if (userHasEdited) {
          return prevText; // Preserve user's edited draft
        }
        return newSavedText;
      });
      savedProposalTextRef.current = newSavedText;
    }
  }, [selectedContactId, initialProposals, initialInteractions]);

  // Periodic background refresh every 5 minutes while tab is visible.
  // Pauses when document.hidden is true, and refreshes once when tab becomes visible again.
  useEffect(() => {
    const FIVE_MINUTES_MS = 5 * 60 * 1000;
    let timerId: NodeJS.Timeout | null = null;
    let wasHidden = false;

    const startTimer = () => {
      if (timerId) clearInterval(timerId);
      timerId = setInterval(() => {
        if (typeof document !== "undefined" && !document.hidden) {
          startTransition(() => {
            router.refresh();
          });
        }
      }, FIVE_MINUTES_MS);
    };

    const stopTimer = () => {
      if (timerId) {
        clearInterval(timerId);
        timerId = null;
      }
    };

    const handleVisibilityChange = () => {
      if (typeof document === "undefined") return;
      if (document.hidden) {
        wasHidden = true;
        stopTimer();
      } else {
        if (wasHidden) {
          wasHidden = false;
          startTransition(() => {
            router.refresh();
          });
        }
        startTimer();
      }
    };

    if (typeof document !== "undefined") {
      if (!document.hidden) {
        startTimer();
      } else {
        wasHidden = true;
      }
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    return () => {
      stopTimer();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
    };
  }, [router]);

  // Manual refresh button click handler
  const handleManualRefresh = () => {
    if (isRefreshing) return;
    setIsManualRefreshing(true);
    startTransition(() => {
      router.refresh();
    });
    // Ensure smooth spin feedback for at least 600ms
    setTimeout(() => {
      setIsManualRefreshing(false);
    }, 600);
  };

  // Sync outreach mode if prop updates
  useEffect(() => {
    setOutreachMode(initialOutreachMode);
  }, [initialOutreachMode]);

  const handleModeChange = async (newMode: "review" | "auto") => {
    if (newMode === outreachMode || isUpdatingMode) return;
    const previousMode = outreachMode;
    setOutreachMode(newMode);
    setIsUpdatingMode(true);

    try {
      const supabase = createClient();
      const { error: rpcError } = await supabase.rpc("set_outreach_mode", {
        p_mode: newMode,
      });

      if (rpcError) {
        console.warn("Browser RPC set_outreach_mode warning, falling back to server API:", rpcError);
        const res = await fetch("/api/outreach/mode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: newMode }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error || "Failed to update outreach mode");
        }
      }
    } catch (err: any) {
      console.error("Failed to switch outreach mode:", err);
      setOutreachMode(previousMode);
    } finally {
      setIsUpdatingMode(false);
    }
  };

  // Filter conversations based on search
  const filteredConversations = conversations.filter((conv) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      conv.full_name.toLowerCase().includes(q) ||
      (conv.company && conv.company.toLowerCase().includes(q)) ||
      (conv.professional_title && conv.professional_title.toLowerCase().includes(q)) ||
      (conv.last_message_preview && conv.last_message_preview.toLowerCase().includes(q))
    );
  });

  const handleApproveProposal = async () => {
    if (!activeProposal) return;
    setIsResolving(true);
    setErrorFeedback(null);

    try {
      const res = await fetch("/api/outreach/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: activeProposal.id,
          action: "approve",
          approved_text: composerText,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "Failed to approve proposal");
      }

      setJustApproved(true);
      setProposals((prev) =>
        prev.map((p) =>
          p.id === activeProposal.id
            ? {
                ...p,
                state: "approved_for_send",
                approved_text: composerText,
                approved_at: new Date().toISOString(),
              }
            : p
        )
      );
    } catch (err: any) {
      console.error("Approve proposal error:", err);
      setErrorFeedback(err.message || "Failed to approve draft");
    } finally {
      setIsResolving(false);
    }
  };

  const handleRejectProposal = async () => {
    if (!activeProposal) return;
    setIsResolving(true);
    setErrorFeedback(null);

    try {
      const res = await fetch("/api/outreach/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: activeProposal.id,
          action: "reject",
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "Failed to reject proposal");
      }

      setProposals((prev) => prev.filter((p) => p.id !== activeProposal.id));
      setComposerText("");
      setJustApproved(false);
    } catch (err: any) {
      console.error("Reject proposal error:", err);
      setErrorFeedback(err.message || "Failed to reject draft");
    } finally {
      setIsResolving(false);
    }
  };

  const handleRegenerate = async () => {
    if (
      !activeProposal ||
      activeProposal.state !== "pending_approval" ||
      isRewriting ||
      isResolving
    ) {
      return;
    }

    setIsRewriting(true);
    setErrorFeedback(null);

    const originalProposedText = activeProposal.proposed_text || "";
    const proposalId = activeProposal.id;
    const instruction =
      customizeInstruction.trim() || "regenerate, more natural, show curiosity";

    try {
      const supabase = createClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token =
        sessionData?.session?.access_token ||
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
        "";

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const res = await fetch(OUTREACH_REGENERATE_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({
          proposal_id: proposalId,
          instruction,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        console.warn("[outreach-regenerate] trigger returned status:", res.status, errJson);
        if (res.status === 401 || res.status === 403 || res.status === 404) {
          setErrorFeedback(errJson?.error || "Failed to trigger rewrite");
          setIsRewriting(false);
          return;
        }
      }
    } catch (err: any) {
      console.error("[outreach-regenerate] error calling function:", err);
    }

    // Poll the proposal every 2 seconds until proposed_text changes or 45 seconds pass
    const startTime = Date.now();
    const MAX_DURATION_MS = 45000;

    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }

    const checkProposal = async () => {
      const elapsed = Date.now() - startTime;
      if (elapsed >= MAX_DURATION_MS) {
        if (pollTimerRef.current) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
        setIsRewriting(false);
        return;
      }

      try {
        const pollRes = await fetch(`/api/outreach/proposals?id=${proposalId}`);
        if (!pollRes.ok) return;

        const pollJson = await pollRes.json();
        const updated = pollJson.data;

        if (updated && updated.id === proposalId) {
          if (updated.proposed_text && updated.proposed_text !== originalProposedText) {
            // Text updated
            if (pollTimerRef.current) {
              clearInterval(pollTimerRef.current);
              pollTimerRef.current = null;
            }

            // Replace the draft text
            setComposerText(updated.proposed_text);
            savedProposalTextRef.current = updated.proposed_text;

            // Update proposals in local state
            setProposals((prev) =>
              prev.map((p) =>
                p.id === proposalId ? { ...p, proposed_text: updated.proposed_text } : p
              )
            );

            // Clear rewriting state
            setIsRewriting(false);

            startTransition(() => {
              router.refresh();
            });
          }
        }
      } catch (pollErr) {
        console.error("[outreach-regenerate] polling check failed:", pollErr);
      }
    };

    pollTimerRef.current = setInterval(checkProposal, 2000);
  };

  const contactName = selectedContact?.full_name || selectedContact?.name || "";
  const contactTitle = selectedContact?.professional_title || selectedContact?.role || "";
  const connectionStage = selectedContact?.connection_stage || selectedContact?.status || "";

  const modeDescription =
    outreachMode === "review"
      ? "You approve every draft."
      : "Messages send without a click. Connection requests still wait for you.";

  return (
    <div className="h-[calc(100vh-6.5rem)] md:h-[calc(100vh-8.5rem)] min-h-[580px] rounded-xl border border-border bg-card overflow-hidden flex flex-col md:flex-row shadow-sm">
      {/* ================= LEFT PANE (Conversations List, ~320px) ================= */}
      <aside
        className={cn(
          "w-full md:w-[320px] md:min-w-[320px] md:max-w-[320px] border-b md:border-b-0 md:border-r border-border flex flex-col h-full bg-card shrink-0",
          selectedContactId ? "hidden md:flex" : "flex"
        )}
      >
        {/* Outreach Mode Control Header on Left Pane */}
        <div className="p-3 border-b border-border bg-card space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-foreground">Outreach Mode</span>
            <div className="inline-flex items-center bg-muted/80 p-0.5 rounded-lg border border-border">
              <button
                type="button"
                disabled={isUpdatingMode}
                onClick={() => handleModeChange("review")}
                className={cn(
                  "px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all flex items-center gap-1 cursor-pointer",
                  outreachMode === "review"
                    ? "bg-background text-foreground shadow-xs font-bold"
                    : "text-muted-foreground hover:text-foreground"
                )}
                title="Review: You approve every draft."
              >
                <ShieldCheck className="h-3 w-3" />
                <span>Review</span>
              </button>
              <button
                type="button"
                disabled={isUpdatingMode}
                onClick={() => handleModeChange("auto")}
                className={cn(
                  "px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all flex items-center gap-1 cursor-pointer",
                  outreachMode === "auto"
                    ? "bg-emerald-600 text-white shadow-xs font-bold"
                    : "text-muted-foreground hover:text-foreground"
                )}
                title="Auto: Messages send without a click. Connection requests still wait for you."
              >
                <Zap className="h-3 w-3" />
                <span>Auto</span>
              </button>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground leading-tight">
            {modeDescription}
          </p>
        </div>

        {/* Search Header */}
        <div className="p-3 border-b border-border bg-card/50">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Search messages"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-muted/40 border border-input rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring transition-all"
            />
          </div>
        </div>

        {/* Conversation List */}
        <div className="flex-1 overflow-y-auto divide-y divide-border/40">
          {conversations.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground space-y-1">
              <MessageSquare className="h-8 w-8 mx-auto opacity-30 mb-2" />
              <p className="text-xs font-semibold text-foreground">No conversations yet.</p>
              <p className="text-[11px] text-muted-foreground">Contacts will appear here once added to CRM.</p>
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground space-y-1">
              <p className="text-xs font-medium text-foreground">No results</p>
              <p className="text-[11px] text-muted-foreground">No conversations matching &quot;{searchQuery}&quot;</p>
            </div>
          ) : (
            filteredConversations.map((conv) => {
              const isSelected = selectedContactId === conv.id;
              const initials = getInitials(conv.full_name);
              const relTime = formatRelativeTime(conv.last_interaction_at);

              return (
                <Link
                  key={conv.id}
                  href={`/outreach/${conv.id}`}
                  className={cn(
                    "flex items-start gap-3 p-3 text-left transition-colors cursor-pointer border-l-2",
                    isSelected
                      ? "bg-muted/70 border-l-primary"
                      : "border-l-transparent hover:bg-muted/30"
                  )}
                >
                  {/* Avatar */}
                  <div
                    className={cn(
                      "w-10 h-10 rounded-full font-bold text-xs flex items-center justify-center shrink-0 border",
                      isSelected
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted text-muted-foreground border-border/60"
                    )}
                  >
                    {initials}
                  </div>

                  {/* Details */}
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center justify-between gap-1">
                      <span
                        className={cn(
                          "text-xs font-semibold truncate",
                          isSelected ? "text-foreground font-bold" : "text-foreground"
                        )}
                      >
                        {conv.full_name}
                      </span>
                      {relTime && (
                        <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                          {relTime}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-1.5">
                      <p className="text-[11px] text-muted-foreground truncate">
                        {conv.last_message_preview || conv.professional_title || "No messages yet"}
                      </p>

                      {conv.has_pending_proposal && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 shrink-0">
                          Draft
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </aside>

      {/* ================= RIGHT PANE (Thread & Composer) ================= */}
      <section
        className={cn(
          "flex-1 flex flex-col h-full bg-background min-w-0",
          !selectedContactId ? "hidden md:flex" : "flex"
        )}
      >
        {!selectedContact ? (
          <div className="h-full flex flex-col items-center justify-center p-8 text-center text-muted-foreground space-y-2">
            <MessageSquare className="h-10 w-10 opacity-30" />
            <p className="text-sm font-semibold text-foreground">
              {conversations.length === 0 ? "No conversations yet." : "Select a conversation"}
            </p>
            <p className="text-xs text-muted-foreground max-w-xs">
              {conversations.length === 0
                ? "Outreach records will be displayed here once synchronized."
                : "Choose a contact from the left pane to view messages and bot proposals."}
            </p>
          </div>
        ) : (
          <>
            {/* Thread Header with Outreach Mode Control, Refresh & Contact Details */}
            <header className="h-14 px-4 border-b border-border bg-card/60 backdrop-blur-xs flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                {/* Mobile Back Button */}
                <Link
                  href="/outreach"
                  className="md:hidden p-1.5 -ml-1 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors"
                  title="Back to conversations"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Link>

                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-xs font-bold text-foreground truncate">
                      {contactName}
                    </h2>
                    {connectionStage && (
                      <span className="text-[10px] px-2 py-0.2 rounded-full font-semibold uppercase tracking-wider bg-primary/10 text-primary border border-primary/20 shrink-0">
                        {connectionStage}
                      </span>
                    )}
                  </div>
                  {contactTitle && (
                    <p className="text-[11px] text-muted-foreground truncate">
                      {contactTitle}
                      {selectedContact.company ? ` • ${selectedContact.company}` : ""}
                    </p>
                  )}
                </div>
              </div>

              {/* Header Right Actions: Mode Switch + Refresh + LinkedIn Link */}
              <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                {/* Two-state Outreach Mode Switch (Header Control) */}
                <div className="flex flex-col items-end text-right">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider hidden sm:inline">
                      Mode:
                    </span>
                    <div className="inline-flex items-center bg-muted/80 p-0.5 rounded-lg border border-border text-[11px]">
                      <button
                        type="button"
                        disabled={isUpdatingMode}
                        onClick={() => handleModeChange("review")}
                        className={cn(
                          "px-2 py-0.5 rounded font-medium transition-all cursor-pointer",
                          outreachMode === "review"
                            ? "bg-background text-foreground shadow-xs font-bold"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                        title="You approve every draft."
                      >
                        Review
                      </button>
                      <button
                        type="button"
                        disabled={isUpdatingMode}
                        onClick={() => handleModeChange("auto")}
                        className={cn(
                          "px-2 py-0.5 rounded font-medium transition-all cursor-pointer",
                          outreachMode === "auto"
                            ? "bg-emerald-600 text-white shadow-xs font-bold"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                        title="Messages send without a click. Connection requests still wait for you."
                      >
                        Auto
                      </button>
                    </div>
                  </div>
                  <span
                    className="text-[9px] text-muted-foreground hidden lg:inline max-w-[260px] truncate"
                    title={modeDescription}
                  >
                    {modeDescription}
                  </span>
                </div>

                {/* Refresh Button */}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isRefreshing}
                  onClick={handleManualRefresh}
                  className="h-7 px-2 sm:px-2.5 text-[11px] font-medium gap-1.5 border-border bg-background hover:bg-muted text-foreground transition-colors shrink-0"
                  title="Refresh messages and proposals"
                >
                  <RotateCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
                  <span className="hidden sm:inline">Refresh</span>
                </Button>

                {/* LinkedIn Link */}
                {selectedContact.linkedin_url && (
                  <a
                    href={selectedContact.linkedin_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border bg-background text-[11px] font-medium text-foreground hover:bg-muted transition-colors shrink-0"
                  >
                    <Linkedin className="h-3.5 w-3.5 text-sky-600" />
                    <span className="hidden sm:inline">LinkedIn</span>
                    <ExternalLink className="h-3 w-3 opacity-60" />
                  </a>
                )}
              </div>
            </header>

            {/* Scrollable Message Thread */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
              {interactions.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center p-8 text-center text-muted-foreground space-y-1">
                  <MessageSquare className="h-8 w-8 opacity-30 mb-1" />
                  <p className="text-sm font-semibold text-foreground">No messages yet.</p>
                  <p className="text-xs text-muted-foreground/80 max-w-xs">
                    Messages and notifications with this contact will appear here.
                  </p>
                </div>
              ) : (
                interactions.map((interaction) => {
                  const isOutbound = (interaction.direction || "").toLowerCase() === "outbound";
                  const eventTime = interaction.event_at || interaction.created_at;

                  return (
                    <div
                      key={interaction.id}
                      className={cn(
                        "flex flex-col space-y-1",
                        isOutbound ? "items-end" : "items-start"
                      )}
                    >
                      {/* Message Bubble - exact text, no cards around every bubble */}
                      <div
                        className={cn(
                          "px-4 py-2.5 max-w-[82%] sm:max-w-[75%] text-xs leading-relaxed whitespace-pre-wrap rounded-2xl shadow-xs",
                          isOutbound
                            ? "rounded-tr-xs bg-primary text-primary-foreground"
                            : "rounded-tl-xs bg-muted text-foreground border border-border/50"
                        )}
                      >
                        {interaction.message_summary || "(No content)"}
                      </div>

                      {/* Time under each message */}
                      <span className="text-[10px] text-muted-foreground font-mono px-1">
                        {formatDateTime(eventTime)}
                      </span>
                    </div>
                  );
                })
              )}
            </div>

            {/* Bottom Composer */}
            <div className="p-3 sm:p-4 border-t border-border bg-card/80 space-y-2 shrink-0">
              {/* If proposal was approved */}
              {justApproved ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 font-semibold text-xs">
                    <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span>Approved. Bot will send.</span>
                  </div>
                  <textarea
                    disabled
                    value={composerText}
                    rows={2}
                    className="w-full resize-none p-2.5 text-xs bg-muted/30 text-muted-foreground border border-input rounded-lg cursor-not-allowed opacity-80"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {outreachMode === "auto"
                      ? "Messages send without a click. Connection requests still wait for you."
                      : "Bot will draft the next message. You approve before anything is sent."}
                  </p>
                </div>
              ) : activeProposal && activeProposal.state === "pending_approval" ? (
                /* Editable Composer for Pending Proposal (Always kept per requirement 7) */
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span className="font-semibold text-foreground flex items-center gap-1.5">
                      <Bot className="h-3.5 w-3.5 text-primary" />
                      <span>Bot Draft ({activeProposal.channel || "LinkedIn"})</span>
                      {isRewriting && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 animate-pulse">
                          <RotateCw className="h-2.5 w-2.5 animate-spin" />
                          Rewriting...
                        </span>
                      )}
                    </span>
                    <span className="font-mono text-[10px]">
                      {composerText.length} characters
                    </span>
                  </div>

                  {activeProposal.signal && (
                    <p className="text-[10px] text-muted-foreground italic px-0.5">
                      Signal: {activeProposal.signal}
                    </p>
                  )}

                  {isRewriting && (
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 text-xs">
                      <RotateCw className="h-3.5 w-3.5 animate-spin shrink-0 text-amber-600 dark:text-amber-400" />
                      <span>Rewriting... Waiting for updated proposal.</span>
                    </div>
                  )}

                  <textarea
                    value={composerText}
                    onChange={(e) => setComposerText(e.target.value)}
                    rows={3}
                    disabled={isResolving || isRewriting}
                    placeholder="Edit message..."
                    className="w-full resize-y p-2.5 text-xs rounded-lg border border-input bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring transition-all disabled:opacity-70"
                  />

                  {errorFeedback && (
                    <div className="flex items-center gap-1.5 text-xs text-rose-600 bg-rose-500/10 border border-rose-500/20 p-2 rounded-lg">
                      <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                      <span>{errorFeedback}</span>
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-1">
                    {/* Customize & Regenerate Controls */}
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                      <label
                        htmlFor="outreach-customize-input"
                        className="text-[11px] font-semibold text-muted-foreground shrink-0"
                      >
                        Customize
                      </label>
                      <input
                        id="outreach-customize-input"
                        type="text"
                        placeholder="more natural, show curiosity"
                        value={customizeInstruction}
                        onChange={(e) => setCustomizeInstruction(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleRegenerate();
                          }
                        }}
                        disabled={isResolving || isRewriting}
                        className="h-7 px-2.5 text-xs bg-background border border-input rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring flex-1 max-w-xs transition-colors disabled:opacity-50"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isResolving || isRewriting}
                        onClick={handleRegenerate}
                        className="h-7 text-xs font-medium gap-1 px-2.5 border-border text-foreground hover:bg-muted shrink-0 cursor-pointer disabled:cursor-not-allowed"
                        title="Regenerate proposal draft"
                      >
                        {isRewriting ? (
                          <RotateCw className="h-3 w-3 animate-spin" />
                        ) : (
                          <Sparkles className="h-3 w-3 text-amber-500" />
                        )}
                        <span>{isRewriting ? "Rewriting..." : "Regenerate"}</span>
                      </Button>
                    </div>

                    {/* Approve & Reject Controls */}
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        disabled={isResolving || isRewriting}
                        onClick={handleApproveProposal}
                        className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-medium gap-1 px-3 shadow-xs cursor-pointer disabled:cursor-not-allowed"
                      >
                        {isResolving ? (
                          <RotateCw className="h-3 w-3 animate-spin" />
                        ) : (
                          <Check className="h-3 w-3" />
                        )}
                        <span>Approve</span>
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isResolving || isRewriting}
                        onClick={handleRejectProposal}
                        className="h-7 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/20 font-medium gap-1 px-3 border-border cursor-pointer disabled:cursor-not-allowed"
                      >
                        <X className="h-3 w-3" />
                        <span>Reject</span>
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                /* Disabled Composer when no pending proposal */
                <div className="space-y-1.5">
                  <textarea
                    disabled
                    placeholder="Write a message..."
                    rows={3}
                    className="w-full resize-none p-3 text-xs bg-muted/40 text-muted-foreground border border-input rounded-lg cursor-not-allowed placeholder:text-muted-foreground/60 focus:outline-none"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {outreachMode === "auto"
                      ? "Messages send without a click. Connection requests still wait for you."
                      : "Bot will draft the next message. You approve before anything is sent."}
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
