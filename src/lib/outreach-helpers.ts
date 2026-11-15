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
 * Generates a contextual outbound message draft based on conversation history,
 * contact details, and owner instructions.
 */
export function generateContextualDraft(params: {
  contactName?: string | null;
  company?: string | null;
  role?: string | null;
  thread?: Array<{
    direction?: string | null;
    message_summary?: string | null;
    event_type?: string | null;
  }>;
  instruction?: string | null;
}): string {
  const { contactName, company, role, thread = [], instruction } = params;

  // Extract contact first name
  const rawName = (contactName || "").trim();
  const firstName = rawName.split(/\s+/)[0] || "";
  const nameSalutation = firstName ? `Hi ${firstName}` : "Hi there";
  const companyPhrase = company ? ` at ${company}` : "";
  const rolePhrase = role ? ` for the ${role} role` : "";

  // Check last interaction in the thread
  const validInteractions = thread.filter(
    (int) => !isDeletionMarkerNote(int) && Boolean(int.message_summary?.trim())
  );
  const lastInteraction = validInteractions[validInteractions.length - 1];
  const lastDirection = (lastInteraction?.direction || "").toLowerCase();
  const lastSummary = (lastInteraction?.message_summary || "").trim();

  const isCasual = instruction && /casual|informal|friendly/i.test(instruction);
  const isCurious = instruction && /curio|interest|question|challenge/i.test(instruction);

  // Scenario 1: Contact previously sent an inbound message
  if (lastDirection === "inbound") {
    if (isCasual) {
      return `${nameSalutation}, thanks for getting back to me! I would love to chat more about what the team is working on${companyPhrase}. Let me know if you have a few minutes later this week.`;
    }
    if (isCurious) {
      return `${nameSalutation}, thank you for your note. I've been following what you're building${companyPhrase} and would love to hear more about the technical challenges your team is focusing on right now. Do you have 15 minutes to connect?`;
    }
    return `${nameSalutation}, thank you for reaching out! I am very interested in learning more about opportunities${companyPhrase}${rolePhrase}. What does your schedule look like for a brief conversation this week?`;
  }

  // Scenario 2: Thread has prior outbound message(s) without recent reply (Follow-up)
  if (validInteractions.length > 0) {
    if (isCasual) {
      return `${nameSalutation}, hope your week is off to a great start! Just bumping this in case it got buried—would still love to connect whenever you get a moment.`;
    }
    return `${nameSalutation}, following up on my previous message. I know things get busy, but I remain very interested in contributing to engineering efforts${companyPhrase}. Would love to find a brief time to connect.`;
  }

  // Scenario 3: Fresh outbound outreach (no prior thread)
  if (isCasual) {
    return `${nameSalutation}, came across your profile and noticed the work your team is doing${companyPhrase}. Would love to connect and stay in touch!`;
  }
  return `${nameSalutation}, I noticed your work${companyPhrase} and wanted to reach out. I'm actively exploring new opportunities${rolePhrase} and would love to connect to see if there might be a fit for collaboration.`;
}
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

/**
 * Checks whether an interaction is a deletion marker note that should NOT be rendered in the timeline.
 * - event_type = 'note' and message_summary = 'deleted_on_linkedin'
 * - external_key starts with 'deleted|'
 */
export function isDeletionMarkerNote(
  interaction: Partial<OutreachInteraction> | Record<string, any> | null | undefined
): boolean {
  if (!interaction) return false;
  const anyInt = interaction as any;
  const eventType = (anyInt.event_type || "").toLowerCase().trim();
  const summary = (anyInt.message_summary || "").toLowerCase().trim();
  const extKey = typeof anyInt.external_key === "string" ? anyInt.external_key.trim() : "";

  if (extKey.startsWith("deleted|") || extKey.toLowerCase().startsWith("deleted|")) {
    return true;
  }

  if (eventType === "note") {
    if (summary === "deleted_on_linkedin" || summary.includes("deleted_on_linkedin")) {
      return true;
    }
    if (typeof anyInt.notes === "string" && /deleted_on_linkedin/i.test(anyInt.notes)) {
      return true;
    }
  }

  return false;
}

/**
 * Checks whether a proposal represents a sent message that was later marked deleted on LinkedIn:
 * state = 'sent' and error = 'deleted_on_linkedin'
 */
export function isDeletedOnLinkedInProposal(
  proposal: Partial<OutreachProposal> | Record<string, any> | null | undefined
): boolean {
  if (!proposal) return false;
  const anyP = proposal as any;
  const state = (anyP.state || "").toLowerCase().trim();
  const error = (anyP.error || "").toLowerCase().trim();
  return state === "sent" && (error === "deleted_on_linkedin" || error.includes("deleted_on_linkedin"));
}

/**
 * Matches a deleted proposal to its message_sent interaction row:
 * 1. By action_id (if available)
 * 2. By contact_id + sent time + text
 */
