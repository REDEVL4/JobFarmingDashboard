import type { ClassificationResult, CanonicalHiringStage } from "./types.ts";

export interface EmailClassificationInput {
  from: string;
  subject: string;
  snippet?: string;
  bodyText?: string;
}

const SECURITY_PATTERNS = [
  /security-noreply/i,
  /verification code/i,
  /sign[- ]in code/i,
  /password reset/i,
  /two-factor/i,
  /2fa code/i,
  /one-time password/i,
  /temporary pin/i,
];

const REJECTION_PATTERNS: Array<{ pattern: RegExp; quoteExtract: RegExp }> = [
  {
    pattern: /(?:unfortunately|regret to inform|have decided not to progress|will not be moving forward|not moving forward with your (?:candidacy|application)|chosen to move forward with other candidates|pursuing other candidates)/i,
    quoteExtract: /([^.\n]*?(?:unfortunately|regret to inform|have decided not to progress|will not be moving forward|not moving forward with your (?:candidacy|application)|chosen to move forward with other candidates|pursuing other candidates)[^.\n]*?\.)/i,
  },
  {
    pattern: /(?:position has been filled|role has been closed|cancelled the search)/i,
    quoteExtract: /([^.\n]*?(?:position has been filled|role has been closed|cancelled the search)[^.\n]*?\.)/i,
  },
];

const ASSESSMENT_PATTERNS: Array<{ pattern: RegExp; quoteExtract: RegExp; type: string }> = [
  {
    pattern: /(?:coding assessment|hackerrank|codesignal|karat|codility|take-home challenge|technical assessment|coding challenge)/i,
    quoteExtract: /([^.\n]*?(?:coding assessment|hackerrank|codesignal|karat|codility|take-home challenge|technical assessment|coding challenge)[^.\n]*?\.)/i,
    type: "coding",
  },
  {
    pattern: /(?:recorded competency interview|hirevue|video interview invitation|one-way video|recorded interview)/i,
    quoteExtract: /([^.\n]*?(?:recorded competency interview|hirevue|video interview invitation|one-way video|recorded interview)[^.\n]*?\.)/i,
    type: "recorded_video",
  },
  {
    pattern: /(?:online assessment|skills assessment|complete this assessment|assessment invitation)/i,
    quoteExtract: /([^.\n]*?(?:online assessment|skills assessment|complete this assessment|assessment invitation)[^.\n]*?\.)/i,
    type: "assessment",
  },
];

const INTERVIEW_PATTERNS: Array<{ pattern: RegExp; quoteExtract: RegExp }> = [
  {
    pattern: /(?:invitation to interview|schedule your (?:initial|phone|technical)? (?:interview|conversation|screen)|would love to schedule a (?:phone )?screen|invited to interview|next steps in the interview process|schedule a call with our recruiting team)/i,
    quoteExtract: /([^.\n]*?(?:invitation to interview|schedule your (?:initial|phone|technical)? (?:interview|conversation|screen)|would love to schedule a (?:phone )?screen|invited to interview|next steps in the interview process|schedule a call with our recruiting team)[^.\n]*?\.)/i,
  },
];

const OFFER_PATTERNS: Array<{ pattern: RegExp; quoteExtract: RegExp }> = [
  {
    pattern: /(?:pleased to offer you the position|offer of employment|formal offer letter|congratulations on your offer|extend an offer of employment)/i,
    quoteExtract: /([^.\n]*?(?:pleased to offer you the position|offer of employment|formal offer letter|congratulations on your offer|extend an offer of employment)[^.\n]*?\.)/i,
  },
];

const ACKNOWLEDGMENT_PATTERNS: Array<{ pattern: RegExp; quoteExtract: RegExp }> = [
  {
    pattern: /(?:thank you for (?:your interest in|applying to|submitting your application)|we (?:have )?received your application|application received|thanks for applying|confirmation of your application)/i,
    quoteExtract: /([^.\n]*?(?:thank you for (?:your interest in|applying to|submitting your application)|we (?:have )?received your application|application received|thanks for applying|confirmation of your application)[^.\n]*?\.)/i,
  },
];

/**
 * Strips HTML tags and normalizes whitespace safely.
 */
