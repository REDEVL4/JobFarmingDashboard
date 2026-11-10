import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  DESIGNATED_OWNER_UUID,
  DESIGNATED_OWNER_EMAIL,
  ACTIVE_GROK_CLIENT_ID,
  TRUSTED_STATIC_CLIENT_IDS,
  TRUSTED_OAUTH_CLIENT_IDS,
  VERIFIED_GROK_CALLBACK_URI,
  VERIFIED_CURSOR_CALLBACK_URI,
  APPROVED_CURSOR_CLIENT_ID,
  STANDARD_SCOPES,
  validateAuthorizationId,
  validateOwnerAccess,
  validateSafeRedirect,
  parseScopes,
  validateOAuthClient,
  validateAutoRedirectUrl,
} from "../../src/lib/oauth-validation.ts";

// Mock database store for server-side client & consent validation
const MOCK_REGISTERED_CLIENTS = new Map([
  [ACTIVE_GROK_CLIENT_ID, { name: "Grok", redirect_uris: VERIFIED_GROK_CALLBACK_URI, deleted_at: null }],
  ["b54de595-6bce-4298-836c-2b46a2595904", { name: "Grok", redirect_uris: VERIFIED_GROK_CALLBACK_URI, deleted_at: null }],
  ["36ece66e-9691-4aeb-a129-2ba5cd9a39ce", { name: "Grok", redirect_uris: VERIFIED_GROK_CALLBACK_URI, deleted_at: null }],
  ["7a493089-0500-4b0d-8a00-12140c16ac52", { name: "Cursor", redirect_uris: "https://www.cursor.com/agents/mcp/oauth/callback", deleted_at: null }],
  ["evil-client-uuid-000000000001", { name: "Grok", redirect_uris: "https://evil.attacker.com/callback", deleted_at: null }],
]);

// Mock consents store: Map<`${userId}:${clientId}`, { revoked_at: Date | null }>
const MOCK_ACTIVE_CONSENTS = new Map([
  [`${DESIGNATED_OWNER_UUID}:${ACTIVE_GROK_CLIENT_ID}`, { scopes: "openid email", granted_at: new Date(), revoked_at: null }],
]);

// Helper simulating jobbot.validate_grok_oauth_client(p_client_id, p_user_id)
function evaluateServerSideValidator(clientId, userId, consentsStore = MOCK_ACTIVE_CONSENTS) {
  if (userId !== DESIGNATED_OWNER_UUID) return false;
  if (!clientId || typeof clientId !== "string") return false;

  const client = MOCK_REGISTERED_CLIENTS.get(clientId);
  if (!client || client.deleted_at !== null) return false;

  // Strict callback check
  const uris = client.redirect_uris.split(",").map((u) => u.trim());
  if (!uris.includes(VERIFIED_GROK_CALLBACK_URI)) return false;

  // Expected client name check
  if (!/^Grok/i.test(client.name)) return false;

  // Active unrevoked owner consent check
  const consent = consentsStore.get(`${userId}:${clientId}`);
  if (!consent || consent.revoked_at !== null) return false;

  return true;
}

