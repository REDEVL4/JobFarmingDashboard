"use client";

import React, { useState } from "react";
import {
  Users,
  ShieldAlert,
  CheckCircle2,
  Clock,
  Send,
  Linkedin,
  MessageSquare,
  Building,
  Check,
  X,
  ExternalLink,
  Lock,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { INITIAL_OUTREACH_CONTACTS } from "@/lib/supabase/mock-data";
import type { DbOutreachContact } from "@/types/database";

export default function OutreachPage() {
  const [contacts, setContacts] = useState<DbOutreachContact[]>(INITIAL_OUTREACH_CONTACTS);
  const [activeFilter, setActiveFilter] = useState<string>("all");

  const pendingCount = contacts.filter((c) => c.status === "draft_pending_approval").length;
  const approvedCount = contacts.filter((c) => c.status === "approved").length;

  const handleApprove = (id: string) => {
    setContacts((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status: "approved" as const } : c))
    );
  };

  const handleReject = (id: string) => {
    setContacts((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status: "rejected" as const } : c))
    );
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
            <p className="text-[11px] text-muted-foreground">All at companies with applications</p>
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
              <CardTitle className="text-base font-semibold">Phase 1 Outreach Review Queue</CardTitle>
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
          <div className="divide-y divide-border">
            {filteredContacts.map((contact, idx) => (
              <div key={contact.id} className="p-5 hover:bg-muted/30 transition-colors space-y-4 text-xs">
                {/* Contact Card Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-foreground">
                        #{idx + 1} {contact.name}
                      </span>
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
                    {contact.status === "draft_pending_approval" ? (
                      <>
                        <Button
                          size="sm"
                          onClick={() => handleApprove(contact.id)}
                          className="h-8 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                        >
                          <Check className="h-3.5 w-3.5" />
                          <span>Approve Draft</span>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleReject(contact.id)}
                          className="h-8 text-xs gap-1 text-muted-foreground hover:text-rose-600"
                        >
                          <X className="h-3.5 w-3.5" />
                          <span>Dismiss</span>
                        </Button>
                      </>
                    ) : contact.status === "approved" ? (
                      <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold text-xs border border-emerald-500/20">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Approved for Manual Send
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Dismissed</span>
                    )}

                    {contact.linkedin_url && (
                      <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                        <a href={contact.linkedin_url} target="_blank" rel="noreferrer">
                          <Linkedin className="h-4 w-4 text-sky-600" />
                        </a>
                      </Button>
                    )}
                  </div>
                </div>

                {/* Connection Note Draft Box */}
                {contact.connection_note && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground font-semibold">
                      <span>Personalized Connection Note</span>
                      <span className="font-mono">{contact.connection_note.length} / 300 chars</span>
                    </div>
                    <div className="p-3.5 rounded-lg border bg-card text-foreground font-sans leading-relaxed">
                      &quot;{contact.connection_note}&quot;
                    </div>
                  </div>
                )}

                {/* Optional Follow-up DM */}
                {contact.follow_up_note && (
                  <div className="space-y-1.5">
                    <span className="text-[11px] text-muted-foreground font-semibold">
                      Follow-up DM (Send only after connection is accepted)
                    </span>
                    <div className="p-3 rounded-lg border bg-muted/40 text-muted-foreground font-sans leading-relaxed text-[11px]">
                      &quot;{contact.follow_up_note}&quot;
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

