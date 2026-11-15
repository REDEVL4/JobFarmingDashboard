import type { OutreachInteraction, OutreachProposal } from "@/types/dashboard";

/**
 * Determines whether an interaction has been marked deleted or edited.
 * Checks interaction flags, event types, status, notes, evidence fields,
 * and summary message text patterns.
 */
export function getInteractionStatus(
  interaction: Partial<OutreachInteraction> | Record<string, any> | null | undefined
): "deleted" | "edited" | null {
  if (!interaction) return null;

  const anyInt = interaction as any;

  // 1. Deleted conditions
  if (
    anyInt.is_deleted === true ||
    anyInt.deleted === true ||
    Boolean(anyInt.deleted_at) ||
    anyInt.event_type === "message_deleted" ||
    anyInt.event_type === "deleted" ||
    (typeof anyInt.status === "string" && anyInt.status.toLowerCase() === "deleted") ||
    (typeof anyInt.notes === "string" && /deleted/i.test(anyInt.notes)) ||
    (typeof anyInt.evidence_source === "string" && /deleted/i.test(anyInt.evidence_source)) ||
    (typeof anyInt.evidence_ref === "string" && /deleted/i.test(anyInt.evidence_ref)) ||
    (typeof anyInt.message_summary === "string" &&
      /^(?:\[?message deleted\]?|this message (?:was|has been) deleted)$/i.test(anyInt.message_summary.trim()))
  ) {
    return "deleted";
  }

  // 2. Edited conditions
  if (
    anyInt.is_edited === true ||
    anyInt.edited === true ||
    Boolean(anyInt.edited_at) ||
    anyInt.event_type === "message_edited" ||
    anyInt.event_type === "edited" ||
    (typeof anyInt.status === "string" && anyInt.status.toLowerCase() === "edited") ||
    (typeof anyInt.notes === "string" && /edited/i.test(anyInt.notes)) ||
    (typeof anyInt.evidence_source === "string" && /edited/i.test(anyInt.evidence_source)) ||
    (typeof anyInt.evidence_ref === "string" && /edited/i.test(anyInt.evidence_ref)) ||
    (typeof anyInt.message_summary === "string" &&
      (/(?:\(edited\)|\[edited\])$/i.test(anyInt.message_summary.trim()) ||
        /^(?:\[?message edited\]?|\(edited\))$/i.test(anyInt.message_summary.trim())))
  ) {
    return "edited";
  }

  return null;
}

export interface NewProposalInputContact {
  id: string;
  full_name?: string | null;
  name?: string | null;
  professional_title?: string | null;
  role?: string | null;
  company?: string | null;
  linkedin_url?: string | null;
}

/**
 * Builds a validated payload for creating a new outbound outreach proposal
 * with state set to 'pending_approval' for owner review.
 */
export function buildNewProposalPayload(
  contact: NewProposalInputContact | null | undefined,
  proposedText: string,
  options?: {
    channel?: string;
    action_type?: string;
  }
) {
  if (!contact || !contact.id) {
    throw new Error("Contact required to build proposal payload");
  }

  const trimmedText = (proposedText || "").trim();
  if (!trimmedText) {
    throw new Error("Text cannot be empty for new message proposal");
  }

  return {
    contact_id: contact.id,
    action_type: options?.action_type || "message",
    channel: options?.channel || "linkedin",
    target_name: contact.full_name || contact.name || null,
    target_title: contact.professional_title || contact.role || null,
    target_company: contact.company || null,
    linkedin_url: contact.linkedin_url || null,
    proposed_text: trimmedText,
    state: "pending_approval" as const,
  };
}

/**
 * Builds the payload for triggering proposal regeneration.
 */
export function buildRegeneratePayload(
  proposalId: string | null | undefined,
  instruction?: string | null
): { proposal_id: string; instruction: string } {
  if (!proposalId || !proposalId.trim()) {
    throw new Error("proposal_id required to regenerate draft");
  }

  const cleanInstruction =
    (instruction || "").trim() || "regenerate, more natural, show curiosity";

  return {
    proposal_id: proposalId.trim(),
    instruction: cleanInstruction.slice(0, 500),
  };
}

/**
 * Updates a proposal's proposed_text in place when bot regeneration returns,
 * ensuring the state remains 'pending_approval' for owner review.
 */
export function applyRegeneratedProposalText(
  proposal: OutreachProposal,
  newProposedText: string
): OutreachProposal {
  return {
    ...proposal,
    proposed_text: newProposedText,
    state: "pending_approval",
    updated_at: new Date().toISOString(),
  };
}