// Helper for simulating MCP pipeline authorization with single source of truth validator
function evaluateMcpAuth(jwtClaims, toolName = "runtime_status", consentsStore = MOCK_ACTIVE_CONSENTS) {
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

  // Database-enforced client validation
  const isAuthorized = evaluateServerSideValidator(clientId, jwtClaims.sub, consentsStore);
  if (!isAuthorized) {
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
// 2. Mismatched Client Metadata or Callback Rejection
// ---------------------------------------------------------------------------
test("OAuth: rejects clients with mismatched name or metadata even with Grok callback", () => {
  const cursorClient = {
    id: "3a6b0c2a-51fb-43c8-8625-3056092fad8e",
    name: "Cursor",
  };
  const res = validateOAuthClient(cursorClient, VERIFIED_GROK_CALLBACK_URI);
  assert.equal(res.trusted, false);
  assert.match(res.reason, /Mismatched client metadata/);

  const maliciousClient = {
    id: "99999999-9999-9999-9999-999999999999",
    name: "MaliciousApp",
  };
  const resMalicious = validateOAuthClient(maliciousClient, VERIFIED_GROK_CALLBACK_URI);
  assert.equal(resMalicious.trusted, false);
  assert.match(resMalicious.reason, /Mismatched client metadata/);
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
// 4. Known Static Grok Client
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
  assert.equal(res.isDynamicRegistration, false);
  assert.equal(res.requiresInteractiveConsent, true);
  assert.equal(res.redirectUri, VERIFIED_GROK_CALLBACK_URI);
});

// ---------------------------------------------------------------------------
// 5. Dynamic Grok Client Registration & Consent Lifecycle
// ---------------------------------------------------------------------------
test("OAuth: accepts dynamic Grok registration on consent page but requires active owner consent", () => {
  const dynamicGrokId = "b54de595-6bce-4298-836c-2b46a2595904";
  const dynamicRegistration = {
    id: dynamicGrokId,
    name: "Grok",
  };

  // Step 1: Consent page validation recognizes dynamic Grok client
  const consentRes = validateOAuthClient(dynamicRegistration, VERIFIED_GROK_CALLBACK_URI);
  assert.equal(consentRes.trusted, true);
  assert.equal(consentRes.isDynamicRegistration, true);
  assert.equal(consentRes.requiresInteractiveConsent, true);
  assert.equal(consentRes.clientId, dynamicGrokId);

  // Step 2: Before owner gives consent, server-side validator and MCP reject access
  const tokenClaims = {
    sub: DESIGNATED_OWNER_UUID,
    role: "authenticated",
    client_id: dynamicGrokId,
  };
  const beforeConsent = evaluateMcpAuth(tokenClaims, "runtime_status");
  assert.equal(beforeConsent.allowed, false);
  assert.equal(beforeConsent.status, 403);
  assert.match(beforeConsent.error, /Unauthorized OAuth client/);

  // Step 3: Owner grants consent interactively on /oauth/consent
  MOCK_ACTIVE_CONSENTS.set(`${DESIGNATED_OWNER_UUID}:${dynamicGrokId}`, {
    scopes: "openid profile email",
    granted_at: new Date(),
    revoked_at: null,
  });

  // Step 4: After consent is granted, MCP access is permitted
  const afterConsent = evaluateMcpAuth(tokenClaims, "runtime_status");
  assert.equal(afterConsent.allowed, true);

  // Step 5: If owner revokes consent, access is immediately blocked
  MOCK_ACTIVE_CONSENTS.set(`${DESIGNATED_OWNER_UUID}:${dynamicGrokId}`, {
    scopes: "openid profile email",
    granted_at: new Date(),
    revoked_at: new Date(), // Revoked!
  });

  const afterRevoke = evaluateMcpAuth(tokenClaims, "runtime_status");
  assert.equal(afterRevoke.allowed, false);
  assert.equal(afterRevoke.status, 403);
  assert.match(afterRevoke.error, /Unauthorized OAuth client/);
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

  // Case C: Explicit details but mismatched client metadata
  const unapprovedDetails = {
    authorization_id: "sq5waqj6n3wanxvh2zsp3jqmygqnyyr5",
    client: { id: "3a6b0c2a-51fb-43c8-8625-3056092fad8e", name: "Cursor" },
    redirect_uri: VERIFIED_GROK_CALLBACK_URI,
  };
  const evaluatedUnapproved = evaluateConsentResponse(unapprovedDetails);
  assert.equal(evaluatedUnapproved.trusted, false);
  assert.match(evaluatedUnapproved.reason, /Mismatched client metadata/);
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
// 12. MCP Tool List Discovery (Only runtime_status exposed)
// ---------------------------------------------------------------------------
test("MCP: tools/list exposes only runtime_status and advertises zero mutation tools", () => {
  const edgeFunctionSource = fs.readFileSync(
    "supabase/functions/jf-grok-owner-mcp/index.ts",
    "utf-8"
  );

  // Assert runtime_status is registered
  assert.match(edgeFunctionSource, /server\.registerTool\(\s*['"]runtime_status['"]/);

  // Assert claim_work and complete_work are NOT registered
  assert.doesNotMatch(edgeFunctionSource, /server\.registerTool\(\s*['"]claim_work['"]/);
  assert.doesNotMatch(edgeFunctionSource, /server\.registerTool\(\s*['"]complete_work['"]/);
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

// ---------------------------------------------------------------------------
// 13. Edge Function Single-Source Audit
// ---------------------------------------------------------------------------
test("OAuth Edge Function: delegates client trust to database validator without hardcoded client IDs", () => {
  const edgeFunctionSource = fs.readFileSync(
    "supabase/functions/jf-grok-owner-mcp/index.ts",
    "utf-8"
  );

  // Verifies database validator delegation
  assert.match(edgeFunctionSource, /ctx\.supabase\.rpc\(\s*['"]jf_validate_grok_oauth_client['"]/);
  // Verifies no static hardcoded set of client IDs
  assert.doesNotMatch(edgeFunctionSource, /const\s+TRUSTED_CLIENT_IDS\s*=/);
  // Verifies only runtime_status is registered
  assert.match(edgeFunctionSource, /server\.registerTool\(\s*['"]runtime_status['"]/);
});

// ---------------------------------------------------------------------------
// 14. SQL Migration Audit
// ---------------------------------------------------------------------------
test("OAuth Migration: defines server-side validator checking registered client, callback, and unrevoked consent", () => {
  const migrationSql = fs.readFileSync(
    "supabase/migrations/20261109230000_permanent_grok_dynamic_oauth.sql",
    "utf-8"
  );

  assert.match(migrationSql, /CREATE OR REPLACE FUNCTION jobbot\.validate_grok_oauth_client/);
  assert.match(migrationSql, /CREATE OR REPLACE FUNCTION public\.jf_validate_grok_oauth_client/);
  assert.match(migrationSql, /auth\.oauth_clients/);
  assert.match(migrationSql, /https:\/\/grok\.com\/connectors-oauth-exchange-code\//);
  assert.match(migrationSql, /auth\.oauth_consents/);
  assert.match(migrationSql, /revoked_at IS NULL/);
  assert.match(migrationSql, /jobbot\.validate_grok_oauth_client\(v_client_id::uuid, v_uid\)/);
});



// ---------------------------------------------------------------------------
// 15. Explicitly reviewed Cursor Desktop registration (no arbitrary clients)
// ---------------------------------------------------------------------------
test("OAuth: approves only the specifically reviewed Cursor client registration", () => {
  const approved = validateOAuthClient(
    { id: APPROVED_CURSOR_CLIENT_ID, name: "Cursor" },
    VERIFIED_CURSOR_CALLBACK_URI
  );
  assert.equal(approved.trusted, true);
  assert.equal(approved.connector, "cursor");
  assert.equal(approved.requiresInteractiveConsent, true);
  assert.equal(approved.isKnownStatic, true);

  assert.equal(validateOAuthClient(
    { id: "7a493089-0500-4b0d-8a00-12140c16ac52", name: "Cursor" },
    VERIFIED_CURSOR_CALLBACK_URI
  ).trusted, false);
  assert.equal(validateOAuthClient(
    { id: APPROVED_CURSOR_CLIENT_ID, name: "Impostor" },
    VERIFIED_CURSOR_CALLBACK_URI
  ).trusted, false);
  assert.equal(validateOAuthClient(
    { id: APPROVED_CURSOR_CLIENT_ID, name: "Cursor" },
    "https://evil.example/callback"
  ).trusted, false);
  assert.equal(validateOAuthClient(
    { id: APPROVED_CURSOR_CLIENT_ID, name: "Cursor" },
    VERIFIED_GROK_CALLBACK_URI
  ).trusted, false);
  assert.equal(validateOAuthClient(
    { id: ACTIVE_GROK_CLIENT_ID, name: "Grok" },
    VERIFIED_GROK_CALLBACK_URI
  ).trusted, true);
});
