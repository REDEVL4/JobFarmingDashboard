import test from "node:test";
import assert from "node:assert/strict";

// Import helper once created, or test specification first
import {
  getInteractionStatus,
  isDeletionMarkerNote,
  isDeletedOnLinkedInProposal,
  matchProposalToInteraction,
  buildOutreachTimeline,
} from "../../src/lib/outreach-helpers.ts";

test("Interaction Status: detects deleted message by is_deleted or deleted flags", () => {
  assert.equal(getInteractionStatus({ is_deleted: true }), "deleted");
  assert.equal(getInteractionStatus({ deleted: true }), "deleted");
  assert.equal(getInteractionStatus({ deleted_on_linkedin: true }), "deleted");
  assert.equal(getInteractionStatus({ deleted_on_linkedin: "true" }), "deleted");
  assert.equal(getInteractionStatus({ deleted_at: "2026-11-15T00:00:00Z" }), "deleted");
});

test("Interaction Status: detects deleted message by event_type or status", () => {
  assert.equal(getInteractionStatus({ event_type: "message_deleted" }), "deleted");
  assert.equal(getInteractionStatus({ event_type: "deleted" }), "deleted");
  assert.equal(getInteractionStatus({ event_type: "deleted_on_linkedin" }), "deleted");
  assert.equal(getInteractionStatus({ status: "deleted" }), "deleted");
  assert.equal(getInteractionStatus({ status: "deleted_on_linkedin" }), "deleted");
});

test("Interaction Status: detects deleted message by notes, evidence_source or evidence_ref", () => {
  assert.equal(getInteractionStatus({ notes: "Message deleted by sender" }), "deleted");
  assert.equal(getInteractionStatus({ notes: "marked deleted_on_linkedin" }), "deleted");
  assert.equal(getInteractionStatus({ evidence_source: "linkedin_deleted_event" }), "deleted");
  assert.equal(getInteractionStatus({ evidence_source: "deleted_on_linkedin" }), "deleted");
  assert.equal(getInteractionStatus({ evidence_ref: "msg:deleted:123" }), "deleted");
  assert.equal(getInteractionStatus({ custom_metadata: "flagged deleted_on_linkedin" }), "deleted");
  assert.equal(getInteractionStatus({ deleted_on_linkedin_at: "2026-11-15T02:00:00Z" }), "deleted");
});

test("Interaction Status: detects LinkedIn deletion summary text", () => {
  assert.equal(getInteractionStatus({ message_summary: "This message was deleted" }), "deleted");
  assert.equal(getInteractionStatus({ message_summary: "This message has been deleted" }), "deleted");
  assert.equal(getInteractionStatus({ message_summary: "Message deleted" }), "deleted");
  assert.equal(getInteractionStatus({ message_summary: "[Message deleted]" }), "deleted");
});

test("Interaction Status: detects edited message by is_edited, edited or edited_at", () => {
  assert.equal(getInteractionStatus({ is_edited: true }), "edited");
  assert.equal(getInteractionStatus({ edited: true }), "edited");
  assert.equal(getInteractionStatus({ edited_on_linkedin: true }), "edited");
  assert.equal(getInteractionStatus({ edited_on_linkedin: "true" }), "edited");
  assert.equal(getInteractionStatus({ edited_at: "2026-11-15T01:00:00Z" }), "edited");
});

test("Interaction Status: detects edited message by event_type or status", () => {
  assert.equal(getInteractionStatus({ event_type: "message_edited" }), "edited");
  assert.equal(getInteractionStatus({ event_type: "edited" }), "edited");
  assert.equal(getInteractionStatus({ event_type: "edited_on_linkedin" }), "edited");
  assert.equal(getInteractionStatus({ status: "edited" }), "edited");
  assert.equal(getInteractionStatus({ status: "edited_on_linkedin" }), "edited");
});

test("Interaction Status: detects edited message by notes, evidence or suffix", () => {
  assert.equal(getInteractionStatus({ notes: "Message edited on LinkedIn" }), "edited");
  assert.equal(getInteractionStatus({ notes: "marked edited_on_linkedin" }), "edited");
  assert.equal(getInteractionStatus({ evidence_source: "edited_on_linkedin" }), "edited");
  assert.equal(getInteractionStatus({ custom_metadata: "flagged edited_on_linkedin" }), "edited");
  assert.equal(getInteractionStatus({ edited_on_linkedin_at: "2026-11-15T02:00:00Z" }), "edited");
  assert.equal(getInteractionStatus({ message_summary: "Hey there! (edited)" }), "edited");
  assert.equal(getInteractionStatus({ message_summary: "[Message edited]" }), "edited");
});

test("Interaction Status: returns null for standard unedited/undeleted messages", () => {
  assert.equal(getInteractionStatus({ message_summary: "Hi, thanks for reaching out!" }), null);
  assert.equal(getInteractionStatus({ event_type: "message_received" }), null);
  assert.equal(getInteractionStatus(null), null);
});

test("Deletion Note: identifies marker notes that should be hidden", () => {
  assert.equal(
    isDeletionMarkerNote({ event_type: "note", message_summary: "deleted_on_linkedin" }),
    true
  );
  assert.equal(
    isDeletionMarkerNote({ external_key: "deleted|urn:li:msg:123" }),
    true
  );
  assert.equal(
    isDeletionMarkerNote({ event_type: "note", notes: "marked deleted_on_linkedin" }),
    true
  );
  assert.equal(
    isDeletionMarkerNote({ event_type: "note", message_summary: "Candidate interested in remote roles" }),
    false
  );
  assert.equal(
    isDeletionMarkerNote({ event_type: "message_sent", message_summary: "Hi Sarah" }),
    false
  );
  assert.equal(isDeletionMarkerNote(null), false);
});

