/**
 * Sensitive Message Filter & Redaction Utilities
 * 
 * Invariants:
 * 1. Do not send OTPs, password resets, or security codes to Grok.
 * 2. Track excluded sensitive messages by ID and reason without storing sensitive content.
 * 3. Never store or log raw security verification codes.
 */

import type { SensitiveCheckResult } from "./types.ts";

const SENSITIVE_SENDER_PATTERNS = [
  /security-noreply@/i,
  /no-reply@.*\.google\.com/i,
  /accountprotection\.google\.com/i,
  /accounts\.google\.com/i,
  /auth@/i,
  /verify@/i,
  /verification@/i,
  /noreply@github\.com/i,
  /security@/i,
  /2fa@/i,
  /otp@/i,
  /password-reset/i,
  /identity@/i,
  /login-alert/i,
];

const SENSITIVE_SUBJECT_PATTERNS: Array<{ pattern: RegExp; reason: SensitiveCheckResult["reason"] }> = [
  { pattern: /\b(?:verification|security|access|confirmation)\s+code\b/i, reason: "sensitive_security_otp" },
  { pattern: /\b(?:one-time|one\s+time)\s+(?:password|passcode|pin)\b/i, reason: "sensitive_security_otp" },
  { pattern: /\b(?:otp|2fa|mfa)\b/i, reason: "sensitive_security_otp" },
  { pattern: /\b(?:reset|forgot)\s+(?:your\s+)?password\b/i, reason: "sensitive_password_reset" },
  { pattern: /\bpassword\s+reset\s+request\b/i, reason: "sensitive_password_reset" },
  { pattern: /\b(?:new\s+sign-in|new\s+login|unusual\s+activity|security\s+alert)\b/i, reason: "sensitive_security_alert" },
  { pattern: /\b2-step\s+verification\b/i, reason: "sensitive_security_otp" },
  { pattern: /\bverify\s+your\s+(?:identity|account|email|login)\b/i, reason: "sensitive_auth_code" },
  { pattern: /\byour\s+pin\s+is\b/i, reason: "sensitive_security_otp" },
  { pattern: /\bpasscode\b/i, reason: "sensitive_security_otp" },
];

/**
 * Checks whether an incoming message is a sensitive security/auth message.
 */
export function checkSensitiveMessage(params: {
  from?: string;
  subject?: string;
  snippet?: string;
}): SensitiveCheckResult {
  const from = (params.from || "").toLowerCase();
  const subject = (params.subject || "").toLowerCase();
  const snippet = (params.snippet || "").toLowerCase();

  // 1. Check subject patterns
  for (const { pattern, reason } of SENSITIVE_SUBJECT_PATTERNS) {
    if (pattern.test(subject)) {
      return { isSensitive: true, reason };
    }
  }

  // 2. Check sender patterns combined with auth keywords in subject or snippet
  const senderMatches = SENSITIVE_SENDER_PATTERNS.some((p) => p.test(from));
  if (senderMatches) {
    if (
      /\b(?:code|pin|password|sign-in|login|verify|token|alert)\b/i.test(subject) ||
      /\b(?:your verification code|enter this code|security code)\b/i.test(snippet)
    ) {
      return { isSensitive: true, reason: "sensitive_security_otp" };
    }
  }

  // 3. Fallback snippet inspection for explicit OTP patterns
  if (
    /\byour (?:single-use|verification|login) code is \d{4,8}\b/i.test(snippet) ||
    /\bdo not share this code\b/i.test(snippet)
  ) {
    return { isSensitive: true, reason: "sensitive_security_otp" };
  }

  return { isSensitive: false };
}

/**
 * Strips any embedded security codes (e.g. 6-8 digit numbers) from subject line.
 */
export function sanitizeSubject(subject: string): string {
  if (!subject) return "";
  // Redact sequences of 4-8 digits surrounded by word boundaries or punctuation
  return subject
    .replace(/\b\d{4,8}\b/g, "[REDACTED]")
    .replace(/(?:code|pin|otp)[:\s]+\S+/gi, "code: [REDACTED]")
    .trim();
}

/**
 * Strips sender personal name if it contains credentials, leaving domain.
 */
export function sanitizeSender(from: string): string {
  if (!from) return "";
  const match = from.match(/<([^>]+)>/);
  if (match && match[1]) {
    return match[1].toLowerCase().trim();
  }
  return from.toLowerCase().trim();
}

/**
 * Computes deterministic SHA-256 content hash.
 * If message is sensitive, hashes only mailbox + message ID + timestamp to prevent hashing secrets.
 */
export async function computeContentHash(params: {
  mailbox: string;
  messageId: string;
  internalDate: string | number;
  subject?: string;
  snippet?: string;
  isSensitive?: boolean;
}): Promise<string> {
  const { mailbox, messageId, internalDate, subject, snippet, isSensitive } = params;

  let rawString: string;
  if (isSensitive) {
    // Salted metadata-only hash for sensitive items
    rawString = `sensitive:${mailbox.toLowerCase()}:${messageId}:${internalDate}`;
  } else {
    // Normal content hash of message ID, timestamp, sanitized subject, and snippet preview
    const cleanSub = sanitizeSubject(subject || "");
    const cleanSnippet = (snippet || "").slice(0, 100);
    rawString = `${mailbox.toLowerCase()}:${messageId}:${internalDate}:${cleanSub}:${cleanSnippet}`;
  }

  const msgUint8 = new TextEncoder().encode(rawString);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

