import test from "node:test";
import assert from "node:assert/strict";

const VERIFIED_REDIRECT_URIS = [
  "https://grok.com/connectors-oauth-exchange-code/",
  "https://www.cursor.com/agents/mcp/oauth/callback",
];

function isVerifiedRedirectUri(uri) {
  if (!uri) return false;
  return VERIFIED_REDIRECT_URIS.includes(uri);
}

function parseAndValidateScopes(scopeString) {
  const allowed = ["openid", "profile", "email", "offline_access"];
  const requested = (scopeString || "").split(/\s+/).filter(Boolean);
  const validated = requested.filter((s) => allowed.includes(s));
  return {
    isValid: validated.length > 0,
    scopes: validated,
    unrecognized: requested.filter((s) => !allowed.includes(s)),
  };
}

function evaluateOAuthGrant({ clientId, redirectUri, isConfigured }) {
  // Fail-closed policy: If client is not verified or server config is not ready, grant MUST be rejected
  if (!isConfigured) {
    return {
      allowed: false,
      reason: "Live OAuth Server configuration required. Simulated code grants disabled.",
    };
  }
  if (!clientId || !isVerifiedRedirectUri(redirectUri)) {
    return {
      allowed: false,
      reason: "Unverified client ID or redirect URI.",
    };
  }
  return { allowed: true };
}

test("OAuth: trusted redirect URIs pass whitelist", () => {
  assert.equal(isVerifiedRedirectUri("https://grok.com/connectors-oauth-exchange-code/"), true);
  assert.equal(isVerifiedRedirectUri("https://www.cursor.com/agents/mcp/oauth/callback"), true);
});

test("OAuth: untrusted / malicious redirect URIs are rejected", () => {
  assert.equal(isVerifiedRedirectUri("https://evil.attacker.com/oauth/callback"), false);
  assert.equal(isVerifiedRedirectUri("http://insecure-grok.com/callback"), false);
  assert.equal(isVerifiedRedirectUri("javascript:alert(1)"), false);
  assert.equal(isVerifiedRedirectUri("https://grok.com/connectors-oauth-exchange-code/?injected=evil"), false);
  assert.equal(isVerifiedRedirectUri(""), false);
});

test("OAuth: scope validation recognizes standard OpenID scopes", () => {
  const result = parseAndValidateScopes("openid profile email offline_access");
  assert.equal(result.isValid, true);
  assert.equal(result.scopes.length, 4);
  assert.equal(result.unrecognized.length, 0);
});

test("OAuth: filters out unrecognized custom scopes for security", () => {
  const result = parseAndValidateScopes("openid superadmin root_access");
  assert.equal(result.isValid, true);
  assert.deepEqual(result.scopes, ["openid"]);
  assert.deepEqual(result.unrecognized, ["superadmin", "root_access"]);
});

test("OAuth: blocks simulated grant generation and rejects unconfigured server", () => {
  const result = evaluateOAuthGrant({
    clientId: "arbitrary-dynamic-client",
    redirectUri: "https://grok.com/connectors-oauth-exchange-code/",
    isConfigured: false,
  });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /Simulated code grants disabled/);
});
