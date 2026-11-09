const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const outcome = 'manual_action_required';

export function readFixture(value, now = Date.now()) {
  try {
    const { work_id, revision_id, request_id, expires_at } = JSON.parse(value);
    const expires = Date.parse(expires_at);
    if ([work_id, revision_id, request_id].every(id => typeof id === 'string' && uuid.test(id)) &&
        new Set([work_id, revision_id, request_id]).size === 3 &&
        Number.isFinite(expires) && expires > now && expires - now <= 30 * 60_000) {
      return { work_id, revision_id, request_id, expires };
    }
  } catch {
    // Missing or invalid configuration leaves the endpoint read-only.
  }
  return null;
}

function requireFixture(fixture, input, now) {
  if (!fixture || fixture.expires <= now ||
      input.work_id !== fixture.work_id || input.revision_id !== fixture.revision_id) {
    throw new Error('Synthetic fixture unavailable');
  }
}

export async function claimFixture(rpc, fixture, input, now = Date.now()) {
  requireFixture(fixture, input, now);
  if (input.request_id !== fixture.request_id) throw new Error('Synthetic request unavailable');
  const { data, error } = await rpc('jf_owner_claim_work', {
    p_work_id: fixture.work_id, p_revision_id: fixture.revision_id, p_request_id: fixture.request_id,
  });
  if (error) throw new Error('Synthetic claim rejected');
  if (data?.status === 'already_claimed') return { status: 'already_claimed' };
  if (!['claimed', 'already_completed'].includes(data?.status) || !uuid.test(data.claim_id ?? '') ||
      data.work_id !== fixture.work_id || data.revision_id !== fixture.revision_id) {
    throw new Error('Synthetic claim result invalid');
  }
  return { status: data.status, claim_id: data.claim_id };
}

export async function completeFixture(rpc, fixture, input, now = Date.now()) {
  requireFixture(fixture, input, now);
  if (typeof input.claim_id !== 'string' || !uuid.test(input.claim_id)) {
    throw new Error('Synthetic claim ID invalid');
  }
  const { data, error } = await rpc('jf_owner_complete_work', {
    p_work_id: fixture.work_id, p_revision_id: fixture.revision_id, p_claim_id: input.claim_id,
    p_outcome: outcome, p_receipt_reference: 'synthetic-no-delivery:' + fixture.request_id,
  });
  if (error || data !== input.claim_id) throw new Error('Synthetic completion rejected');
  return { status: outcome, receipt_id: data };
}
