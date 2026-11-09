import test from "node:test";
import assert from "node:assert/strict";

const DESIGNATED_OWNER_UUID = "f2729195-5445-4272-ab85-cac5b03b0967";

function verifyOwnerSession(user, anonKey) {
  // Fail-closed check: credentials
  if (!anonKey || anonKey === "placeholder_anon_key") {
    return { authorized: false, error: "missing_credentials" };
  }
  // Fail-closed check: session existence
  if (!user || !user.id) {
    return { authorized: false, error: "no_session" };
  }
  // Fail-closed check: designated owner identity
  if (user.id !== DESIGNATED_OWNER_UUID) {
    return { authorized: false, error: "unauthorized_owner" };
  }
  return { authorized: true };
}

test("Auth Security: permits designated owner with valid credentials", () => {
  const result = verifyOwnerSession(
    { id: "f2729195-5445-4272-ab85-cac5b03b0967", email: "govardhanreddy.vys7@gmail.com" },
    "valid_publishable_anon_token"
  );
  assert.equal(result.authorized, true);
  assert.equal(result.error, undefined);
});

test("Auth Security: rejects wrong-owner session immediately", () => {
  const result = verifyOwnerSession(
    { id: "00000000-0000-0000-0000-000000000000", email: "attacker@example.com" },
    "valid_publishable_anon_token"
  );
  assert.equal(result.authorized, false);
  assert.equal(result.error, "unauthorized_owner");
});

test("Auth Security: fails closed when publishable credentials are missing or placeholder", () => {
  const missingResult = verifyOwnerSession(
    { id: DESIGNATED_OWNER_UUID },
    ""
  );
  assert.equal(missingResult.authorized, false);
  assert.equal(missingResult.error, "missing_credentials");

  const placeholderResult = verifyOwnerSession(
    { id: DESIGNATED_OWNER_UUID },
    "placeholder_anon_key"
  );
  assert.equal(placeholderResult.authorized, false);
  assert.equal(placeholderResult.error, "missing_credentials");
});

test("Auth Security: fails closed when session is null/empty", () => {
  const result = verifyOwnerSession(null, "valid_publishable_anon_token");
  assert.equal(result.authorized, false);
  assert.equal(result.error, "no_session");
});

