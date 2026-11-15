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

  // 1. Generic check: any flag, note, or field containing "deleted_on_linkedin"
  for (const [key, val] of Object.entries(anyInt)) {
    if (key === "interaction" || key === "contact") continue;
    if (/deleted_on_linkedin/i.test(key) && (val === true || val === "true" || Boolean(val))) {
      return "deleted";
    }
    if (typeof val === "string" && /deleted_on_linkedin/i.test(val)) {
      return "deleted";
    }
  }

  // 2. Generic check: any flag, note, or field containing "edited_on_linkedin"
  for (const [key, val] of Object.entries(anyInt)) {
    if (key === "interaction" || key === "contact") continue;
    if (/edited_on_linkedin/i.test(key) && (val === true || val === "true" || Boolean(val))) {
      return "edited";
    }
    if (typeof val === "string" && /edited_on_linkedin/i.test(val)) {
      return "edited";
    }
  }

  // 3. Other deleted conditions / markers
  if (
    anyInt.deleted_on_linkedin === true ||
    anyInt.deleted_on_linkedin === "true" ||
    Boolean(anyInt.deleted_on_linkedin) ||
    anyInt.is_deleted === true ||
    anyInt.deleted === true ||
    Boolean(anyInt.deleted_at) ||
    anyInt.event_type === "message_deleted" ||
    anyInt.event_type === "deleted" ||
    anyInt.event_type === "deleted_on_linkedin" ||
    (typeof anyInt.status === "string" &&
      (anyInt.status.toLowerCase() === "deleted" ||
        anyInt.status.toLowerCase() === "deleted_on_linkedin" ||
        /deleted/i.test(anyInt.status))) ||
    (typeof anyInt.notes === "string" && (/deleted/i.test(anyInt.notes) || /deleted_on_linkedin/i.test(anyInt.notes))) ||
    (typeof anyInt.verification === "string" && (/deleted/i.test(anyInt.verification) || /deleted_on_linkedin/i.test(anyInt.verification))) ||
    (typeof anyInt.evidence_source === "string" && /deleted/i.test(anyInt.evidence_source)) ||
    (typeof anyInt.evidence_ref === "string" && /deleted/i.test(anyInt.evidence_ref)) ||
    (typeof anyInt.metadata === "object" &&
      anyInt.metadata &&
      (anyInt.metadata.deleted_on_linkedin === true || Boolean(anyInt.metadata.deleted) || Boolean(anyInt.metadata.is_deleted))) ||
    (typeof anyInt.payload === "object" &&
      anyInt.payload &&
      (anyInt.payload.deleted_on_linkedin === true || Boolean(anyInt.payload.deleted) || Boolean(anyInt.payload.is_deleted))) ||
    (typeof anyInt.raw === "object" &&
      anyInt.raw &&
      (anyInt.raw.deleted_on_linkedin === true || Boolean(anyInt.raw.deleted) || Boolean(anyInt.raw.is_deleted))) ||
    (typeof anyInt.message_summary === "string" &&
      /^(?:\[?message deleted\]?|this message (?:was|has been) deleted|deleted)$/i.test(anyInt.message_summary.trim()))
  ) {
    return "deleted";
  }

  // 4. Other edited conditions / markers
  if (
    anyInt.edited_on_linkedin === true ||
    anyInt.edited_on_linkedin === "true" ||
    Boolean(anyInt.edited_on_linkedin) ||
    anyInt.is_edited === true ||
    anyInt.edited === true ||
    Boolean(anyInt.edited_at) ||
    anyInt.event_type === "message_edited" ||
    anyInt.event_type === "edited" ||
    anyInt.event_type === "edited_on_linkedin" ||
    (typeof anyInt.status === "string" &&
      (anyInt.status.toLowerCase() === "edited" ||
        anyInt.status.toLowerCase() === "edited_on_linkedin" ||
        /edited/i.test(anyInt.status))) ||
    (typeof anyInt.notes === "string" && (/edited/i.test(anyInt.notes) || /edited_on_linkedin/i.test(anyInt.notes))) ||
    (typeof anyInt.verification === "string" && (/edited/i.test(anyInt.verification) || /edited_on_linkedin/i.test(anyInt.verification))) ||
    (typeof anyInt.evidence_source === "string" && /edited/i.test(anyInt.evidence_source)) ||
    (typeof anyInt.evidence_ref === "string" && /edited/i.test(anyInt.evidence_ref)) ||
    (typeof anyInt.metadata === "object" &&
      anyInt.metadata &&
      (anyInt.metadata.edited_on_linkedin === true || Boolean(anyInt.metadata.edited) || Boolean(anyInt.metadata.is_edited))) ||
    (typeof anyInt.payload === "object" &&
      anyInt.payload &&
      (anyInt.payload.edited_on_linkedin === true || Boolean(anyInt.payload.edited) || Boolean(anyInt.payload.is_edited))) ||
    (typeof anyInt.raw === "object" &&
      anyInt.raw &&
      (anyInt.raw.edited_on_linkedin === true || Boolean(anyInt.raw.edited) || Boolean(anyInt.raw.is_edited))) ||
    (typeof anyInt.message_summary === "string" &&
      (/(?:\(edited\)|\[edited\])$/i.test(anyInt.message_summary.trim()) ||
        /^(?:\[?message edited\]?|\(edited\)|edited)$/i.test(anyInt.message_summary.trim())))
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
