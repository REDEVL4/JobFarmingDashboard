import test from "node:test";
import assert from "node:assert/strict";

import { buildRegeneratePayload, applyRegeneratedProposalText } from "../../src/lib/outreach-helpers.ts";

test("Regenerate Option: builds payload with proposal id and optional tone instruction", () => {
  const proposalId = "7718f39d-42a5-475e-86b9-54e386e91180";
  const payloadWithTone = buildRegeneratePayload(proposalId, "make it more casual");

  assert.equal(payloadWithTone.proposal_id, proposalId);
  assert.equal(payloadWithTone.instruction, "make it more casual");

  const payloadDefault = buildRegeneratePayload(proposalId, "");
  assert.equal(payloadDefault.proposal_id, proposalId);
  assert.equal(payloadDefault.instruction, "regenerate, more natural, show curiosity");
});

test("Regenerate Option: rejects missing proposal id", () => {
  assert.throws(() => buildRegeneratePayload("", "casual"), /proposal_id required/);
  assert.throws(() => buildRegeneratePayload(null, "casual"), /proposal_id required/);
});

test("Regenerate Option: updates proposed_text in place while keeping state pending_approval", () => {
  const currentProposal = {
    id: "7718f39d-42a5-475e-86b9-54e386e91180",
    state: "pending_approval",
    proposed_text: "Original stiff message.",
    channel: "linkedin",
  };

  const updatedProposal = applyRegeneratedProposalText(
    currentProposal,
    "Hey! Really loved your recent post on distributed inference."
  );

  assert.equal(updatedProposal.id, currentProposal.id);
  assert.equal(updatedProposal.proposed_text, "Hey! Really loved your recent post on distributed inference.");
  // State remains pending_approval so the owner can review, approve or reject
  assert.equal(updatedProposal.state, "pending_approval");
});
