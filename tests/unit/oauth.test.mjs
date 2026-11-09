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
function evaluateMcpAuth(jwtClaims, toolName = "runtime_status") {
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
  // Enforce read-only tool restriction for OAuth tokens
  if (toolName !== "runtime_status") {
    return {
      allowed: false,
      status: 403,
      error: `Tool '${toolName}' is disabled for OAuth clients. Only read-only 'runtime_status' is permitted.`,
    };
  }
  return { allowed: true };
}

// Helper for simulating PostgREST Data API RLS policy evaluation
function evaluateRlsPolicy({ uid, claims }) {
  const isOwner = uid === DESIGNATED_OWNER_UUID;
  const isDirectDashboardSession = claims?.client_id === undefined || claims?.client_id === null;
  return isOwner && isDirectDashboardSession;
}

// Helper for evaluating consent details response from Supabase Auth
function evaluateConsentResponse(data) {
  if (!data || !("authorization_id" in data) || !("client" in data) || !data.client || !data.client.id) {
    return {
      trusted: false,
      blocked: true,
      reason: "Automatic approval blocked: Request lacks verified client linkage. Fresh verified authorization flow required.",
    };
  }
  return validateOAuthClient(data.client, data.redirect_uri);
}

// Helper for simulating Database RPC authorization gates
function evaluateRpcAccess({ functionName, isMutation, claims }) {
  const isOwner = claims?.sub === DESIGNATED_OWNER_UUID;
  const isServiceRole = claims?.role === "service_role";
  const hasClientId = Boolean(claims?.client_id);
  const isApprovedGrok = claims?.client_id === ACTIVE_GROK_CLIENT_ID;

  if (isServiceRole) return { allowed: true };
  if (!isOwner) return { allowed: false, error: "Owner required" };

  if (functionName === "jf_owner_runtime_status") {
    if (!hasClientId || isApprovedGrok) return { allowed: true };
    return { allowed: false, error: "Unauthorized OAuth client" };
  }

  if (isMutation) {
    if (hasClientId) {
      return { allowed: false, error: "OAuth tokens are not permitted to invoke work mutation functions" };
    }
    return { allowed: true };
  }

  return { allowed: true };
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
// 6. Current Consent Request Cannot Reuse Another Client's Grant
// ---------------------------------------------------------------------------
test("OAuth: blocks automatic redirect when response lacks verified client details", () => {
  // Case A: Supabase returns only redirect_url without authorization_id/client details
  const autoRedirectResponse = {
    redirect_url: "https://grok.com/connectors-oauth-exchange-code/?code=auth_123&state=state_abc",
  };
  const evaluated = evaluateConsentResponse(autoRedirectResponse);
  assert.equal(evaluated.trusted, false);
  assert.equal(evaluated.blocked, true);
  assert.match(evaluated.reason, /Automatic approval blocked: Request lacks verified client linkage/);

  // Case B: Explicit verified authorization details matching approved Grok client
  const freshConsentResponse = {
    authorization_id: "sq5waqj6n3wanxvh2zsp3jqmygqnyyr5",
    client: { id: ACTIVE_GROK_CLIENT_ID, name: "Grok" },
    redirect_uri: VERIFIED_GROK_CALLBACK_URI,
  };
  const evaluatedFresh = evaluateConsentResponse(freshConsentResponse);
  assert.equal(evaluatedFresh.trusted, true);
  assert.equal(evaluatedFresh.clientId, ACTIVE_GROK_CLIENT_ID);

  // Case C: Explicit details but unapproved client attempting to claim Grok callback
  const unapprovedDetails = {
    authorization_id: "sq5waqj6n3wanxvh2zsp3jqmygqnyyr5",
    client: { id: "3a6b0c2a-51fb-43c8-8625-3056092fad8e", name: "Cursor" },
    redirect_uri: VERIFIED_GROK_CALLBACK_URI,
  };
  const evaluatedUnapproved = evaluateConsentResponse(unapprovedDetails);
  assert.equal(evaluatedUnapproved.trusted, false);
  assert.equal(evaluatedUnapproved.isPendingApproval, true);
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
// 9. Privileged RPC Access & MCP Tool Gating
// ---------------------------------------------------------------------------
test("RPC & MCP: authorizes approved Grok client for runtime_status but denies mutation RPCs", () => {
  const grokClaims = {
    sub: DESIGNATED_OWNER_UUID,
    role: "authenticated",
    client_id: ACTIVE_GROK_CLIENT_ID,
  };

  // 1. Grok is allowed to execute read-only runtime_status tool in MCP
  const mcpStatus = evaluateMcpAuth(grokClaims, "runtime_status");
  assert.equal(mcpStatus.allowed, true);

  // 2. Grok is allowed to execute jf_owner_runtime_status in DB
  const dbStatus = evaluateRpcAccess({
    functionName: "jf_owner_runtime_status",
    isMutation: false,
    claims: grokClaims,
  });
  assert.equal(dbStatus.allowed, true);

  // 3. Grok is DENIED executing mutating tools in MCP (claim_work / complete_work)
  const mcpClaim = evaluateMcpAuth(grokClaims, "claim_work");
  assert.equal(mcpClaim.allowed, false);
  assert.equal(mcpClaim.status, 403);
  assert.match(mcpClaim.error, /disabled for OAuth clients/);

  const mcpComplete = evaluateMcpAuth(grokClaims, "complete_work");
  assert.equal(mcpComplete.allowed, false);
  assert.equal(mcpComplete.status, 403);
  assert.match(mcpComplete.error, /disabled for OAuth clients/);

  // 4. Grok is DENIED executing privileged mutation RPCs directly in DB
  const dbClaim = evaluateRpcAccess({
    functionName: "jf_owner_claim_work",
    isMutation: true,
    claims: grokClaims,
  });
  assert.equal(dbClaim.allowed, false);
  assert.match(dbClaim.error, /OAuth tokens are not permitted/);

  const dbComplete = evaluateRpcAccess({
    functionName: "jf_owner_complete_work",
    isMutation: true,
    claims: grokClaims,
  });
  assert.equal(dbComplete.allowed, false);
  assert.match(dbComplete.error, /OAuth tokens are not permitted/);

  const dbConfig = evaluateRpcAccess({
    functionName: "jf_configure_work_webhook",
    isMutation: true,
    claims: grokClaims,
  });
  assert.equal(dbConfig.allowed, false);
  assert.match(dbConfig.error, /OAuth tokens are not permitted/);
});

// ---------------------------------------------------------------------------
// 10. First-Party Dashboard & Service-Role RPC Access
// ---------------------------------------------------------------------------
test("RPC: permits first-party owner and service-role to execute mutation RPCs", () => {
  const dashboardClaims = {
    sub: DESIGNATED_OWNER_UUID,
    role: "authenticated",
    email: DESIGNATED_OWNER_EMAIL,
    // client_id is NULL
  };

  const dashboardAccess = evaluateRpcAccess({
    functionName: "jf_owner_claim_work",
    isMutation: true,
    claims: dashboardClaims,
  });
  assert.equal(dashboardAccess.allowed, true);

  const serviceRoleClaims = {
    role: "service_role",
  };
  const serviceRoleAccess = evaluateRpcAccess({
    functionName: "jf_confirm_outreach_sent",
    isMutation: true,
    claims: serviceRoleClaims,
  });
  assert.equal(serviceRoleAccess.allowed, true);
});

// ---------------------------------------------------------------------------
// 11. Denial of Unauthorized Callers
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

  // Unapproved Cursor client
  assert.equal(
    evaluateMcpAuth({ sub: DESIGNATED_OWNER_UUID, role: "authenticated", client_id: "7a493089-0500-4b0d-8a00-12140c16ac52" }).allowed,
    false
  );

  // Unapproved trial client
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
