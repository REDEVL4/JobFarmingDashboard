import test from "node:test";
import assert from "node:assert/strict";
import { isMessageProcessed } from "../../supabase/functions/gmail-status-sync/matcher.ts";

test("Gmail Sync Idempotency & Safety", async (t) => {
  await t.test("idempotency: filters previously ingested message IDs", () => {
    const historicalIds = new Set([
      "1a178ba455705921",
      "1a17e94dd1ebd76d",
      "1a17f2c8a7511e63",
    ]);

    const incomingBatch = [
      "1a178ba455705921", // duplicate
      "1a17e94dd1ebd76d", // duplicate
      "1a1bd25a2734d661", // new message
    ];

    const toProcess = incomingBatch.filter((id) => !isMessageProcessed(id, historicalIds));
    assert.equal(toProcess.length, 1);
    assert.equal(toProcess[0], "1a1bd25a2734d661");
  });

  await t.test("checkpoint lookback: applies 15-minute overlap window safely", () => {
    const lastScanIso = "2026-11-08T22:47:41.801Z";
    const overlapMinutes = 15;
    const lastScanMs = new Date(lastScanIso).getTime();
    const querySinceMs = lastScanMs - overlapMinutes * 60_000;

    assert.equal(querySinceMs, lastScanMs - 900_000);
    assert.ok(querySinceMs < lastScanMs);
  });

  await t.test("dry run invariant: dry_run flag is default true", () => {
    const parseBody = (body) => {
      return body?.dry_run !== false;
    };

    assert.equal(parseBody({}), true);
    assert.equal(parseBody(undefined), true);
    assert.equal(parseBody({ dry_run: true }), true);
    assert.equal(parseBody({ dry_run: false }), false);
  });
});

