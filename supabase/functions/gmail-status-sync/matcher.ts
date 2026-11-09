import type { CandidateApplication, MatchResult, ReviewReasonCode } from "./types.ts";

export interface EmailMatchInput {
  id: string;
  threadId?: string;
  from: string;
  subject: string;
  bodyText?: string;
}

const THIRD_PARTY_RECRUITING_DOMAINS = [
  "gem.com",
  "hirevue.com",
  "codility.com",
  "hackerrank.net",
  "hackerrank.com",
];

/**
 * Checks if a message ID has already been recorded in previous runs.
 */
export function isMessageProcessed(messageId: string, processedSet: Set<string>): boolean {
  return processedSet.has(messageId);
}

/**
 * Normalizes text for matching tokens.
 */
function normalize(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Extracts sender email domain.
 */
function extractDomain(from: string): string {
  const match = from.match(/@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  return match ? match[1].toLowerCase() : "";
}

/**
 * Matches an incoming email to a known job application in jobbot.job_applications.
 */
export function matchApplicationToEmail(
  email: EmailMatchInput,
  applications: CandidateApplication[]
): MatchResult {
  const subject = email.subject || "";
  const body = email.bodyText || "";
  const fullText = `${subject} ${body}`;
  const senderDomain = extractDomain(email.from);

  // 1. Check for third-party recruiting sender (e.g., Gem)
  const isThirdParty = THIRD_PARTY_RECRUITING_DOMAINS.some(
    (domain) => senderDomain === domain || senderDomain.endsWith(`.${domain}`)
  );

  // Find candidate companies mentioned
  const matchingCompanies = applications.filter((app) => {
    if (!app.company) return false;
    const compRegex = new RegExp(`\\b${app.company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    return compRegex.test(fullText) || compRegex.test(email.from);
  });

  if (isThirdParty && matchingCompanies.length > 0) {
    return {
      matched: false,
      ambiguous: true,
      confidence: 0.5,
      candidateApplications: matchingCompanies,
      reasonCode: "sender_employer_mapping_unverified",
      matchBasis: `Message received from third-party platform ${senderDomain} for candidate company. Requires manual domain verification.`,
    };
  }

  // 2. Direct Requisition ID match (highest confidence anchor)
  for (const app of applications) {
    if (app.requisition_id && app.requisition_id.trim().length >= 4) {
      const req = app.requisition_id.trim();
      const reqRegex = new RegExp(`\\b${req.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (reqRegex.test(fullText)) {
        return {
          matched: true,
          ambiguous: false,
          confidence: 0.98,
          matchedApplication: app,
          matchBasis: `Requisition ID ${req} found in message correspondence`,
        };
      }
    }
  }

  // 3. Direct Confirmation Email ID / Thread Reference match
  for (const app of applications) {
    if (app.confirmation_email_ref) {
      const ref = app.confirmation_email_ref.trim();
      if (ref === email.id || (email.threadId && ref === email.threadId)) {
        return {
          matched: true,
          ambiguous: false,
          confidence: 0.96,
          matchedApplication: app,
          matchBasis: `Exact confirmation email/thread ID ${ref} matches application record`,
        };
      }
    }
  }

  // 4. Match by Company
  if (matchingCompanies.length === 0) {
    return {
      matched: false,
      ambiguous: false,
      confidence: 0.0,
      matchBasis: "No matching company found in tracked applications",
    };
  }

  // If exactly one application exists for this company
  if (matchingCompanies.length === 1) {
    const singleApp = matchingCompanies[0];
    return {
      matched: true,
      ambiguous: false,
      confidence: 0.88,
      matchedApplication: singleApp,
      matchBasis: `Unique application found for company ${singleApp.company}`,
    };
  }

  // If multiple applications exist at the same company, attempt exact job title matching
  const exactTitleMatches = matchingCompanies.filter((app) => {
    if (!app.job_title) return false;
    const titleRegex = new RegExp(`\\b${app.job_title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    return titleRegex.test(fullText);
  });

  if (exactTitleMatches.length === 1) {
    return {
      matched: true,
      ambiguous: false,
      confidence: 0.9,
      matchedApplication: exactTitleMatches[0],
      matchBasis: `Specific role title matches one of multiple applications at ${exactTitleMatches[0].company}`,
    };
  }

  // Multiple candidate applications without unambiguous distinction
  return {
    matched: false,
    ambiguous: true,
    confidence: 0.6,
    candidateApplications: matchingCompanies,
    reasonCode: "multiple_candidate_applications",
    matchBasis: `Multiple active applications for ${matchingCompanies[0].company} (${matchingCompanies.length} roles). Email does not specify unique requisition.`,
  };
}

