create or replace function public.jf_proposal_pending(p_id uuid)
returns table(id uuid, state text, action_type text, proposed_text text)
language sql
security definer
set search_path = jobbot, public
as $$
  select p.id, p.state, p.action_type, p.proposed_text
  from jobbot.outreach_proposals p
  where p.id = p_id;
$$;

revoke all on function public.jf_proposal_pending(uuid) from public, anon, authenticated;
grant execute on function public.jf_proposal_pending(uuid) to service_role;
