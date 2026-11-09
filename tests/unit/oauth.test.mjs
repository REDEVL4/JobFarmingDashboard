import test from "node:test";
import assert from "node:assert/strict";
import {
  DESIGNATED_OWNER_UUID,
  DESIGNATED_OWNER_EMAIL,
  ACTIVE_GROK_CLIENT_ID,
  TRUSTED_STATIC_CLIENT_IDS,
  TRUSTED_OAUTH_CLIENT_IDS,
  VERIFIED_GROK_CALLBACK_URI,
  STANDARD_SCOPES,
  validateAuthorizationId,
  validateOwnerAccess,
  validateSafeRedirect,
  parseScopes,
  validateOAuthClient,
  validateAutoRedirectUrl,
} from "../../src/lib/oauth-validation.ts";

// Helper for simulating MCP pipeline authorization
function evaluateMcpAuth(jwtClaims) {
  if (jwtClaims?.sub !== DESIGNATED_OWNER_UUID) {
    return { allowed: false, status: 403, error: "Owner authentication required" };
  }
  if (jwtClaims?.role !== "authenticated") {
    return { allowed: false, status: 403, error: "Authenticated role required" };
  }
  const clientId = jwtClaims?.client_id;
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!clientId || typeof clientId !== "string" || !UUID_REGEX.test(clientId)) {
    return { allowed: false, status: 403, error: "Present and valid OAuth client_id required" };
  }
  if (!TRUSTED_OAUTH_CLIENT_IDS.has(clientId)) {
    return { allowed: false, status: 403, error: "Unauthorized OAuth client" };
  }
  return { allowed: true };
}

// Helper for simulating PostgREST Data API RLS policy evaluation
function evaluateRlsPolicy({ uid, claims }) {
  const isOwner = uid === DESIGNATED_OWNER_UUID;
  const isDirectDashboardSession = claims?.client_id === undefined || claims?.client_id === null;
  return isOwner && isDirectDashboardSession;
}

// ---------------------------------------------------------------------------
// 1. Missing Client ID
// ---------------------------------------------------------------------------
test("OAuth: rejects missing, null, empty, and non-UUID client IDs", () => {
  // Consent validation
  assert.equal(validateOAuthClient(null, VERIFIED_GROK_CALLBACK_URI).trusted, false);
  assert.equal(validateOAuthClient({ id: "" }, VERIFIED_GROK_CALLBACK_URI).trusted, false);
  assert.equal(validateOAuthClient({ id: "invalid-uuid" }, VERIFIED_GROK_CALLBACK_URI).trusted, false);

  // MCP fail-closed check
  const missingInMcp = evaluateMcpAuth({
    sub: DESIGNATED_OWNER_UUID,
    role: "authenticated",
  });
  assert.equal(missingInMcp.allowed, false);
  assert.equal(missingInMcp.status, 403);
  assert.match(missingInMcp.error, /Present and valid OAuth client_id required/);

  const nullInMcp = evaluateMcpAuth({
    sub: DESIGNATED_OWNER_UUID,
    role: "authenticated",
    client_id: null,
  });
  assert.equal(nullInMcp.allowed, false);
  assert.equal(nullInMcp.status, 403);
  assert.match(nullInMcp.error, /Present and valid OAuth client_id required/);
});

// ---------------------------------------------------------------------------
// 2. Unknown Client ID with Correct Grok Callback
// ---------------------------------------------------------------------------
test("OAuth: rejects unknown client ID even if present with verified Grok callback", () => {
  const unknownClient = {
    id: "99999999-9999-9999-9999-999999999999",
    name: "Grok",
  };
  const res = validateOAuthClient(unknownClient, VERIFIED_GROK_CALLBACK_URI);
  assert.equal(res.trusted, false);
  assert.equal(res.isPendingApproval, true);
  assert.match(res.reason, /not in the active authorized allowlist/);

  // MCP rejects unknown client ID
  const mcpRes = evaluateMcpAuth({
    sub: DESIGNATED_OWNER_UUID,
    role: "authenticated",
    client_id: unknownClient.id,
  });
  assert.equal(mcpRes.allowed, false);
  assert.equal(mcpRes.status, 403);
  assert.match(mcpRes.error, /Unauthorized OAuth client/);
});