function cleanText(raw: string): string {
  return raw
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Classifies a Gmail message into a deterministic recruitment hiring stage.
 * Defends against prompt injection by avoiding LLM inference and relying on verified rule sets.
 */
export function classifyRecruitmentEmail(email: EmailClassificationInput): ClassificationResult {
  const subject = email.subject || "";
  const from = email.from || "";
  const snippet = email.snippet || "";
  const body = email.bodyText ? cleanText(email.bodyText) : "";
  const fullText = `${subject} ${snippet} ${body}`;

  // 1. Immediately discard security / 2FA / auth messages
  for (const pat of SECURITY_PATTERNS) {
    if (pat.test(subject) || pat.test(from) || pat.test(snippet)) {
      return {
        isRecruitment: false,
        stage: null,
        confidence: 1.0,
        evidenceSummary: "Security/verification email ignored",
        requiresReview: false,
        actionItems: [],
      };
    }
  }

  // 2. Check for Formal Offer (highest priority stage)
  for (const { pattern, quoteExtract } of OFFER_PATTERNS) {
    if (pattern.test(subject) || pattern.test(snippet) || pattern.test(body)) {
      const match = quoteExtract.exec(fullText);
      const quote = match ? match[1].trim() : "Formal offer extended";
      return {
        isRecruitment: true,
        stage: "Offer Received",
        confidence: 0.95,
        evidenceSummary: "Offer of employment confirmed by employer correspondence",
        quote,
        requiresReview: false,
        actionItems: ["Review offer details and compensation package"],
      };
    }
  }

  // 3. Check for Interview Scheduling
  for (const { pattern, quoteExtract } of INTERVIEW_PATTERNS) {
    if (pattern.test(subject) || pattern.test(snippet) || pattern.test(body)) {
      const match = quoteExtract.exec(fullText);
      const quote = match ? match[1].trim() : "Interview invitation received";
      return {
        isRecruitment: true,
        stage: "Interview Scheduled",
        confidence: 0.9,
        evidenceSummary: "Interview or recruiter conversation invited",
        quote,
        requiresReview: false,
        actionItems: ["Schedule the requested interview slot promptly"],
      };
    }
  }

  // 4. Check for Assessment Request
  for (const { pattern, quoteExtract, type } of ASSESSMENT_PATTERNS) {
    if (pattern.test(subject) || pattern.test(snippet) || pattern.test(body)) {
      const match = quoteExtract.exec(fullText);
      const quote = match ? match[1].trim() : "Assessment requested";

      let deadlineText: string | undefined;
      const dlMatch = fullText.match(/(?:within\s+\d+\s+days|expires\s+after\s+\d+\s+days|complete\s+by\s+[A-Za-z]+\s+\d+)/i);
      if (dlMatch) {
        deadlineText = dlMatch[0];
      }

      return {
        isRecruitment: true,
        stage: "Assessment Requested",
        confidence: 0.88,
        evidenceSummary: `Technical/competency assessment requested (${type})`,
        quote,
        assessmentDetails: {
          type,
          deadlineText,
        },
        requiresReview: false,
        actionItems: ["Complete assessment before the stated deadline"],
      };
    }
  }

  // 5. Check for Rejection
  for (const { pattern, quoteExtract } of REJECTION_PATTERNS) {
    if (pattern.test(subject) || pattern.test(snippet) || pattern.test(body)) {
      const match = quoteExtract.exec(fullText);
      const quote = match ? match[1].trim() : "Application rejected";
      return {
        isRecruitment: true,
        stage: "Rejected",
        confidence: 0.92,
        evidenceSummary: "Rejected explicitly supported by recruitment email",
        quote,
        requiresReview: false,
        actionItems: [],
      };
    }
  }

  // 6. Check for Application Acknowledgment
  for (const { pattern, quoteExtract } of ACKNOWLEDGMENT_PATTERNS) {
    if (pattern.test(subject) || pattern.test(snippet) || pattern.test(body)) {
      const match = quoteExtract.exec(fullText);
      const quote = match ? match[1].trim() : "Application confirmed";
      return {
        isRecruitment: true,
        stage: "Applied Confirmed",
        confidence: 0.9,
        evidenceSummary: "Application received confirmation observed",
        quote,
        requiresReview: false,
        actionItems: [],
      };
    }
  }

  // 7. General recruitment context without clear stage -> requires manual review
  const generalRecruitmentKeywords = /(?:candidate|application|job|recruiter|interview|talent acquisition|hiring team|greenhouse|lever|workday|ashby)/i;
  if (generalRecruitmentKeywords.test(subject) || generalRecruitmentKeywords.test(from)) {
    return {
      isRecruitment: true,
      stage: null,
      confidence: 0.5,
      evidenceSummary: "Recruitment correspondence detected without definite stage outcome",
      requiresReview: true,
      reasonCode: "missing_role_and_unclear_outcome",
      actionItems: ["Review message in recruitment review queue"],
    };
  }

  // Default: Not recruitment related
  return {
    isRecruitment: false,
    stage: null,
    confidence: 1.0,
    evidenceSummary: "Unrelated message ignored",
    requiresReview: false,
    actionItems: [],
  };
}
