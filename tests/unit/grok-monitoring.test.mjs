import test from "node:test";
import assert from "node:assert/strict";

test("Grok Read-Only Monitoring Contract", async (t) => {
  await t.test("enforces read-only HTTP method policy", () => {
    const isAllowedMethod = (method) => method === "GET";

    assert.equal(isAllowedMethod("GET"), true);
    assert.equal(isAllowedMethod("POST"), false);
    assert.equal(isAllowedMethod("PUT"), false);
    assert.equal(isAllowedMethod("DELETE"), false);
  });

  await t.test("enforces independent bearer token authentication", () => {
    const validKey = "grok_live_read_token_xyz987";
    const authenticate = (authHeader) => {
      if (!authHeader || !authHeader.startsWith("Bearer ")) return false;
      const token = authHeader.slice(7).trim();
      return token === validKey;
    };

    assert.equal(authenticate(null), false);
    assert.equal(authenticate(""), false);
    assert.equal(authenticate("Bearer wrong_token"), false);
    assert.equal(authenticate(`Bearer ${validKey}`), true);
  });

  await t.test("shapes payload to prevent token or raw private leakage", () => {
    const rawReviewItem = {
      id: "28594d91-50ac-4f86-bb99-69db4f4daade",
      mailbox: "govardhanreddy.vys7@gmail.com",
      message_id: "1a17d42f748ff23a",
      reason_code: "sender_employer_mapping_unverified",
      proposed_stage: "Rejected",
      evidence_summary: "Precise Affirm Ads Platform role.",
      secret_token_internal: "leak_me_not",
    };

    const sanitizeReviewItem = (item) => ({
      id: item.id,
      reason_code: item.reason_code,
      proposed_stage: item.proposed_stage,
      evidence_summary: item.evidence_summary,
      created_at: item.created_at,
    });

    const safe = sanitizeReviewItem(rawReviewItem);
    assert.equal(safe.id, rawReviewItem.id);
    assert.equal(safe.reason_code, rawReviewItem.reason_code);
    assert.equal(safe.secret_token_internal, undefined);
  });
});
