import test from "node:test";
import assert from "node:assert/strict";

const TRUSTED_REDIRECT_URIS = [
  "https://grok.com/connectors-oauth-exchange-code/",
  "https://www.cursor.com/agents/mcp/oauth/callback",
];

function isTrustedRedirectUri(uri) {
  try {
    const url = new URL(uri);
    return TRUSTED_REDIRECT_URIS.some((trusted) => {
      const trustedUrl = new URL(trusted);
      return url.origin === trustedUrl.origin && url.pathname.startsWith(trustedUrl.pathname);
    });
  } catch {
    return false;
  }
}

function parseAndValidateScopes(scopeString) {
  const allowed = ["openid", "profile", "email", "phone", "offline_access"];
  const requested = (scopeString || "").split(/\s+/).filter(Boolean);
  const validated = requested.filter((s) => allowed.includes(s));
  return {
    isValid: validated.length > 0,
    scopes: validated,
    unrecognized: requested.filter((s) => !allowed.includes(s)),
  };
}

test("OAuth: trusted redirect URIs pass whitelist", () => {
  assert.equal(isTrustedRedirectUri("https://grok.com/connectors-oauth-exchange-code/"), true);
  assert.equal(isTrustedRedirectUri("https://www.cursor.com/agents/mcp/oauth/callback"), true);
});

test("OAuth: untrusted / malicious redirect URIs are rejected", () => {
  assert.equal(isTrustedRedirectUri("https://evil.attacker.com/oauth/callback"), false);
  assert.equal(isTrustedRedirectUri("http://insecure-grok.com/callback"), false);
  assert.equal(isTrustedRedirectUri("javascript:alert(1)"), false);
  assert.equal(isTrustedRedirectUri(""), false);
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

