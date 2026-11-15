-- Migration: Enable owner to create new outreach proposals for review
-- Purpose:
--   1. Grant INSERT on jobbot.outreach_proposals to authenticated
--   2. Define RLS policy allowing authenticated owner to insert new proposals
--   3. Expose security-definer RPC jf_create_outreach_proposal

GRANT INSERT ON jobbot.outreach_proposals TO authenticated;
GRANT INSERT ON public.jf_outreach_proposals TO authenticated;
GRANT INSERT ON public.outreach_proposals TO authenticated;

DROP POLICY IF EXISTS "jf_owner_insert_outreach_proposals" ON jobbot.outreach_proposals;
CREATE POLICY "jf_owner_insert_outreach_proposals"
ON jobbot.outreach_proposals
FOR INSERT
TO authenticated
WITH CHECK (
    (owner_id = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid OR auth.uid() = 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid)
    AND (auth.jwt()->>'client_id' IS NULL)
);

CREATE OR REPLACE FUNCTION public.jf_create_outreach_proposal(
  p_contact_id uuid,
  p_proposed_text text,
  p_action_type text default 'message'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = jobbot, public
AS $$
DECLARE
  v_owner uuid;
  v_contact record;
  v_inserted record;
BEGIN
  v_owner := coalesce(auth.uid(), 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid);

  IF nullif(trim(p_proposed_text), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'proposed_text_required');
  END IF;

  SELECT full_name, professional_title, company, linkedin_url, do_not_contact
    INTO v_contact
  FROM jobbot.outreach_contacts
  WHERE id = p_contact_id AND owner_id = v_owner;

  IF v_contact.full_name IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'contact_not_found');
  END IF;

  IF coalesce(v_contact.do_not_contact, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'do_not_contact');
  END IF;

  INSERT INTO jobbot.outreach_proposals (
    owner_id,
    contact_id,
    action_type,
    channel,
    target_name,
    target_title,
    target_company,
    linkedin_url,
    proposed_text,
    state,
    created_at,
    updated_at
  ) VALUES (
    v_owner,
    p_contact_id,
    coalesce(nullif(trim(p_action_type), ''), 'message'),
    'linkedin',
    v_contact.full_name,
    v_contact.professional_title,
    v_contact.company,
    v_contact.linkedin_url,
    trim(p_proposed_text),
    'pending_approval',
    now(),
    now()
  )
  RETURNING * INTO v_inserted;

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_inserted.id,
    'proposal', row_to_json(v_inserted)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.jf_create_outreach_proposal(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.jf_create_outreach_proposal(uuid, text, text) TO authenticated, service_role;
