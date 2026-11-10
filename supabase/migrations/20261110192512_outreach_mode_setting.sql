create table if not exists jobbot.outreach_settings (
  owner_id uuid primary key,
  outreach_mode text not null default 'review',
  updated_at timestamptz not null default now(),
  constraint outreach_settings_mode_check check (outreach_mode in ('review', 'auto'))
);

insert into jobbot.outreach_settings (owner_id, outreach_mode)
values ('f2729195-5445-4272-ab85-cac5b03b0967', 'review')
on conflict (owner_id) do nothing;

create or replace view public.jf_outreach_settings as
select owner_id, outreach_mode, updated_at
from jobbot.outreach_settings;

grant select, update on public.jf_outreach_settings to authenticated;

create or replace function jobbot.set_outreach_mode(p_mode text)
returns void
language plpgsql
security definer
set search_path = jobbot, public
as $$
begin
  if p_mode not in ('review', 'auto') then
    raise exception 'invalid mode';
  end if;
  insert into jobbot.outreach_settings (owner_id, outreach_mode, updated_at)
  values (auth.uid(), p_mode, now())
  on conflict (owner_id) do update
    set outreach_mode = excluded.outreach_mode,
        updated_at = now();
end;
$$;

grant execute on function jobbot.set_outreach_mode(text) to authenticated;