export function matchProposalToInteraction(
  proposal: Partial<OutreachProposal> | Record<string, any>,
  interactions: OutreachInteraction[]
): OutreachInteraction | null {
  const pContactId = proposal.contact_id;
  const pActionId = (proposal as any).action_id || proposal.id;
  const pText = (proposal.approved_text || proposal.proposed_text || "").trim().toLowerCase();
  const pTimeStr = proposal.sent_at || proposal.updated_at || proposal.created_at;
  const pTime = pTimeStr ? new Date(pTimeStr).getTime() : null;

  // 1. Direct match by action_id if available
  if (pActionId) {
    const directMatch = interactions.find(
      (int) => int.action_id && (int.action_id === pActionId || int.action_id === proposal.id)
    );
    if (directMatch) return directMatch;
  }

  // 2. Filter candidates by contact_id and outbound direction / message_sent event
  const candidates = interactions.filter((int) => {
    if (pContactId && int.contact_id && int.contact_id !== pContactId) return false;
    const dir = (int.direction || "").toLowerCase();
    const evt = (int.event_type || "").toLowerCase();
    return dir === "outbound" || evt === "message_sent" || evt.includes("sent") || evt === "message";
  });

  const pool =
    candidates.length > 0
      ? candidates
      : interactions.filter((int) => !pContactId || int.contact_id === pContactId);
  if (pool.length === 0) return null;

  // Score candidates based on text match and time proximity
  let bestMatch: OutreachInteraction | null = null;
  let bestScore = -1;
  let smallestTimeDiff = Infinity;

  for (const int of pool) {
    const iText = (int.message_summary || (int as any).text || "").trim().toLowerCase();
    const iTimeStr = int.event_at || int.created_at;
    const iTime = iTimeStr ? new Date(iTimeStr).getTime() : null;

    let textScore = 0;
    if (pText && iText) {
      if (pText === iText) {
        textScore = 100;
      } else if (pText.includes(iText) || iText.includes(pText)) {
        textScore = 70;
      } else {
        const pWords = pText.split(/\s+/).filter(Boolean);
        const iWords = iText.split(/\s+/).filter(Boolean);
        const common = pWords.filter((w: string) => iWords.includes(w)).length;
        if (pWords.length > 0 && common / pWords.length > 0.6) {
          textScore = 50;
        }
      }
    }

    let timeDiff = Infinity;
    let timeScore = 0;
    if (pTime !== null && iTime !== null && !isNaN(pTime) && !isNaN(iTime)) {
      timeDiff = Math.abs(pTime - iTime);
      if (timeDiff <= 60 * 1000) {
        // Within 1 minute
        timeScore = 50;
      } else if (timeDiff <= 3600 * 1000) {
        // Within 1 hour
        timeScore = 30;
      } else if (timeDiff <= 24 * 3600 * 1000) {
        // Within 24 hours
        timeScore = 15;
      }
    }

    const totalScore = textScore + timeScore;
    if (totalScore > bestScore || (totalScore === bestScore && timeDiff < smallestTimeDiff)) {
      bestScore = totalScore;
      smallestTimeDiff = timeDiff;
      bestMatch = int;
    }
  }

  // Require text match or close time correlation
  if (bestScore >= 50) {
    return bestMatch;
  }

  if (pool.length === 1 && (bestScore > 0 || smallestTimeDiff <= 300 * 1000)) {
    return pool[0];
  }

  return null;
}

/**
 * Builds the timeline for display in the LinkedIn CRM message list:
 * 1. Hides deletion note rows (event_type = 'note' & message_summary = 'deleted_on_linkedin', or external_key starts with 'deleted|').
 * 2. Matches proposals where state = 'sent' & error = 'deleted_on_linkedin' to their original message_sent row
 *    by contact_id + sent time + text (or by action_id).
 * 3. In that message's existing timeline position: hides original text, shows collapsed "Message deleted" tag with
 *    the original timestamp, expanding on click.
 * 4. Leaves all other messages unchanged without adding new rows.
 */
export function buildOutreachTimeline(
  interactions: OutreachInteraction[],
  proposals: OutreachProposal[] = []
): OutreachInteraction[] {
  if (!interactions || interactions.length === 0) return [];

  // Step 1: Identify deletion marker notes and collect any explicit targets
  const deletionNotes = interactions.filter(isDeletionMarkerNote);
  const deletedIdsFromNotes = new Set<string>();
  for (const note of deletionNotes) {
    if (typeof note.external_key === "string" && note.external_key.startsWith("deleted|")) {
      const targetId = note.external_key.slice("deleted|".length);
      if (targetId) deletedIdsFromNotes.add(targetId);
    }
    if (typeof (note as any).target_interaction_id === "string") {
      deletedIdsFromNotes.add((note as any).target_interaction_id);
    }
  }

  // Step 2: Hide deletion note rows from the visible timeline
  const visibleInteractions = interactions.filter((int) => !isDeletionMarkerNote(int));

  // Step 3: Find proposals where state = 'sent' and error = 'deleted_on_linkedin'
  const deletedProposals = (proposals || []).filter(isDeletedOnLinkedInProposal);

  // Map each deleted proposal to a matching interaction
  const matchedDeletedInteractionIds = new Set<string>();
  const proposalOriginalTexts = new Map<string, string>();

  for (const prop of deletedProposals) {
    const availablePool = visibleInteractions.filter(
      (int) => !matchedDeletedInteractionIds.has(int.id)
    );
    const matched = matchProposalToInteraction(prop, availablePool);
    if (matched) {
      matchedDeletedInteractionIds.add(matched.id);
      const text = prop.approved_text || prop.proposed_text;
      if (text) {
        proposalOriginalTexts.set(matched.id, text);
      }
    }
  }

  // Step 4: Map visible interactions, updating matched messages in their existing slots
  return visibleInteractions.map((int) => {
    const isMatchedByProposal = matchedDeletedInteractionIds.has(int.id);
    const isMatchedByNote = deletedIdsFromNotes.has(int.id);

    if (isMatchedByProposal || isMatchedByNote) {
      const origText =
        int.message_summary && int.message_summary.trim() !== "deleted_on_linkedin"
          ? int.message_summary
          : proposalOriginalTexts.get(int.id) || int.message_summary || "(No content)";

      return {
        ...int,
        deleted_on_linkedin: true,
        is_deleted: true,
        original_text: origText,
      };
    }

    return int;
  });
}
