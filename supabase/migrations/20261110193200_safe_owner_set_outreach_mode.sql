create or replace function jobbot.set_outreach_mode(p_mode text)
returns void
language plpgsql
security definer
set search_path = jobbot, public
as $$
declare
  v_owner uuid;
begin
  if p_mode not in ('review', 'auto') then
    raise exception 'invalid mode';
  end if;
  v_owner := coalesce(auth.uid(), 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid);
  insert into jobbot.outreach_settings (owner_id, outreach_mode, updated_at)
  values (v_owner, p_mode, now())
  on conflict (owner_id) do update
    set outreach_mode = excluded.outreach_mode,
        updated_at = now();
end;
$$;

grant execute on function jobbot.set_outreach_mode(text) to authenticated;

