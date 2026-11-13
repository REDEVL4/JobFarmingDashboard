import React from "react";
import {
  fetchOutreachConversations,
  fetchContactOutreachThread,
  fetchOutreachSettings,
} from "@/lib/data-service";
import { OutreachInbox } from "@/components/outreach/outreach-inbox";
import { Users, Lock, ShieldCheck, MessageSquare, Clock } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function OutreachPage() {
  const [conversationsResult, settingsResult] = await Promise.all([
    fetchOutreachConversations(),
    fetchOutreachSettings(),
  ]);

  const conversations = conversationsResult.data || [];
  const settings = settingsResult.data || {
    outreach_mode: "review",
    auto_connection_requests: false,
    auto_accept_connections: false,
  };

  const prospectsCount = conversations.length;
  const pendingCount = conversations.filter((c) => c.has_pending_proposal).length;
  const activeCount = conversations.filter((c) => c.last_message_preview).length;

  const defaultContactId = conversations.length > 0 ? conversations[0].id : null;
  const threadResult = defaultContactId
    ? await fetchContactOutreachThread(defaultContactId)
    : { data: { contact: null, interactions: [], proposals: [] } };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-3 border-b border-border/60">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <Users className="h-6 w-6 text-cyan-400" />
            LinkedIn Outreach CRM & Relationship Manager
          </h1>
          <p className="text-xs text-muted-foreground font-mono mt-1">
            Human-in-the-loop networking queue: review, personalize, and approve recruiter & hiring manager conversation threads.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-mono font-semibold">
            <Lock className="h-3.5 w-3.5" />
            <span>Strict Approval Gate (No Auto-Send)</span>
          </div>
        </div>
      </div>

      {/* Connection KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 font-mono text-xs">
        <div className="orbital-card rounded-xl p-4 space-y-1">
          <span className="text-muted-foreground text-[10px] uppercase block">Prospects Identified</span>
          <div className="text-2xl font-bold text-foreground tabular-nums">{prospectsCount}</div>
          <p className="text-[11px] text-muted-foreground">Real prospects in database</p>
        </div>

        <div className="orbital-card rounded-xl p-4 space-y-1 border-l-2 border-l-amber-400">
          <span className="text-amber-400 text-[10px] uppercase block font-semibold">Pending Approval</span>
          <div className="text-2xl font-bold text-amber-400 tabular-nums">{pendingCount}</div>
          <p className="text-[11px] text-muted-foreground">Require your review</p>
        </div>

        <div className="orbital-card rounded-xl p-4 space-y-1 border-l-2 border-l-cyan-400">
          <span className="text-cyan-400 text-[10px] uppercase block font-semibold">In Active Conversation</span>
          <div className="text-2xl font-bold text-foreground tabular-nums">{activeCount}</div>
          <p className="text-[11px] text-muted-foreground">Active dialogs</p>
        </div>

        <div className="orbital-card rounded-xl p-4 space-y-1 border-l-2 border-l-emerald-400">
          <span className="text-emerald-400 text-[10px] uppercase block font-semibold">Safety Protocol</span>
          <div className="text-sm font-bold text-foreground flex items-center gap-1.5 mt-1">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            <span>Manual Send Only</span>
          </div>
          <p className="text-[11px] text-muted-foreground">Zero automated dispatch</p>
        </div>
      </div>

      {/* Interactive Two-Pane Messaging Inbox */}
      <OutreachInbox
        conversations={conversations}
        selectedContactId={defaultContactId}
        selectedContact={threadResult.data.contact}
        initialInteractions={threadResult.data.interactions}
        initialProposals={threadResult.data.proposals}
        initialOutreachMode={settings.outreach_mode}
        initialAutoConnectionRequests={settings.auto_connection_requests}
        initialAutoAcceptConnections={settings.auto_accept_connections}
      />
    </div>
  );
}
