"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  Users,
  ShieldAlert,
  Building,
  Check,
  X,
  ExternalLink,
  Lock,
  Inbox,
  Linkedin,
  MessageSquare,
  Bot,
  Copy,
  RotateCw,
  Mail,
  Sparkles,
  FileText,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { OutreachStats, OutreachProposal, DataFetchStatus } from "@/types/dashboard";
import type { DbOutreachContact } from "@/types/database";

interface OutreachClientProps {
  initialStats: OutreachStats;
  initialProposals?: OutreachProposal[];
  status: DataFetchStatus;
  error: string | null;
}

export function OutreachClient({ initialStats, initialProposals = [], status, error }: OutreachClientProps) {
  const [contacts, setContacts] = useState<DbOutreachContact[]>(initialStats.contacts || []);
  const [proposals, setProposals] = useState<OutreachProposal[]>(initialProposals);
  const [proposalTexts, setProposalTexts] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    (initialProposals || []).forEach((p) => {
      map[p.id] = p.approved_text || p.proposed_text || "";
    });
    return map;
  });
  const [resolvingProposalId, setResolvingProposalId] = useState<string | null>(null);
  const [copiedProposalId, setCopiedProposalId] = useState<string | null>(null);
  const [proposalFeedback, setProposalFeedback] = useState<{ id: string; type: "success" | "error"; text: string } | null>(null);
  const [activeFilter, setActiveFilter] = useState<string>("all");

  // Rewrite / Customize State for Bot Drafts
  const [customInstructions, setCustomInstructions] = useState<Record<string, string>>({});
  const [rewritingProposalIds, setRewritingProposalIds] = useState<Record<string, boolean>>({});
  const pollTimersRef = useRef<Record<string, NodeJS.Timeout>>({});

  useEffect(() => {
    return () => {
      Object.values(pollTimersRef.current).forEach((timer) => clearInterval(timer));
      pollTimersRef.current = {};
    };
  }, []);

  const pendingCount = contacts.filter((c) => c.status === "draft_pending_approval").length;
  const approvedCount = contacts.filter((c) => c.status === "approved").length;

  const handleApprove = (id: string) => {
    // Client-side state transition in preview mode (read-only safe)
    setContacts((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status: "approved" as const } : c))
    );
  };

  const handleReject = (id: string) => {
    setContacts((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status: "rejected" as const } : c))
    );
  };

  const handleApproveProposal = async (proposal: OutreachProposal) => {
    setResolvingProposalId(proposal.id);
    setProposalFeedback(null);
    const textToApprove = proposalTexts[proposal.id] ?? proposal.proposed_text;

    try {
      const res = await fetch("/api/outreach/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: proposal.id,
          action: "approve",
          approved_text: textToApprove,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setProposalFeedback({
          id: proposal.id,
          type: "error",
          text: data.error || "Failed to approve proposal.",
        });
      } else {
        const updated = data.data as OutreachProposal;
        setProposals((prev) =>
          prev.map((p) => (p.id === proposal.id ? updated : p))
        );
        setProposalFeedback({
          id: proposal.id,
          type: "success",
          text:
            updated.state === "queued"
              ? "Approved. Queued for scheduled dispatch."
              : "Approved. Draft ready for review and copy.",
        });
      }
    } catch (err: any) {
      setProposalFeedback({
        id: proposal.id,
        type: "error",
        text: err?.message || "Network error occurred.",
      });
    } finally {
      setResolvingProposalId(null);
    }
  };

  const handleRejectProposal = async (proposalId: string) => {
    setResolvingProposalId(proposalId);
    setProposalFeedback(null);

    try {
      const res = await fetch("/api/outreach/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: proposalId,
          action: "reject",
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setProposalFeedback({
          id: proposalId,
          type: "error",
          text: data.error || "Failed to reject proposal.",
        });
      } else {
        const updated = data.data as OutreachProposal;
        setProposals((prev) =>
          prev.map((p) => (p.id === proposalId ? updated : p))
        );
        setProposalFeedback({
          id: proposalId,
          type: "success",
          text: "Proposal marked as rejected in database.",
        });
      }
    } catch (err: any) {
      setProposalFeedback({
        id: proposalId,
        type: "error",
        text: err?.message || "Network error occurred.",
      });
    } finally {
      setResolvingProposalId(null);
    }
  };

  const handleRegenerateProposal = async (proposal: OutreachProposal) => {
    const proposalId = proposal.id;
    if (rewritingProposalIds[proposalId] || resolvingProposalId === proposalId) return;

    setRewritingProposalIds((prev) => ({ ...prev, [proposalId]: true }));
    setProposalFeedback(null);

    const originalProposedText = proposal.proposed_text || "";
    const instruction =
      (customInstructions[proposalId] || "").trim() ||
      "regenerate, more natural, show curiosity";

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

      const res = await fetch(
        "https://mldtysploensrrulchdl.supabase.co/functions/v1/outreach-regenerate",
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            proposal_id: proposalId,
            instruction,
          }),
        }
      );

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        if (res.status === 401 || res.status === 403 || res.status === 404) {
          setProposalFeedback({
            id: proposalId,
            type: "error",
            text: errJson?.error || "Failed to trigger rewrite.",
          });
          setRewritingProposalIds((prev) => ({ ...prev, [proposalId]: false }));
          return;
        }
      }
    } catch (err: any) {
      console.error("[outreach-client] regenerate error:", err);
    }

    // 2-second polling loop up to 45 seconds
    const startTime = Date.now();
    const MAX_DURATION_MS = 45000;

    if (pollTimersRef.current[proposalId]) {
      clearInterval(pollTimersRef.current[proposalId]);
      delete pollTimersRef.current[proposalId];
    }

    const checkProposal = async () => {
      const elapsed = Date.now() - startTime;
      if (elapsed >= MAX_DURATION_MS) {
        if (pollTimersRef.current[proposalId]) {
          clearInterval(pollTimersRef.current[proposalId]);
          delete pollTimersRef.current[proposalId];
        }
        setRewritingProposalIds((prev) => ({ ...prev, [proposalId]: false }));
        return;
      }

      try {
        const pollRes = await fetch(`/api/outreach/proposals?id=${proposalId}`);
        if (!pollRes.ok) return;

        const pollJson = await pollRes.json();
        const updated = pollJson.data;

        if (updated && updated.id === proposalId) {
          if (updated.proposed_text && updated.proposed_text !== originalProposedText) {
            if (pollTimersRef.current[proposalId]) {
              clearInterval(pollTimersRef.current[proposalId]);
              delete pollTimersRef.current[proposalId];
            }

            setProposalTexts((prev) => ({
              ...prev,
              [proposalId]: updated.proposed_text,
            }));

            setProposals((prev) =>
              prev.map((p) =>
                p.id === proposalId ? { ...p, proposed_text: updated.proposed_text } : p
              )
            );

            setRewritingProposalIds((prev) => ({ ...prev, [proposalId]: false }));
          }
        }
      } catch (pollErr) {
        console.error("[outreach-client] poll error:", pollErr);
      }
    };

    pollTimersRef.current[proposalId] = setInterval(checkProposal, 2000);
  };

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedProposalId(id);
      setTimeout(() => setCopiedProposalId(null), 2500);
    } catch {
      // Fallback
    }
  };

  const filteredContacts = contacts.filter((c) => {
    if (activeFilter === "pending") return c.status === "draft_pending_approval";
    if (activeFilter === "approved") return c.status === "approved";
    return true;
  });

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Users className="h-6 w-6 text-brand-500" />
            LinkedIn Outreach CRM & Relationship Manager
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Human-in-the-loop networking queue: personalize, score, and approve recruiter & hiring manager connection notes.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 text-xs font-semibold">
            <Lock className="h-3.5 w-3.5" />
            <span>Strict Approval Gate (No Auto-Send)</span>
          </div>
        </div>
      </div>

      {/* Honest Error Notice */}
      {status !== "success" && status !== "empty" && (
        <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400 space-y-1.5">
          <div className="flex items-center gap-2 font-bold text-sm">
            <ShieldAlert className="h-5 w-5 shrink-0" />
            <span>
              {status === "unauthenticated"
                ? "Owner Authentication Required"
                : status === "permission_denied"
                ? "Outreach Query Permission Denied (RLS Boundary)"
                : "Database Connection Failure"}
            </span>
          </div>
          <p className="text-xs leading-relaxed">{error}</p>
        </div>
      )}

      {/* Safety Gate Alert */}
      <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/5 text-xs text-muted-foreground flex items-start gap-3">
        <ShieldAlert className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-bold text-foreground">Outreach Safety Policy: Draft & Review Only</p>
          <p>
            Per system constraints, automated dispatch is disabled. Every connection note is created in <code className="bg-muted px-1 py-0.5 rounded font-mono">draft_pending_approval</code>.
            Once you approve, notes must be dispatched manually from your signed-in browser session.
          </p>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 space-y-1">
            <span className="text-xs font-semibold text-muted-foreground">Prospects Identified</span>
            <div className="text-2xl font-bold text-foreground">{contacts.length}</div>
            <p className="text-[11px] text-muted-foreground">Real prospects in database</p>
          </CardContent>
        </Card>

        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-4 space-y-1">
            <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">Pending Approval</span>
            <div className="text-2xl font-bold text-amber-700 dark:text-amber-400">{pendingCount}</div>
            <p className="text-[11px] text-muted-foreground">Require your review</p>
          </CardContent>
        </Card>

        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="p-4 space-y-1">
            <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">Approved for Dispatch</span>
            <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{approvedCount}</div>
            <p className="text-[11px] text-muted-foreground">Ready for manual send</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-1">
            <span className="text-xs font-semibold text-muted-foreground">Sent & In Conversation</span>
            <div className="text-2xl font-bold text-foreground">0</div>
            <p className="text-[11px] text-muted-foreground">Active dialogs</p>
          </CardContent>
        </Card>
      </div>

      {/* Prospect Review Queue */}
      <Card>
        <CardHeader className="border-b pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base font-semibold">Outreach Review Queue</CardTitle>
              <CardDescription className="text-xs">
                Personalized notes tailored to each prospect&apos;s recent hiring posts (under 300 characters)
              </CardDescription>
            </div>
            <div className="flex items-center gap-1.5 bg-muted p-0.5 rounded-lg text-xs">
              <Button
                variant={activeFilter === "all" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setActiveFilter("all")}
                className="h-7 text-xs font-medium"
              >
                All ({contacts.length})
              </Button>
              <Button
                variant={activeFilter === "pending" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setActiveFilter("pending")}
                className="h-7 text-xs font-medium"
              >
                Pending ({pendingCount})
              </Button>
              <Button
                variant={activeFilter === "approved" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setActiveFilter("approved")}
                className="h-7 text-xs font-medium"
              >
                Approved ({approvedCount})
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {filteredContacts.length === 0 ? (
            <div className="p-12 text-center space-y-2">
              <Inbox className="h-8 w-8 text-muted-foreground mx-auto" />
              <p className="text-sm font-semibold text-foreground">No Outreach Contacts</p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                No prospect records matching the selected filter were returned from the database.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filteredContacts.map((contact, idx) => (
                <div key={contact.id} className="p-5 hover:bg-muted/30 transition-colors space-y-4 text-xs">
                  {/* Contact Card Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          href={`/outreach/${contact.id}`}
                          className="font-bold text-sm text-foreground hover:text-primary hover:underline transition-colors"
                        >
                          #{idx + 1} {contact.name}
                        </Link>
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider bg-brand-500/10 text-brand-600 dark:text-brand-400">
                          {contact.contact_type}
                        </span>
                        {contact.score && (
                          <span className="text-[10px] px-2 py-0.5 rounded font-bold bg-muted text-foreground">
                            Fit Score: {contact.score}/100
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Building className="h-3.5 w-3.5" />
                        <span>{contact.company}</span>
                        <span>•</span>
                        <span>{contact.role}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {contact.linkedin_url && (
                        <a
                          href={contact.linkedin_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 px-2.5 py-1 rounded border text-muted-foreground hover:text-foreground transition-colors font-medium text-[11px]"
                        >
                          <Linkedin className="h-3 w-3 text-sky-600" />
                          <span>View Profile</span>
                          <ExternalLink className="h-2.5 w-2.5 opacity-60" />
                        </a>
                      )}

                      {contact.status === "approved" ? (
                        <span className="flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-500/10 text-emerald-600 font-semibold text-[11px]">
                          <Check className="h-3.5 w-3.5" />
                          Approved
                        </span>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleReject(contact.id)}
                            className="h-7 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/20"
                          >
                            <X className="h-3.5 w-3.5 mr-1" />
                            Reject
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => handleApprove(contact.id)}
                            className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                          >
                            <Check className="h-3.5 w-3.5 mr-1" />
                            Approve Note
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Personalized Connection Note */}
                  <div className="space-y-1.5 bg-muted/40 p-3.5 rounded-lg border">
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span className="font-semibold text-foreground flex items-center gap-1.5">
                        <MessageSquare className="h-3.5 w-3.5 text-brand-500" />
                        Connection Request Note
                      </span>
                      <span
                        className={`font-mono text-[10px] ${
                          (contact.connection_note?.length || 0) > 300
                            ? "text-rose-600 font-bold"
                            : "text-muted-foreground"
                        }`}
                      >
                        {contact.connection_note?.length || 0}/300 chars
                      </span>
                    </div>
                    <p className="text-foreground leading-relaxed text-xs font-normal">
                      &quot;{contact.connection_note}&quot;
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bot Drafts Section */}
      <Card>
        <CardHeader className="border-b pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Bot className="h-4 w-4 text-purple-500" />
                Bot drafts ({proposals.length})
              </CardTitle>
              <CardDescription className="text-xs">
                Drafts generated by the LinkedIn Bot. Review and edit before approval.
              </CardDescription>
            </div>
            <span className="text-[11px] px-2.5 py-1 rounded bg-muted text-muted-foreground font-mono">
              Strict Gate • No Auto-Send
            </span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {proposals.length === 0 ? (
            <div className="p-12 text-center space-y-2">
              <Inbox className="h-8 w-8 text-muted-foreground mx-auto" />
              <p className="text-sm font-semibold text-foreground">No drafts waiting</p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                No drafts waiting. The bot only writes one when a new LinkedIn notification arrives.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {proposals.map((proposal) => {
                const isResolving = resolvingProposalId === proposal.id;
                const feedback = proposalFeedback?.id === proposal.id ? proposalFeedback : null;
                const isDraftReady = proposal.state === "draft_ready";
                const isQueued = proposal.state === "queued";
                const isRejected = proposal.state === "rejected";
                const isPending = proposal.state === "pending_approval";
                const isCopied = copiedProposalId === proposal.id;

                const isGmail = (proposal.channel || "").toLowerCase() === "gmail";
                const badgeText = isGmail ? "Will send on approve" : "Draft only";

                return (
                  <div key={proposal.id} className="p-5 hover:bg-muted/30 transition-colors space-y-4 text-xs">
                    {/* Header */}
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm text-foreground">
                            {proposal.target_name || "Unknown Target"}
                          </span>
                          {/* Channel Badge */}
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${
                              isGmail
                                ? "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20"
                                : "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20"
                            }`}
                          >
                            {badgeText}
                          </span>
                          {/* State Badges */}
                          {isDraftReady && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 flex items-center gap-1">
                              <Check className="h-3 w-3" /> Draft Ready
                            </span>
                          )}
                          {isQueued && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-blue-500/10 text-blue-600 border border-blue-500/20 flex items-center gap-1">
                              <Check className="h-3 w-3" /> Queued for Send
                            </span>
                          )}
                          {isRejected && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-zinc-500/10 text-zinc-600 border border-zinc-500/20 flex items-center gap-1">
                              <X className="h-3 w-3" /> Rejected
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 text-muted-foreground flex-wrap">
                          {proposal.target_company && (
                            <span className="flex items-center gap-1">
                              <Building className="h-3.5 w-3.5" />
                              {proposal.target_company}
                            </span>
                          )}
                          {proposal.target_title && (
                            <>
                              <span>•</span>
                              <span>{proposal.target_title}</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Header Actions for draft_ready */}
                      <div className="flex items-center gap-2">
                        {isDraftReady && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleCopy(proposal.id, proposalTexts[proposal.id] || proposal.proposed_text)}
                              className="h-7 text-xs gap-1 border-primary/30 text-primary hover:bg-primary/10"
                            >
                              <Copy className="h-3 w-3" />
                              <span>{isCopied ? "Copied!" : "Copy"}</span>
                            </Button>

                            {proposal.linkedin_url && (
                              <a
                                href={proposal.linkedin_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 px-2.5 py-1 rounded border text-muted-foreground hover:text-foreground transition-colors font-medium text-[11px] h-7"
                              >
                                <Linkedin className="h-3 w-3 text-sky-600" />
                                <span>Open</span>
                                <ExternalLink className="h-2.5 w-2.5 opacity-60" />
                              </a>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    {/* Signal / Trigger Context */}
                    {proposal.signal && (
                      <div className="p-2.5 rounded-lg bg-muted/40 border text-[11px] text-muted-foreground">
                        <span className="font-semibold text-foreground">Trigger Signal: </span>
                        {proposal.signal}
                      </div>
                    )}

                    {/* Editable Textarea */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <span className="font-medium text-foreground flex items-center gap-1.5">
                          <span>Draft Message Text:</span>
                          {rewritingProposalIds[proposal.id] && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 animate-pulse">
                              <RotateCw className="h-2.5 w-2.5 animate-spin" />
                              Rewriting...
                            </span>
                          )}
                        </span>
                        <span className="font-mono text-[10px]">
                          {(proposalTexts[proposal.id] ?? proposal.proposed_text).length} chars
                        </span>
                      </div>
                      <textarea
                        value={proposalTexts[proposal.id] ?? proposal.proposed_text}
                        onChange={(e) =>
                          setProposalTexts((prev) => ({
                            ...prev,
                            [proposal.id]: e.target.value,
                          }))
                        }
                        rows={3}
                        disabled={isResolving || !isPending || rewritingProposalIds[proposal.id]}
                        className="w-full p-2.5 text-xs rounded-lg border border-input bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-y disabled:opacity-75"
                        placeholder="Proposed outreach text..."
                      />

                      {proposal.attachment_path && (
                        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border/80 bg-muted/40 text-xs text-foreground/90 w-fit max-w-full">
                          <FileText className="h-4 w-4 text-primary shrink-0" />
                          {proposal.action_type === "resume_share" && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20 shrink-0">
                              Resume attached
                            </span>
                          )}
                          <span
                            className="font-medium text-xs truncate max-w-[220px] sm:max-w-xs"
                            title={proposal.attachment_path.split("/").pop()}
                          >
                            {proposal.attachment_path.split("/").pop()}
                          </span>
                          <a
                            href={`/api/outreach/attachment-url?path=${encodeURIComponent(proposal.attachment_path)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-background hover:bg-muted border border-input text-foreground transition-colors shrink-0 ml-1"
                            title="Open attached document"
                          >
                            <span>Open</span>
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      )}
                    </div>

                    {/* Feedback alert */}
                    {feedback && (
                      <div
                        className={`text-xs px-3 py-1.5 rounded flex items-center gap-2 ${
                          feedback.type === "success"
                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20"
                            : "bg-red-500/10 text-red-700 dark:text-red-300 border border-red-500/20"
                        }`}
                      >
                        {feedback.type === "success" ? <Check className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
                        <span>{feedback.text}</span>
                      </div>
                    )}

                    {/* Action Buttons for Pending */}
                    {isPending && (
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-1 border-t border-border/40">
                        {/* Customize & Regenerate Controls */}
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          <label
                            htmlFor={`customize-${proposal.id}`}
                            className="text-[11px] font-semibold text-muted-foreground shrink-0"
                          >
                            Customize
                          </label>
                          <input
                            id={`customize-${proposal.id}`}
                            type="text"
                            placeholder="more natural, show curiosity"
                            value={customInstructions[proposal.id] || ""}
                            onChange={(e) =>
                              setCustomInstructions((prev) => ({
                                ...prev,
                                [proposal.id]: e.target.value,
                              }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleRegenerateProposal(proposal);
                              }
                            }}
                            disabled={isResolving || rewritingProposalIds[proposal.id]}
                            className="h-7 px-2.5 text-xs bg-background border border-input rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring flex-1 max-w-xs transition-colors disabled:opacity-50"
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={isResolving || rewritingProposalIds[proposal.id]}
                            onClick={() => handleRegenerateProposal(proposal)}
                            className="h-7 text-xs font-medium gap-1 px-2.5 border-border text-foreground hover:bg-muted shrink-0 cursor-pointer disabled:cursor-not-allowed"
                            title="Regenerate proposal draft"
                          >
                            {rewritingProposalIds[proposal.id] ? (
                              <RotateCw className="h-3 w-3 animate-spin" />
                            ) : (
                              <Sparkles className="h-3 w-3 text-amber-500" />
                            )}
                            <span>{rewritingProposalIds[proposal.id] ? "Rewriting..." : "Regenerate"}</span>
                          </Button>
                        </div>

                        {/* Approve & Reject Controls */}
                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            size="sm"
                            disabled={isResolving || rewritingProposalIds[proposal.id]}
                            onClick={() => handleApproveProposal(proposal)}
                            className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white gap-1 cursor-pointer disabled:cursor-not-allowed"
                          >
                            {isResolving ? (
                              <RotateCw className="h-3.5 w-3.5 animate-spin mr-1" />
                            ) : (
                              <Check className="h-3.5 w-3.5" />
                            )}
                            <span>Approve</span>
                          </Button>

                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isResolving || rewritingProposalIds[proposal.id]}
                            onClick={() => handleRejectProposal(proposal.id)}
                            className="h-7 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/20 gap-1 border-border cursor-pointer disabled:cursor-not-allowed"
                          >
                            <X className="h-3.5 w-3.5" />
                            <span>Reject</span>
                          </Button>
                        </div>
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