// ---------------------------------------------------------------------------
// 3. Trusted ID with Incorrect Callback
// ---------------------------------------------------------------------------
test("OAuth: rejects trusted client ID when presenting incorrect or unauthorized callback URI", () => {
  // Malicious redirect
  const evilCallback = validateOAuthClient(
    { id: ACTIVE_GROK_CLIENT_ID, name: "Grok" },
    "https://evil.attacker.com/oauth/callback"
  );
  assert.equal(evilCallback.trusted, false);
  assert.match(evilCallback.reason, /Unauthorized callback URI/);

  // Inactive / Cursor redirect
  const cursorCallback = validateOAuthClient(
    { id: ACTIVE_GROK_CLIENT_ID, name: "Grok" },
    "https://www.cursor.com/agents/mcp/oauth/callback"
  );
  assert.equal(cursorCallback.trusted, false);
  assert.match(cursorCallback.reason, /Unauthorized callback URI/);

  // Query parameter injection in callback
  const injectedCallback = validateOAuthClient(
    { id: ACTIVE_GROK_CLIENT_ID, name: "Grok" },
    "https://grok.com/connectors-oauth-exchange-code/?injected=evil"
  );
  assert.equal(injectedCallback.trusted, false);
  assert.match(injectedCallback.reason, /Unauthorized callback URI/);
});

// ---------------------------------------------------------------------------
// 4. Known Approved Grok Client
// ---------------------------------------------------------------------------
test("OAuth: successfully verifies known approved Grok client with exact callback URI", () => {
  const res = validateOAuthClient(
    { id: ACTIVE_GROK_CLIENT_ID, name: "Grok" },
    VERIFIED_GROK_CALLBACK_URI
  );
  assert.equal(res.trusted, true);
  assert.equal(res.connector, "grok");
  assert.equal(res.clientId, ACTIVE_GROK_CLIENT_ID);
  assert.equal(res.isKnownStatic, true);
  assert.equal(res.redirectUri, VERIFIED_GROK_CALLBACK_URI);
});

// ---------------------------------------------------------------------------
// 5. Dynamic Client Registration Awaiting Explicit Approval
// ---------------------------------------------------------------------------
test("OAuth: keeps dynamically registered clients untrusted until explicit owner approval", () => {
  const dynamicRegistration = {
    id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    name: "Grok Dynamic Registration",
  };
  const res = validateOAuthClient(dynamicRegistration, VERIFIED_GROK_CALLBACK_URI);
  assert.equal(res.trusted, false);
  assert.equal(res.isPendingApproval, true);
  assert.match(res.reason, /Unknown or dynamically registered clients require explicit owner approval/);
});

// ---------------------------------------------------------------------------
// 6. Previously Consented Unknown Client (Auto-Redirect Bypass Check)
// ---------------------------------------------------------------------------
test("OAuth: blocks auto-redirect when target is unauthorized or client grant is untrusted", () => {
  // Case A: Redirect points to unauthorized destination
  const cursorAutoRedirect = validateAutoRedirectUrl(
    "https://www.cursor.com/agents/mcp/oauth/callback?code=auth_123&state=state_abc"
  );
  assert.equal(cursorAutoRedirect.valid, false);
  assert.match(cursorAutoRedirect.error, /Unauthorized auto-redirect destination/);

  // Case B: Valid Grok redirect URL
  const grokAutoRedirect = validateAutoRedirectUrl(
    "https://grok.com/connectors-oauth-exchange-code/?code=auth_123&state=state_abc"
  );
  assert.equal(grokAutoRedirect.valid, true);

  // Case C: Grants verification - user has only Cursor grant, no trusted Grok grant
  const cursorOnlyGrants = [
    { client: { id: "7a493089-0500-4b0d-8a00-12140c16ac52", name: "Cursor" }, scopes: ["email"] },
  ];
  const hasTrusted = cursorOnlyGrants.some((g) => TRUSTED_OAUTH_CLIENT_IDS.has(g.client.id));
  assert.equal(hasTrusted, false);

  // Case D: Grants verification - user has approved Grok grant
  const approvedGrokGrants = [
    { client: { id: ACTIVE_GROK_CLIENT_ID, name: "Grok" }, scopes: ["openid"] },
  ];
  const hasApproved = approvedGrokGrants.some((g) => TRUSTED_OAUTH_CLIENT_IDS.has(g.client.id));
  assert.equal(hasApproved, true);
});

