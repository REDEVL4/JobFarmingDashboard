/**
 * Sensitive Message Filter & Redaction Utilities for Grok Recruitment Intelligence
 */

export interface SensitiveCheckResult {
  isSensitive: boolean;
  reason?: "sensitive_security_otp" | "sensitive_password_reset" | "sensitive_security_alert" | "sensitive_auth_code";
}

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
  { pattern: /\b(?:verification|security|access|confirmation)\s+(?:code|pin|token|passcode)\b/i, reason: "sensitive_security_otp" },
  { pattern: /\b(?:one-time|one\s+time)\s+(?:password|passcode|pin)\b/i, reason: "sensitive_security_otp" },
  { pattern: /\b(?:otp|2fa|mfa)\b/i, reason: "sensitive_security_otp" },
  { pattern: /\b(?:reset|forgot)\s+(?:your\s+)?password\b/i, reason: "sensitive_password_reset" },
  { pattern: /\bpassword\s+reset\s+request\b/i, reason: "sensitive_password_reset" },
  { pattern: /\b(?:new\s+sign-in|new\s+login|unusual\s+activity|security\s+alert)\b/i, reason: "sensitive_security_alert" },
  { pattern: /\b(?:2|two)[-\s]step\s+verification\b/i, reason: "sensitive_security_otp" },
  { pattern: /\bverify\s+your\s+(?:identity|account|email|login)\b/i, reason: "sensitive_auth_code" },
  { pattern: /\byour\s+pin\s+is\b/i, reason: "sensitive_security_otp" },
  { pattern: /\bpasscode\b/i, reason: "sensitive_security_otp" },
];

export function checkSensitiveMessage(params: {
  from?: string;
  subject?: string;
  snippet?: string;
}): SensitiveCheckResult {
  const from = (params.from || "").toLowerCase();
  const subject = (params.subject || "").toLowerCase();
  const snippet = (params.snippet || "").toLowerCase();

  for (const { pattern, reason } of SENSITIVE_SUBJECT_PATTERNS) {
    if (pattern.test(subject)) {
      return { isSensitive: true, reason };
    }
  }

  const senderMatches = SENSITIVE_SENDER_PATTERNS.some((p) => p.test(from));
  if (senderMatches) {
    if (
      /\b(?:code|pin|password|sign-in|login|verify|token|alert)\b/i.test(subject) ||
      /\b(?:your verification code|enter this code|security code)\b/i.test(snippet)
    ) {
      return { isSensitive: true, reason: "sensitive_security_otp" };
    }
  }

  if (
    /\byour (?:single-use|verification|login) code is \d{4,8}\b/i.test(snippet) ||
    /\bdo not share this code\b/i.test(snippet)
  ) {
    return { isSensitive: true, reason: "sensitive_security_otp" };
  }

  return { isSensitive: false };
}

export function sanitizeText(text: string, maxLength = 2000): string {
  if (!text) return "";
  // Strip security verification codes
  const redacted = text
    .replace(/\b\d{4,8}\b/g, "[REDACTED]")
    .replace(/(?:code|pin|otp)[:\s]+\S+/gi, "code: [REDACTED]")
    .replace(/<[^>]+>/g, " ") // Strip HTML tags
    .replace(/\s+/g, " ")
    .trim();
  
  if (redacted.length > maxLength) {
    return redacted.slice(0, maxLength) + "... [truncated]";
  }
  return redacted;
}
