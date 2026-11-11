import React from "react";
import {
  fetchOutreachConversations,
  fetchContactOutreachThread,
  fetchOutreachSettings,
} from "@/lib/data-service";
import { OutreachInbox } from "@/components/outreach/outreach-inbox";

export const dynamic = "force-dynamic";

interface ContactThreadPageProps {
  params: Promise<{ contactId: string }>;
}

export default async function ContactThreadPage({ params }: ContactThreadPageProps) {
  const { contactId } = await params;

  const [conversationsResult, threadResult, settingsResult] = await Promise.all([
    fetchOutreachConversations(),
    fetchContactOutreachThread(contactId),
    fetchOutreachSettings(),
  ]);

  const settings = settingsResult.data || {
    outreach_mode: "review",
    auto_connection_requests: false,
    auto_accept_connections: false,
  };

  return (
    <OutreachInbox
      conversations={conversationsResult.data || []}
      selectedContactId={contactId}
      selectedContact={threadResult.data.contact}
      initialInteractions={threadResult.data.interactions}
      initialProposals={threadResult.data.proposals}
      initialOutreachMode={settings.outreach_mode}
      initialAutoConnectionRequests={settings.auto_connection_requests}
      initialAutoAcceptConnections={settings.auto_accept_connections}
    />
  );
}
