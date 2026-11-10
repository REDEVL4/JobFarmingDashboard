"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, formatDateTime, formatRelativeTime } from "@/lib/utils";
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
}

function getInitials(name: string): string {
  if (!name) return "?";
  const cleaned = name.replace(/,\s*MBA/i, "").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function OutreachInbox({
  conversations,
  selectedContactId,
  selectedContact,
  initialInteractions,
  initialProposals,
}: OutreachInboxProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [proposals, setProposals] = useState<OutreachProposal[]>(initialProposals);
  const [interactions, setInteractions] = useState<OutreachInteraction[]>(initialInteractions);

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

  // Sync state when selected contact or proposals change
  useEffect(() => {
    setProposals(initialProposals);
    setInteractions(initialInteractions);
    const curr = initialProposals.find(
      (p) => p.state === "pending_approval" || p.state === "approved_for_send"
    );
    setComposerText(curr?.approved_text || curr?.proposed_text || "");
    setJustApproved(curr?.state === "approved_for_send");
    setErrorFeedback(null);
  }, [selectedContactId, initialProposals, initialInteractions]);

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

  const contactName = selectedContact?.full_name || selectedContact?.name || "";
  const contactTitle = selectedContact?.professional_title || selectedContact?.role || "";
  const connectionStage = selectedContact?.connection_stage || selectedContact?.status || "";

  return (
    <div className="h-[calc(100vh-6.5rem)] md:h-[calc(100vh-8.5rem)] min-h-[580px] rounded-xl border border-border bg-card overflow-hidden flex flex-col md:flex-row shadow-sm">
      {/* ================= LEFT PANE (Conversations List, ~320px) ================= */}
      <aside
        className={cn(
          "w-full md:w-[320px] md:min-w-[320px] md:max-w-[320px] border-b md:border-b-0 md:border-r border-border flex flex-col h-full bg-card shrink-0",
          selectedContactId ? "hidden md:flex" : "flex"
        )}
      >
        {/* Search Header */}
        <div className="p-3 border-b border-border bg-card">
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
            {/* Thread Header */}
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
                    Bot will draft the next message. You approve before anything is sent.
                  </p>
                </div>
              ) : activeProposal && activeProposal.state === "pending_approval" ? (
                /* Editable Composer for Pending Proposal */
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span className="font-semibold text-foreground flex items-center gap-1.5">
                      <Bot className="h-3.5 w-3.5 text-primary" />
                      <span>Bot Draft ({activeProposal.channel || "LinkedIn"})</span>
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

                  <textarea
                    value={composerText}
                    onChange={(e) => setComposerText(e.target.value)}
                    rows={3}
                    disabled={isResolving}
                    placeholder="Edit message..."
                    className="w-full resize-y p-2.5 text-xs rounded-lg border border-input bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring transition-all"
                  />

                  {errorFeedback && (
                    <div className="flex items-center gap-1.5 text-xs text-rose-600 bg-rose-500/10 border border-rose-500/20 p-2 rounded-lg">
                      <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                      <span>{errorFeedback}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[11px] text-muted-foreground">
                      Approve to queue for bot send
                    </span>

                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        disabled={isResolving}
                        onClick={handleApproveProposal}
                        className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-medium gap-1 px-3 shadow-xs"
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
                        disabled={isResolving}
                        onClick={handleRejectProposal}
                        className="h-7 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/20 font-medium gap-1 px-3 border-border"
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
                    Bot will draft the next message. You approve before anything is sent.
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

