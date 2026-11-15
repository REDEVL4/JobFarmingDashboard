import test from "node:test";
import assert from "node:assert/strict";

// Import helper once created, or test specification first
import { getInteractionStatus } from "../../src/lib/outreach-helpers.ts";

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
  assert.equal(getInteractionStatus({ message_summary: "Hey there! (edited)" }), "edited");
  assert.equal(getInteractionStatus({ message_summary: "[Message edited]" }), "edited");
});

test("Interaction Status: returns null for standard unedited/undeleted messages", () => {
  assert.equal(getInteractionStatus({ message_summary: "Hi, thanks for reaching out!" }), null);
  assert.equal(getInteractionStatus({ event_type: "message_received" }), null);
  assert.equal(getInteractionStatus(null), null);
});
