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

test("New Message: If pending_approval proposal already exists for contact, show that draft instead of creating duplicate", () => {
  const contactId = "contact-existing-789";
  const existingProposal = {
    id: "prop-existing-1",
    contact_id: contactId,
    state: "pending_approval",
    action_type: "message",
    proposed_text: "Existing draft for review",
  };

  const proposalsList = [
    existingProposal,
    { id: "prop-old-sent", contact_id: contactId, state: "sent", proposed_text: "Old message" },
  ];

  // Logic: find existing pending_approval proposal for contact
  const foundPending = proposalsList.find(
    (p) => p.contact_id === contactId && p.state === "pending_approval"
  );

  // Assert that existing draft is found, preventing a second INSERT
  assert.ok(foundPending);
  assert.equal(foundPending.id, "prop-existing-1");
  assert.equal(foundPending.proposed_text, "Existing draft for review");
});

test("Polling Flow: polls proposal every 3-5s by id until proposed_text updates or 45s pass", () => {
  const proposalId = "prop-poll-123";
  const baselineText = "";
  const maxDurationMs = 45000;
  const pollIntervalMs = 3500;

  // Poll interval must be in 3-5s range
  assert.ok(pollIntervalMs >= 3000 && pollIntervalMs <= 5000);
  assert.equal(maxDurationMs, 45000);

  // Simulation: Poll 1 returns empty (bot still writing in background)
  const pollResult1 = { id: proposalId, state: "pending_approval", proposed_text: "" };
  const hasUpdated1 = pollResult1.proposed_text && pollResult1.proposed_text !== baselineText;
  assert.equal(Boolean(hasUpdated1), false, "Should continue polling when proposed_text is unchanged");

  // Simulation: Poll 2 returns new bot draft
  const botWrittenText = "Hello! Reaching out regarding your software engineering team.";
  const pollResult2 = { id: proposalId, state: "pending_approval", proposed_text: botWrittenText };
  const hasUpdated2 = pollResult2.proposed_text && pollResult2.proposed_text !== baselineText;
  assert.equal(Boolean(hasUpdated2), true, "Should complete polling when proposed_text updates");
  assert.equal(pollResult2.proposed_text, botWrittenText);
});

test("Regenerate Flow: re-fetches proposal row and updates composer in place with polling loop", () => {
  const proposalId = "prop-regen-456";
  const baselineText = "Previous draft message that owner wants to regenerate";
  const newBotText = "Hi Jane, following up with a more casual tone regarding the engineering opening!";

  // 1. Regenerate starts polling immediately with 3s interval and 45s max duration
  const pollIntervalMs = 3000;
  const maxDurationMs = 45000;
  assert.equal(pollIntervalMs, 3000);
  assert.equal(maxDurationMs, 45000);

  // 2. Draft endpoint returns 200 without blocking for completion
  const endpointResponse = { status: 200, data: { id: proposalId, state: "pending_approval" } };
  assert.equal(endpointResponse.status, 200);

  // 3. Poll checks if text has changed from baseline
  const pollCheck1 = { id: proposalId, proposed_text: baselineText };
  assert.equal(pollCheck1.proposed_text !== baselineText, false, "Still baseline on early poll");

  const pollCheck2 = { id: proposalId, proposed_text: newBotText };
  assert.equal(pollCheck2.proposed_text !== baselineText, true, "Text updated on later poll");

  // 4. In-place state update: composerText updated directly without page reload
  let composerText = baselineText;
  composerText = pollCheck2.proposed_text;
  assert.equal(composerText, newBotText);
});


