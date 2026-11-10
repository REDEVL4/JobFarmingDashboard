import React from "react";
import {
  fetchOutreachConversations,
  fetchContactOutreachThread,
} from "@/lib/data-service";
import { OutreachInbox } from "@/components/outreach/outreach-inbox";

export const dynamic = "force-dynamic";

export default async function OutreachPage() {
  const conversationsResult = await fetchOutreachConversations();
  const conversations = conversationsResult.data || [];

  if (conversations.length === 0) {
    return (
      <OutreachInbox
        conversations={[]}
        selectedContactId={null}
        selectedContact={null}
        initialInteractions={[]}
        initialProposals={[]}
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
    />
  );
}
