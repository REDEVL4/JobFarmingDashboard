import React from "react";
import {
  fetchOutreachConversations,
  fetchContactOutreachThread,
} from "@/lib/data-service";
import { OutreachInbox } from "@/components/outreach/outreach-inbox";

export const dynamic = "force-dynamic";

interface ContactThreadPageProps {
  params: Promise<{ contactId: string }>;
}

export default async function ContactThreadPage({ params }: ContactThreadPageProps) {
  const { contactId } = await params;

  const [conversationsResult, threadResult] = await Promise.all([
    fetchOutreachConversations(),
    fetchContactOutreachThread(contactId),
  ]);

  return (
    <OutreachInbox
      conversations={conversationsResult.data || []}
      selectedContactId={contactId}
      selectedContact={threadResult.data.contact}
      initialInteractions={threadResult.data.interactions}
      initialProposals={threadResult.data.proposals}
    />
  );
}
