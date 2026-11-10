"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ExternalLink,
  Linkedin,
  Mail,
  MessageSquare,
  Check,
  X,
  RotateCw,
  Building,
  Sparkles,
  Bot,
  Copy,
  Clock,
  ShieldAlert,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils";
import type { DbOutreachContact } from "@/types/database";
import type { OutreachInteraction, OutreachProposal } from "@/types/dashboard";

interface ContactThreadViewProps {
  contact: DbOutreachContact;
  initialInteractions: OutreachInteraction[];
  initialProposals: OutreachProposal[];
}

export function ContactThreadView({
  contact,
  initialInteractions,
  initialProposals,
}: ContactThreadViewProps) {
  const [interactions] = useState<OutreachInteraction[]>(initialInteractions);
  const [proposals, setProposals] = useState<OutreachProposal[]>(initialProposals);

  // Per-proposal editable texts
  const [proposalTexts, setProposalTexts] = useState<Record<string, string>>(() => {
    const initialMap: Record<string, string> = {};
    for (const p of initialProposals) {
      initialMap[p.id] = p.approved_text || p.proposed_text;
    }
    return initialMap;
  });

  const [isResolving, setIsResolving] = useState<Record<string, boolean>>({});
  const [feedback, setFeedback] = useState<Record<string, { type: "success" | "error"; text: string }>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const contactName = contact.full_name || contact.name || "Contact";
  const contactTitle = contact.professional_title || contact.role;
  const contactCompany = contact.company;
  const connectionStage = contact.connection_stage || contact.status || "new";

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const handleApproveProposal = async (proposal: OutreachProposal) => {
    const textToSend = proposalTexts[proposal.id] ?? proposal.proposed_text;
    setIsResolving((prev) => ({ ...prev, [proposal.id]: true }));
    setFeedback((prev) => {
      const next = { ...prev };
      delete next[proposal.id];
      return next;
    });

    try {
      const res = await fetch("/api/outreach/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: proposal.id,
          action: "approve",
          approved_text: textToSend,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "Failed to approve proposal");
      }

      // Update proposal state in client
      const updatedState = proposal.channel === "gmail" ? "queued" : "approved_for_send";
      setProposals((prev) =>
        prev.map((p) =>
          p.id === proposal.id
            ? {
                ...p,
                state: updatedState,
                approved_text: textToSend,
                approved_at: new Date().toISOString(),
              }
            : p
        )
      );

      setFeedback((prev) => ({
        ...prev,
        [proposal.id]: {
          type: "success",
          text: "Approved. Bot will send.",
        },
      }));
    } catch (err: any) {
      console.error("Approve error:", err);
      setFeedback((prev) => ({
        ...prev,
        [proposal.id]: {
          type: "error",
          text: err.message || "Failed to approve draft",
        },
      }));
    } finally {
      setIsResolving((prev) => ({ ...prev, [proposal.id]: false }));
    }
  };

  const handleRejectProposal = async (proposalId: string) => {
    setIsResolving((prev) => ({ ...prev, [proposalId]: true }));
    setFeedback((prev) => {
      const next = { ...prev };
      delete next[proposalId];
      return next;
    });

    try {
      const res = await fetch("/api/outreach/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: proposalId,
          action: "reject",
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "Failed to reject proposal");
      }

      // Remove rejected proposal from the open list
      setProposals((prev) => prev.filter((p) => p.id !== proposalId));
    } catch (err: any) {
      console.error("Reject error:", err);
      setFeedback((prev) => ({
        ...prev,
        [proposalId]: {
          type: "error",
          text: err.message || "Failed to reject draft",
        },
      }));
    } finally {
      setIsResolving((prev) => ({ ...prev, [proposalId]: false }));
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      {/* Top back navigation */}
      <div>
        <Link
          href="/outreach"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors font-medium"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to LinkedIn CRM</span>
        </Link>
      </div>

      {/* Contact Header Card */}
      <Card className="border border-border shadow-sm">
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold tracking-tight text-foreground">
                  {contactName}
                </h1>
                <span className="text-[11px] px-2.5 py-0.5 rounded-full font-semibold uppercase tracking-wider bg-primary/10 text-primary border border-primary/20">
                  {connectionStage}
                </span>
                {contact.score && (
                  <span className="text-[11px] px-2.5 py-0.5 rounded-full font-bold bg-muted text-foreground">
                    Score: {contact.score}/100
                  </span>
                )}
              </div>

              {(contactCompany || contactTitle) && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                  {contactCompany && (
                    <span className="flex items-center gap-1">
                      <Building className="h-3.5 w-3.5" />
                      <span className="font-medium text-foreground">{contactCompany}</span>
                    </span>
                  )}
                  {contactCompany && contactTitle && <span>•</span>}
                  {contactTitle && <span>{contactTitle}</span>}
                </div>
              )}

              {contact.notes && (
                <p className="text-[11px] text-muted-foreground/80 italic pt-1">
                  Note: {contact.notes}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {contact.linkedin_url && (
                <a
                  href={contact.linkedin_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card text-xs font-medium text-foreground hover:bg-muted transition-colors shadow-sm"
                >
                  <Linkedin className="h-3.5 w-3.5 text-sky-600" />
                  <span>LinkedIn Profile</span>
                  <ExternalLink className="h-3 w-3 opacity-60 ml-0.5" />
                </a>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Chat Timeline Card */}
      <Card className="border border-border shadow-sm">
        <CardHeader className="border-b pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" />
              <CardTitle className="text-base font-semibold">Interaction Timeline</CardTitle>
            </div>
            <span className="text-xs text-muted-foreground">
              {interactions.length} {interactions.length === 1 ? "event" : "events"}
            </span>
          </div>
          <CardDescription className="text-xs">
            Chronological thread of LinkedIn and email messages exchanged with {contactName}.
          </CardDescription>
        </CardHeader>

        <CardContent className="p-6 space-y-4">
          {interactions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 rounded-xl border border-dashed border-border/60 bg-muted/10 text-muted-foreground text-center space-y-2">
              <MessageSquare className="h-9 w-9 opacity-30" />
              <p className="text-sm font-medium text-foreground">No messages yet.</p>
              <p className="text-xs text-muted-foreground/75 max-w-sm">
                Inbound messages and bot outreach interactions will be logged here as they occur.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {interactions.map((interaction) => {
                const isOutbound = (interaction.direction || "").toLowerCase() === "outbound";
                const eventTime = interaction.event_at || interaction.created_at;

                return (
                  <div
                    key={interaction.id}
                    className={`flex ${isOutbound ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[82%] sm:max-w-[75%] rounded-2xl p-4 shadow-sm space-y-2 text-xs ${
                        isOutbound
                          ? "rounded-br-sm bg-primary text-primary-foreground"
                          : "rounded-bl-sm bg-muted text-foreground border border-border/60"
                      }`}
                    >
                      {/* Meta header inside bubble */}
                      <div
                        className={`flex items-center justify-between gap-4 text-[11px] pb-1 border-b ${
                          isOutbound
                            ? "border-primary-foreground/20 text-primary-foreground/80"
                            : "border-border/60 text-muted-foreground"
                        }`}
                      >
                        <span className="font-semibold">
                          {isOutbound ? "You (Outbound)" : `${contactName} (Inbound)`}
                          {interaction.channel && (
                            <span className="ml-1 opacity-80 uppercase text-[9px] font-mono">
                              • {interaction.channel}
                            </span>
                          )}
                        </span>
                        <span className="flex items-center gap-1 font-mono text-[10px] shrink-0">
                          <Clock className="h-3 w-3 opacity-70" />
                          {formatDateTime(eventTime)}
                        </span>
                      </div>

                      {/* Message text */}
                      <p className="whitespace-pre-wrap leading-relaxed">
                        {interaction.message_summary || "(No text content)"}
                      </p>

                      {/* Verification / Evidence footer */}
                      {interaction.verification && (
                        <div
                          className={`pt-1 text-[10px] font-mono flex items-center justify-between ${
                            isOutbound ? "opacity-75" : "text-muted-foreground"
                          }`}
                        >
                          <span>Status: {interaction.verification}</span>
                          {interaction.evidence_source && (
                            <span className="opacity-75">{interaction.evidence_source}</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Open Proposals Section (at bottom of same thread) */}
      <Card className="border border-border shadow-sm">
        <CardHeader className="border-b pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-primary" />
              <CardTitle className="text-base font-semibold">Open Proposals</CardTitle>
            </div>
            <span className="text-xs text-muted-foreground">
              {proposals.length} {proposals.length === 1 ? "draft" : "drafts"}
            </span>
          </div>
          <CardDescription className="text-xs">
            Review, edit, and approve pending message drafts before the outreach bot dispatches them.
          </CardDescription>
        </CardHeader>

        <CardContent className="p-6">
          {proposals.length === 0 ? (
            <div className="text-center py-10 px-4 rounded-xl border border-dashed border-border/60 bg-muted/10 text-muted-foreground space-y-1">
              <Bot className="h-7 w-7 mx-auto mb-2 opacity-30" />
              <p className="text-xs font-medium text-foreground">No proposals waiting.</p>
              <p className="text-[11px] text-muted-foreground/75">
                The bot will generate new proposals when high-signal recruiter events are detected.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {proposals.map((proposal) => {
                const isLinkedIn = (proposal.channel || "").toLowerCase() === "linkedin";
                const isGmail = (proposal.channel || "").toLowerCase() === "gmail";
                const isApproved = proposal.state === "approved_for_send";
                const isPending = proposal.state === "pending_approval";
                const resolving = isResolving[proposal.id] || false;
                const draftFeedback = feedback[proposal.id];
                const isCopied = copiedId === proposal.id;
                const currentText = proposalTexts[proposal.id] ?? (proposal.approved_text || proposal.proposed_text);

                return (
                  <div
                    key={proposal.id}
                    className="p-5 rounded-xl border border-border bg-card space-y-4 shadow-sm"
                  >
                    {/* Header info */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Channel badge */}
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-full font-semibold border ${
                            isLinkedIn
                              ? "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/20"
                              : isGmail
                              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20"
                              : "bg-muted text-muted-foreground border-border"
                          }`}
                        >
                          {isLinkedIn ? (
                            <Linkedin className="h-3 w-3 text-sky-600" />
                          ) : (
                            <Mail className="h-3 w-3 text-emerald-600" />
                          )}
                          <span className="capitalize">{proposal.channel}</span>
                        </span>

                        <span className="text-[11px] px-2 py-0.5 rounded bg-muted text-foreground font-mono">
                          {proposal.action_type}
                        </span>

                        <span className="text-[11px] text-muted-foreground flex items-center gap-1 font-mono">
                          <Clock className="h-3 w-3" />
                          {formatDateTime(proposal.created_at)}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleCopy(proposal.id, currentText)}
                          className="h-7 text-xs gap-1 border-border text-foreground hover:bg-muted"
                        >
                          <Copy className="h-3 w-3" />
                          <span>{isCopied ? "Copied!" : "Copy"}</span>
                        </Button>

                        {contact.linkedin_url && (
                          <a
                            href={contact.linkedin_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 px-2.5 py-1 rounded border border-border text-muted-foreground hover:text-foreground transition-colors font-medium text-[11px] h-7 bg-background"
                          >
                            <Linkedin className="h-3 w-3 text-sky-600" />
                            <span>Open Profile</span>
                            <ExternalLink className="h-2.5 w-2.5 opacity-60" />
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Trigger signal */}
                    {proposal.signal && (
                      <div className="p-3 rounded-lg bg-muted/40 border text-xs text-muted-foreground space-y-0.5">
                        <span className="font-semibold text-foreground">Trigger Signal: </span>
                        <span>{proposal.signal}</span>
                      </div>
                    )}

                    {/* Editable textarea */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">Proposed Message:</span>
                        <span className="font-mono text-[10px]">
                          {currentText.length} characters
                        </span>
                      </div>
                      <textarea
                        value={currentText}
                        onChange={(e) =>
                          setProposalTexts((prev) => ({
                            ...prev,
                            [proposal.id]: e.target.value,
                          }))
                        }
                        rows={4}
                        disabled={resolving || isApproved}
                        className="w-full p-3 text-xs rounded-lg border border-input bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-y disabled:opacity-80"
                        placeholder="Type proposed message..."
                      />
                    </div>

                    {/* Approved banner */}
                    {isApproved && (
                      <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 font-semibold text-xs">
                        <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        <span>Approved. Bot will send.</span>
                      </div>
                    )}

                    {/* Feedback alert (if any) */}
                    {draftFeedback && !isApproved && (
                      <div
                        className={`text-xs px-3 py-2 rounded-lg flex items-center gap-2 ${
                          draftFeedback.type === "success"
                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20"
                            : "bg-red-500/10 text-red-700 dark:text-red-300 border border-red-500/20"
                        }`}
                      >
                        {draftFeedback.type === "success" ? (
                          <Check className="h-3.5 w-3.5 shrink-0" />
                        ) : (
                          <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                        )}
                        <span>{draftFeedback.text}</span>
                      </div>
                    )}

                    {/* Action buttons for pending proposal */}
                    {isPending && (
                      <div className="flex items-center gap-2 pt-2 border-t border-border/40">
                        <Button
                          size="sm"
                          disabled={resolving}
                          onClick={() => handleApproveProposal(proposal)}
                          className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 font-medium shadow-sm"
                        >
                          {resolving ? (
                            <RotateCw className="h-3.5 w-3.5 animate-spin mr-1" />
                          ) : (
                            <Check className="h-3.5 w-3.5" />
                          )}
                          <span>Approve</span>
                        </Button>

                        <Button
                          size="sm"
                          variant="outline"
                          disabled={resolving}
                          onClick={() => handleRejectProposal(proposal.id)}
                          className="h-8 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/20 gap-1.5 font-medium border-border"
                        >
                          <X className="h-3.5 w-3.5" />
                          <span>Reject</span>
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
