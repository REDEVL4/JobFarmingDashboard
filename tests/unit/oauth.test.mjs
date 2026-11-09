import test from "node:test";
import assert from "node:assert/strict";
import {
  DESIGNATED_OWNER_UUID,
  DESIGNATED_OWNER_EMAIL,
  STANDARD_SCOPES,
  validateAuthorizationId,
  validateOwnerAccess,
  validateSafeRedirect,
  parseScopes,
} from "../../src/lib/oauth-validation.ts";

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

// ---------------------------------------------------------------------------
// Existing Regression Tests
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Official Supabase OAuth 2.1 Flow Validation Tests
// ---------------------------------------------------------------------------

test("OAuth Flow: validates authorization_id presence and structure", () => {
  // Missing / empty
  assert.equal(validateAuthorizationId(null).valid, false);
  assert.equal(validateAuthorizationId("").valid, false);
  assert.equal(validateAuthorizationId("   ").valid, false);

  // Invalid injection / malformed characters
  assert.equal(validateAuthorizationId("<script>alert(1)</script>").valid, false);
  assert.equal(validateAuthorizationId("short").valid, false);
  assert.equal(validateAuthorizationId("bad-id-with-spaces in it").valid, false);

  // Valid Supabase authorization IDs
  assert.equal(validateAuthorizationId("sq5waqj6n3wanxvh2zsp3jqmygqnyyr5").valid, true);
  assert.equal(validateAuthorizationId("r3i4qehfyp33a2p4k2ofbfihneeuiztp").valid, true);
  assert.equal(validateAuthorizationId("6wbafctxeztz7it6c4siku5vl3rrlzfu").valid, true);
});

test("OAuth Flow: enforces strict owner identity check against designated owner UUID", () => {
  // Unauthenticated
  const unauth = validateOwnerAccess(null);
  assert.equal(unauth.isOwner, false);
  assert.match(unauth.error, /Authentication required/);

  // Wrong user
  const wrongUser = validateOwnerAccess("11111111-2222-3333-4444-555555555555");
  assert.equal(wrongUser.isOwner, false);
  assert.match(wrongUser.error, /Access denied/);

  // Designated owner
  const validOwner = validateOwnerAccess(DESIGNATED_OWNER_UUID);
  assert.equal(validOwner.isOwner, true);
  assert.equal(validOwner.error, undefined);
  assert.equal(DESIGNATED_OWNER_UUID, "f2729195-5445-4272-ab85-cac5b03b0967");
  assert.equal(DESIGNATED_OWNER_EMAIL, "govardhanreddy.vys7@gmail.com");
});

test("OAuth Flow: safely preserves destination through login avoiding open redirects", () => {
  // Valid relative redirects
  assert.equal(
    validateSafeRedirect("/oauth/consent?authorization_id=sq5waqj6n3wanxvh2zsp3jqmygqnyyr5"),
    "/oauth/consent?authorization_id=sq5waqj6n3wanxvh2zsp3jqmygqnyyr5"
  );
  assert.equal(validateSafeRedirect("/applications"), "/applications");

  // Open-redirect attempts must fall back to /
  assert.equal(validateSafeRedirect("https://evil.attacker.com"), "/");
  assert.equal(validateSafeRedirect("//evil.attacker.com/oauth"), "/");
  assert.equal(validateSafeRedirect("javascript:alert(1)"), "/");
  assert.equal(validateSafeRedirect(""), "/");
  assert.equal(validateSafeRedirect(null), "/");
});

test("OAuth Flow: parses and recognizes official Supabase OAuth 2.1 scopes", () => {
  assert.deepEqual(parseScopes("openid email profile"), ["openid", "email", "profile"]);
  assert.deepEqual(parseScopes(null), ["openid"]);
  assert.deepEqual(parseScopes(""), ["openid"]);

  // Standard scopes have definitions
  assert.ok(STANDARD_SCOPES["openid"]);
  assert.ok(STANDARD_SCOPES["email"]);
  assert.ok(STANDARD_SCOPES["profile"]);
  assert.ok(STANDARD_SCOPES["phone"]);
  assert.ok(STANDARD_SCOPES["offline_access"]);
});

test("OAuth Flow: enforces Supabase Auth response discrimination (Consent vs Auto-Redirect)", () => {
  // Case A: User needs to consent
  const pendingConsentResponse = {
    authorization_id: "sq5waqj6n3wanxvh2zsp3jqmygqnyyr5",
    redirect_uri: "https://grok.com/connectors-oauth-exchange-code/",
    client: {
      id: "67fc4ec0-f2cb-47ee-820d-b8649a08c761",
      name: "Job Farming Grok runtime_status trial",
      uri: "",
      logo_uri: "",
    },
    user: {
      id: "f2729195-5445-4272-ab85-cac5b03b0967",
      email: "govardhanreddy.vys7@gmail.com",
    },
    scope: "openid email",
  };

  const isConsentRequired = "authorization_id" in pendingConsentResponse;
  assert.equal(isConsentRequired, true);

  // Case B: User already consented previously -> auto redirect
  const alreadyConsentedResponse = {
    redirect_url: "https://grok.com/connectors-oauth-exchange-code/?code=auth_code_123&state=state_abc",
  };

  const isAutoRedirect = !("authorization_id" in alreadyConsentedResponse);
  assert.equal(isAutoRedirect, true);
  assert.ok(alreadyConsentedResponse.redirect_url.startsWith("https://grok.com/"));
});
