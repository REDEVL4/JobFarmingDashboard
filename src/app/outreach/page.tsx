import React from "react";
import {
  fetchOutreachConversations,
  fetchContactOutreachThread,
  fetchOutreachSettings,
} from "@/lib/data-service";
import { OutreachInbox } from "@/components/outreach/outreach-inbox";

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

  if (conversations.length === 0) {
    return (
      <OutreachInbox
        conversations={[]}
        selectedContactId={null}
        selectedContact={null}
        initialInteractions={[]}
        initialProposals={[]}
        initialOutreachMode={settings.outreach_mode}
        initialAutoConnectionRequests={settings.auto_connection_requests}
        initialAutoAcceptConnections={settings.auto_accept_connections}
      />
    );
  }

  // Default to first conversation on desktop
  const firstContactId = conversations[0].id;
  const threadResult = await fetchContactOutreachThread(firstContactId);

  return (
    <OutreachInbox
      conversations={conversations}
      selectedContactId={firstContactId}
      selectedContact={threadResult.data.contact}
      initialInteractions={threadResult.data.interactions}
      initialProposals={threadResult.data.proposals}
      initialOutreachMode={settings.outreach_mode}
      initialAutoConnectionRequests={settings.auto_connection_requests}
      initialAutoAcceptConnections={settings.auto_accept_connections}
    />
  );
}