test("Deleted Proposal: identifies proposals where state = sent and error = deleted_on_linkedin", () => {
  assert.equal(
    isDeletedOnLinkedInProposal({ state: "sent", error: "deleted_on_linkedin" }),
    true
  );
  assert.equal(
    isDeletedOnLinkedInProposal({ state: "sent", error: null }),
    false
  );
  assert.equal(
    isDeletedOnLinkedInProposal({ state: "pending_approval", error: "deleted_on_linkedin" }),
    false
  );
  assert.equal(isDeletedOnLinkedInProposal(null), false);
});

test("Timeline Builder: hides deletion note rows and marks deleted message in original slot without adding new rows", () => {
  const contactId = "contact_001";
  const sentTime = "2026-11-15T10:00:00Z";

  const interactions = [
    {
      id: "int_inbound_1",
      contact_id: contactId,
      event_type: "message_received",
      direction: "inbound",
      message_summary: "Hello! Are you open to discussing opportunities?",
      event_at: "2026-11-15T09:30:00Z",
    },
    {
      id: "int_sent_2",
      contact_id: contactId,
      event_type: "message_sent",
      direction: "outbound",
      message_summary: "Hi! Yes, I would love to connect about the role.",
      event_at: sentTime,
    },
    {
      id: "int_note_3",
      contact_id: contactId,
      event_type: "note",
      message_summary: "deleted_on_linkedin",
      external_key: "deleted|int_sent_2",
      event_at: "2026-11-15T10:15:00Z",
    },
    {
      id: "int_inbound_4",
      contact_id: contactId,
      event_type: "message_received",
      direction: "inbound",
      message_summary: "Sounds great, let me send over the spec.",
      event_at: "2026-11-15T11:00:00Z",
    },
  ];

  const proposals = [
    {
      id: "prop_sent_2",
      contact_id: contactId,
      state: "sent",
      error: "deleted_on_linkedin",
      proposed_text: "Hi! Yes, I would love to connect about the role.",
      sent_at: sentTime,
    },
  ];

  const timeline = buildOutreachTimeline(interactions, proposals);

  // 1. Deletion note (int_note_3) is hidden: total length is 3, not 4 or 5
  assert.equal(timeline.length, 3);
  assert.equal(timeline.some((item) => item.id === "int_note_3"), false);

  // 2. Sent message (int_sent_2) remains in its exact slot (index 1)
  assert.equal(timeline[1].id, "int_sent_2");
  assert.equal(timeline[1].deleted_on_linkedin, true);
  assert.equal(timeline[1].is_deleted, true);
  assert.equal(timeline[1].event_at, sentTime);
  assert.equal(
    timeline[1].original_text,
    "Hi! Yes, I would love to connect about the role."
  );

  // Status helper recognizes it as deleted
  assert.equal(getInteractionStatus(timeline[1]), "deleted");

  // 3. Other messages remain completely unchanged
  assert.equal(timeline[0].id, "int_inbound_1");
  assert.equal(timeline[0].message_summary, "Hello! Are you open to discussing opportunities?");
  assert.equal(getInteractionStatus(timeline[0]), null);

  assert.equal(timeline[2].id, "int_inbound_4");
  assert.equal(timeline[2].message_summary, "Sounds great, let me send over the spec.");
  assert.equal(getInteractionStatus(timeline[2]), null);
});

test("Proposal Matcher: matches by action_id when set", () => {
  const proposal = {
    id: "prop_99",
    action_id: "act_42",
    contact_id: "c_1",
    proposed_text: "Let's connect",
  };
  const interactions = [
    { id: "i_1", contact_id: "c_1", action_id: "act_42", message_summary: "Different text" },
    { id: "i_2", contact_id: "c_1", message_summary: "Let's connect" },
  ];
  const matched = matchProposalToInteraction(proposal, interactions);
  assert.equal(matched?.id, "i_1");
});

test("Proposal Matcher: matches by contact_id + sent_at time + text", () => {
  const proposal = {
    id: "prop_101",
    contact_id: "c_99",
    sent_at: "2026-11-15T14:00:00Z",
    proposed_text: "Great chatting earlier today!",
  };
  const interactions = [
    {
      id: "i_other_contact",
      contact_id: "c_other",
      event_type: "message_sent",
      direction: "outbound",
      message_summary: "Great chatting earlier today!",
      event_at: "2026-11-15T14:00:00Z",
    },
    {
      id: "i_matched",
      contact_id: "c_99",
      event_type: "message_sent",
      direction: "outbound",
      message_summary: "Great chatting earlier today!",
      event_at: "2026-11-15T14:00:05Z",
    },
    {
      id: "i_different_text",
      contact_id: "c_99",
      event_type: "message_sent",
      direction: "outbound",
      message_summary: "Different topic altogether",
      event_at: "2026-11-15T14:00:00Z",
    },
  ];
  const matched = matchProposalToInteraction(proposal, interactions);
  assert.equal(matched?.id, "i_matched");
});