// ---------------------------------------------------------------------------
// 7. OAuth Direct Data API Access (RLS Isolation)
// ---------------------------------------------------------------------------
test("OAuth RLS: third-party OAuth access token is blocked from direct table access", () => {
  const oauthTokenClaims = {
    sub: DESIGNATED_OWNER_UUID,
    role: "authenticated",
    client_id: ACTIVE_GROK_CLIENT_ID,
  };

  const isAccessAllowed = evaluateRlsPolicy({
    uid: DESIGNATED_OWNER_UUID,
    claims: oauthTokenClaims,
  });

  // Direct table access MUST be denied for OAuth access tokens
  assert.equal(isAccessAllowed, false);
});

// ---------------------------------------------------------------------------
// 8. Normal Owner Dashboard Access
// ---------------------------------------------------------------------------
test("OAuth RLS: direct first-party owner dashboard session retains full table access", () => {
  const directDashboardClaims = {
    sub: DESIGNATED_OWNER_UUID,
    role: "authenticated",
    email: DESIGNATED_OWNER_EMAIL,
    // client_id is NULL / undefined for regular login
  };

  const isAccessAllowed = evaluateRlsPolicy({
    uid: DESIGNATED_OWNER_UUID,
    claims: directDashboardClaims,
  });

  // Direct owner dashboard access MUST be permitted
  assert.equal(isAccessAllowed, true);
});

// ---------------------------------------------------------------------------
// 9. MCP runtime_status Authorization
// ---------------------------------------------------------------------------
test("MCP: authorizes approved Grok client to execute runtime_status tool", () => {
  const validGrokClaims = {
    sub: DESIGNATED_OWNER_UUID,
    role: "authenticated",
    client_id: ACTIVE_GROK_CLIENT_ID,
  };

  const authResult = evaluateMcpAuth(validGrokClaims);
  assert.equal(authResult.allowed, true);
});

// ---------------------------------------------------------------------------
// 10. Denial of Unauthorized MCP Tool Access
// ---------------------------------------------------------------------------
test("MCP: strictly denies unauthorized callers and tools", () => {
  // Non-owner sub
  assert.equal(
    evaluateMcpAuth({ sub: "11111111-2222-3333-4444-555555555555", role: "authenticated", client_id: ACTIVE_GROK_CLIENT_ID }).allowed,
    false
  );

  // Anon role
  assert.equal(
    evaluateMcpAuth({ sub: DESIGNATED_OWNER_UUID, role: "anon", client_id: ACTIVE_GROK_CLIENT_ID }).allowed,
    false
  );

  // Removed Cursor client
  assert.equal(
    evaluateMcpAuth({ sub: DESIGNATED_OWNER_UUID, role: "authenticated", client_id: "7a493089-0500-4b0d-8a00-12140c16ac52" }).allowed,
    false
  );

  // Removed trial client
  assert.equal(
    evaluateMcpAuth({ sub: DESIGNATED_OWNER_UUID, role: "authenticated", client_id: "67fc4ec0-f2cb-47ee-820d-b8649a08c761" }).allowed,
    false
  );
});

// ---------------------------------------------------------------------------
// Redirect and Authorization ID Safety
// ---------------------------------------------------------------------------
test("OAuth Flow: validateSafeRedirect prevents protocol-relative and escaping attacks", () => {
  assert.equal(validateSafeRedirect("/oauth/consent?authorization_id=abc123456789"), "/oauth/consent?authorization_id=abc123456789");
  assert.equal(validateSafeRedirect("https://evil.com"), "/");
  assert.equal(validateSafeRedirect("//evil.com"), "/");
  assert.equal(validateSafeRedirect("/\\evil.com"), "/");
  assert.equal(validateSafeRedirect("/%5cevil.com"), "/");
  assert.equal(validateSafeRedirect("/%2fevil.com"), "/");
});

test("OAuth Flow: validateAuthorizationId strictly validates format", () => {
  assert.equal(validateAuthorizationId("sq5waqj6n3wanxvh2zsp3jqmygqnyyr5").valid, true);
  assert.equal(validateAuthorizationId("invalid id with spaces").valid, false);
  assert.equal(validateAuthorizationId(null).valid, false);
  assert.equal(validateAuthorizationId("").valid, false);
});
