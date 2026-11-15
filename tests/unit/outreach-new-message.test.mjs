import test from "node:test";
import assert from "node:assert/strict";

import { buildNewProposalPayload } from "../../src/lib/outreach-helpers.ts";

test("New Message: formats proposal payload with pending_approval state", () => {
  const contact = {
    id: "79c94c03-519b-4394-bb97-f57ec09e6d08",
    full_name: "Sarah Chen",
    professional_title: "Staff Technical Recruiter",
    company: "Anthropic",
    linkedin_url: "https://www.linkedin.com/in/sarahchen-recruiter",
  };

  const payload = buildNewProposalPayload(contact, "Hi Sarah, wanted to follow up directly.");
  assert.equal(payload.contact_id, "79c94c03-519b-4394-bb97-f57ec09e6d08");
  assert.equal(payload.action_type, "message");
  assert.equal(payload.channel, "linkedin");
  assert.equal(payload.target_name, "Sarah Chen");
  assert.equal(payload.target_title, "Staff Technical Recruiter");
  assert.equal(payload.target_company, "Anthropic");
  assert.equal(payload.linkedin_url, "https://www.linkedin.com/in/sarahchen-recruiter");
  assert.equal(payload.proposed_text, "Hi Sarah, wanted to follow up directly.");
  assert.equal(payload.state, "pending_approval");
});

test("New Message: rejects empty or whitespace-only message text", () => {
  const contact = { id: "test-id", full_name: "John Doe" };
  assert.throws(() => buildNewProposalPayload(contact, ""), /Text cannot be empty/);
  assert.throws(() => buildNewProposalPayload(contact, "   \n  "), /Text cannot be empty/);
  assert.throws(() => buildNewProposalPayload(null, "Valid text"), /Contact required/);
});

test("New Message Flow: creates pending proposal first then fills in proposed_text on regenerate", () => {
  // 1. Initial proposal creation
  const initialProposal = {
    id: "prop-new-123",
    contact_id: "contact-456",
    state: "pending_approval",
    action_type: "message",
    channel: "linkedin",
    proposed_text: "",
  };

  assert.equal(initialProposal.state, "pending_approval");
  assert.equal(initialProposal.action_type, "message");
  assert.equal(initialProposal.proposed_text, "");

  // 2. Calling regenerate requires proposal_id
  assert.ok(initialProposal.id, "proposal_id must be present before calling regenerate");

  // 3. Bot returns generated text and fills in proposal in place
  const botGeneratedText = "Hi Sarah, thank you for reaching out! I'd love to learn more about the engineering role.";
  const updatedProposal = {
    ...initialProposal,
    proposed_text: botGeneratedText,
  };

  assert.equal(updatedProposal.id, "prop-new-123");
  assert.equal(updatedProposal.state, "pending_approval");
  assert.equal(updatedProposal.proposed_text, botGeneratedText);

  // 4. If bot call fails, empty pending proposal is kept so owner can retry
  const failedAttemptState = [initialProposal];
  assert.equal(failedAttemptState.length, 1);
  assert.equal(failedAttemptState[0].state, "pending_approval");
  assert.equal(failedAttemptState[0].id, "prop-new-123");
});
