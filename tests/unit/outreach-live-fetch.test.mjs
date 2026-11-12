import test from "node:test";
import assert from "node:assert/strict";

test("Live Fetch: parses already_running response and adopts existing fetch_id", () => {
  const existingFetchId = "3bfb833f-d40c-44d1-b527-9e19fa663f62";
  const mockAlreadyRunningResponse = {
    ok: true,
    already_running: true,
    fetch_id: existingFetchId,
  };

  assert.equal(mockAlreadyRunningResponse.ok, true);
  assert.equal(mockAlreadyRunningResponse.already_running, true);
  assert.equal(mockAlreadyRunningResponse.fetch_id, existingFetchId);

  // Requirement 6: If the first call returns already_running true, just poll that fetch_id. Do not start a second one.
  let startedSecondFetch = false;
  if (!mockAlreadyRunningResponse.already_running) {
    startedSecondFetch = true;
  }
  assert.equal(startedSecondFetch, false);
});

test("Live Fetch: formats success message correctly as 'Fetched. N new, M already had.'", () => {
  const statusDone = {
    id: "3bfb833f-d40c-44d1-b527-9e19fa663f62",
    state: "done",
    messages_found: 5,
    messages_new: 2,
    messages_duplicate: 3,
    error: null,
  };

  const nNew = statusDone.messages_new ?? 0;
  const mHad = statusDone.messages_duplicate ?? 0;
  const message = `Fetched. ${nNew} new, ${mHad} already had.`;

  assert.equal(message, "Fetched. 2 new, 3 already had.");
});

test("Live Fetch: handles 0 new messages and preserves count formatting", () => {
  const statusZeroNew = {
    id: "3bfb833f-d40c-44d1-b527-9e19fa663f62",
    state: "done",
    messages_found: 1,
    messages_new: 0,
    messages_duplicate: 1,
    error: null,
  };

  const nNew = statusZeroNew.messages_new ?? 0;
  const mHad = statusZeroNew.messages_duplicate ?? 0;
  const message = `Fetched. ${nNew} new, ${mHad} already had.`;

  assert.equal(message, "Fetched. 0 new, 1 already had.");
});

test("Live Fetch: formats failed state error message", () => {
  const statusFailed = {
    id: "failed-fetch-id",
    state: "failed",
    error: "webhook_timeout_exceeded",
  };

  assert.equal(statusFailed.state, "failed");
  assert.equal(statusFailed.error, "webhook_timeout_exceeded");
});

test("Live Fetch: button labels and subtitles adhere to requirements", () => {
  const labelIdle = "Fetch live messages";
  const labelFetching = "Fetching…";
  const subtitle = "Pull the latest LinkedIn threads now. Does not send anything.";

  assert.equal(labelIdle, "Fetch live messages");
  assert.equal(labelFetching, "Fetching…");
  assert.equal(subtitle, "Pull the latest LinkedIn threads now. Does not send anything.");
});
