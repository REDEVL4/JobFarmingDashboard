-- REVIEW DRAFT ONLY. Do not execute without the user's approval and an isolated test.
-- Existing owner principal and tables were inspected 2026-11-02; revalidate immediately before applying.
-- Single-owner design; append-only action revisions, decisions and interactions.
begin;
create table jobbot.outreach_contacts (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid(),
 full_name text not null check(length(trim(full_name)) between 1 and 240), company text,
 professional_title text, category text not null default 'Other' check(category in ('Hiring Manager','Technical Recruiter','Engineering Manager','Peer / Software Engineer','AI/ML Engineer','Founder / CTO','Engineering Executive','Alumni','Referral Contact','Other')),
 linkedin_url text check(linkedin_url is null or linkedin_url ~* '^https://([a-z0-9-]+[.])?linkedin[.]com/in/[^/?#]+/?$'),
 team_affiliation text, team_verification text check(team_verification is null or team_verification in ('reported','verified','unknown')),
 relevance_score numeric check(relevance_score between 0 and 100), technical_overlap text, personalization_context text,
 application_id uuid references jobbot.job_applications(id), opportunity_id uuid references jobbot.job_opportunities(id),
 connection_stage text not null default 'unknown', reply_state text not null default 'unknown', priority text not null default 'normal' check(priority in ('low','normal','high')),
 last_interaction_at timestamptz, next_action text, follow_up_at timestamptz, notes text, evidence_source text, last_verified_at timestamptz,
 do_not_contact boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(id,owner_id), check(owner_id='f2729195-5445-4272-ab85-cac5b03b0967'::uuid)
);
create unique index outreach_contacts_linkedin_unique on jobbot.outreach_contacts (owner_id,lower(regexp_replace(linkedin_url,'/$',''))) where linkedin_url is not null;
create index outreach_contacts_company_idx on jobbot.outreach_contacts(owner_id, lower(company));
create index outreach_contacts_due_idx on jobbot.outreach_contacts(owner_id, follow_up_at) where follow_up_at is not null and not do_not_contact;
create table jobbot.outreach_actions (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid(), contact_id uuid,
 action_type text not null check(action_type in ('connection_invitation','direct_message','inmail','reply','follow_up','email','share_document','post_comment','reaction','repost','original_post','referral_request')),
 channel text not null check(channel in ('linkedin','email','other')), created_at timestamptz not null default now(),
 foreign key(contact_id,owner_id) references jobbot.outreach_contacts(id,owner_id), unique(id,owner_id),
 check(owner_id='f2729195-5445-4272-ab85-cac5b03b0967'::uuid)
);
create table jobbot.outreach_action_revisions (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid(), action_id uuid not null,
 revision_no integer not null default 0, target_snapshot text not null check(length(trim(target_snapshot))>0),
 target_url text, body text not null default '', reason text, context_summary text,
 application_id uuid references jobbot.job_applications(id), opportunity_id uuid references jobbot.job_opportunities(id),
 document_id uuid references jobbot.application_documents(id), document_sha256 text,
 created_at timestamptz not null default now(), foreign key(action_id,owner_id) references jobbot.outreach_actions(id,owner_id),
 unique(action_id,revision_no), unique(id,owner_id), unique(id,action_id,owner_id), check((document_id is null and document_sha256 is null) or (document_id is not null and document_sha256 ~ '^[0-9a-f]{64}$')),
 check(owner_id='f2729195-5445-4272-ab85-cac5b03b0967'::uuid)
);
create table jobbot.outreach_decisions (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid(), revision_id uuid not null,
 decision text not null check(decision in ('approved','rejected','postponed')), reason text,
 actor_id uuid not null default auth.uid(), created_at timestamptz not null default now(),
 foreign key(revision_id,owner_id) references jobbot.outreach_action_revisions(id,owner_id), unique(revision_id,decision),
 check(actor_id=owner_id), check(owner_id='f2729195-5445-4272-ab85-cac5b03b0967'::uuid)
);
create table jobbot.outreach_interactions (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid(), contact_id uuid not null,
 action_id uuid, revision_id uuid, event_type text not null check(event_type in ('invitation_sent','invitation_accepted','message_sent','message_received','resume_requested','resume_shared','referral_received','interview_influenced','declined','opted_out','note','other')),
 channel text not null check(channel in ('linkedin','email','other')), direction text check(direction is null or direction in ('inbound','outbound','internal')),
 message_summary text, event_at timestamptz, verification text not null default 'reported' check(verification in ('reported','verified','unknown')),
 evidence_source text, evidence_ref text, application_id uuid references jobbot.job_applications(id),
 external_key text, created_at timestamptz not null default now(),
 foreign key(contact_id,owner_id) references jobbot.outreach_contacts(id,owner_id),
 foreign key(action_id,owner_id) references jobbot.outreach_actions(id,owner_id),
 foreign key(revision_id,action_id,owner_id) references jobbot.outreach_action_revisions(id,action_id,owner_id),
 check(revision_id is null or action_id is not null), unique(id,owner_id), unique(owner_id,external_key),
 check(verification <> 'verified' or (nullif(trim(evidence_source),'') is not null and nullif(trim(evidence_ref),'') is not null)),
 check(event_type <> 'invitation_accepted' or verification='verified'),
 check(owner_id='f2729195-5445-4272-ab85-cac5b03b0967'::uuid)
);
create index outreach_interactions_contact_time on jobbot.outreach_interactions(owner_id,contact_id,event_at desc);
create table jobbot.outreach_followups (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid(), contact_id uuid not null,
 source_interaction_id uuid, description text not null, due_on date, due_at timestamptz, state text not null default 'open' check(state in ('open','done','postponed','cancelled')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(contact_id,owner_id) references jobbot.outreach_contacts(id,owner_id),
 foreign key(source_interaction_id,owner_id) references jobbot.outreach_interactions(id,owner_id),
 unique nulls not distinct (owner_id,contact_id,source_interaction_id,description), unique(id,owner_id), check(owner_id='f2729195-5445-4272-ab85-cac5b03b0967'::uuid)
);
create index outreach_followups_due on jobbot.outreach_followups(owner_id,due_at) where state='open';
create table jobbot.outreach_job_leads (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid(), contact_id uuid,
 company text not null, job_title text not null, posting_url text, source_post_url text, job_description_ref text, discovered_at timestamptz,
 opportunity_id uuid references jobbot.job_opportunities(id), application_id uuid references jobbot.job_applications(id),
 lead_state text not null default 'discovered' check(lead_state in ('discovered','duplicate_found','ready_for_job_bot','handoff_pending','handoff_acknowledged','under_job_bot_review','applied','skipped','failed')),
 acknowledgment_evidence text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(contact_id,owner_id) references jobbot.outreach_contacts(id,owner_id), unique(id,owner_id),
 check(lead_state not in ('handoff_acknowledged','under_job_bot_review','applied') or nullif(trim(acknowledgment_evidence),'') is not null),
 check(owner_id='f2729195-5445-4272-ab85-cac5b03b0967'::uuid)
);
create unique index outreach_job_lead_url_unique on jobbot.outreach_job_leads(owner_id,posting_url) where posting_url is not null;
create table jobbot.outreach_work_requests (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid(),
 request_type text not null check(request_type in ('resume_generation','job_lead_review')),
 contact_id uuid, source_interaction_id uuid, lead_id uuid, application_id uuid references jobbot.job_applications(id),
 role_context text, delivery_channel text, request_notes text,
 request_state text not null default 'created' check(request_state in ('created','handoff_pending','acknowledged','completed','failed')),
 acknowledgment_evidence text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(contact_id,owner_id) references jobbot.outreach_contacts(id,owner_id),
 foreign key(source_interaction_id,owner_id) references jobbot.outreach_interactions(id,owner_id),
 foreign key(lead_id,owner_id) references jobbot.outreach_job_leads(id,owner_id), unique(id,owner_id),
 check(request_state not in ('acknowledged','completed') or nullif(trim(acknowledgment_evidence),'') is not null),
 check(owner_id='f2729195-5445-4272-ab85-cac5b03b0967'::uuid)
);
create index outreach_work_requests_state on jobbot.outreach_work_requests(owner_id,request_state,created_at);
create unique index outreach_work_request_interaction_unique on jobbot.outreach_work_requests(owner_id,source_interaction_id,request_type) where source_interaction_id is not null;
create table jobbot.outreach_audit (
 id bigint generated always as identity primary key, owner_id uuid not null, entity_type text not null, entity_id uuid not null,
 operation text not null, actor_id uuid, event_at timestamptz not null default now(),
 check(owner_id='f2729195-5445-4272-ab85-cac5b03b0967'::uuid)
);
-- Row-level lock serializes concurrent edits/decisions for an action. Original
-- revisions, decisions and interactions have no UPDATE or DELETE grants.
create function jobbot.outreach_revision_guard() returns trigger language plpgsql security invoker set search_path='' as $$
declare contact_blocked boolean; matching_hash text; original_target text; original_url text;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.action_id::text,0));
 select c.do_not_contact into contact_blocked from jobbot.outreach_actions a left join jobbot.outreach_contacts c on c.id=a.contact_id and c.owner_id=a.owner_id where a.id=new.action_id and a.owner_id=new.owner_id;
 if not found then raise exception 'Action not found'; end if;
 if coalesce(contact_blocked,false) then raise exception 'Contact has opted out'; end if;
 select target_snapshot,target_url into original_target,original_url from jobbot.outreach_action_revisions where action_id=new.action_id and owner_id=new.owner_id order by revision_no limit 1;
 if found and (new.target_snapshot is distinct from original_target or new.target_url is distinct from original_url) then raise exception 'Create a new action to change the recipient or target'; end if;
 select coalesce(max(revision_no),0)+1 into new.revision_no from jobbot.outreach_action_revisions where action_id=new.action_id and owner_id=new.owner_id;
 if new.document_id is not null then
  select content_sha256 into matching_hash from jobbot.application_documents where id=new.document_id and upload_status='verified';
  if matching_hash is null or matching_hash is distinct from new.document_sha256 then raise exception 'Attachment verification failed'; end if;
 end if;
 return new;
end $$;
create trigger outreach_revision_guard before insert on jobbot.outreach_action_revisions for each row execute function jobbot.outreach_revision_guard();
create function jobbot.outreach_decision_guard() returns trigger language plpgsql security invoker set search_path='' as $$
declare action_key uuid; rev_no integer; last_rev integer; contact_blocked boolean; doc_id uuid; expected_hash text; current_hash text;
begin
 select r.action_id,r.revision_no,r.document_id,r.document_sha256 into action_key,rev_no,doc_id,expected_hash from jobbot.outreach_action_revisions r where r.id=new.revision_id and r.owner_id=new.owner_id;
 if action_key is null then raise exception 'Revision not found'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(action_key::text,0));
 select max(revision_no) into last_rev from jobbot.outreach_action_revisions where action_id=action_key and owner_id=new.owner_id;
 if rev_no<>last_rev then raise exception 'A newer draft exists; review it before deciding'; end if;
 select c.do_not_contact into contact_blocked from jobbot.outreach_actions a left join jobbot.outreach_contacts c on c.id=a.contact_id and c.owner_id=a.owner_id where a.id=action_key and a.owner_id=new.owner_id;
 if new.decision='approved' and coalesce(contact_blocked,false) then raise exception 'Contact has opted out'; end if;
 if new.decision='approved' and doc_id is not null then
  select content_sha256 into current_hash from jobbot.application_documents where id=doc_id and upload_status='verified';
  if current_hash is distinct from expected_hash then raise exception 'Attachment changed or is unavailable'; end if;
 end if;
 new.actor_id:=auth.uid(); return new;
end $$;
create trigger outreach_decision_guard before insert on jobbot.outreach_decisions for each row execute function jobbot.outreach_decision_guard();
-- A manually reported send linked to a draft must reference its current,
-- approved revision and the same contact. Historical unlinked reports remain
-- possible without implying they were approved in this system.
create function jobbot.outreach_interaction_guard() returns trigger language plpgsql security invoker set search_path='' as $$
declare linked_contact uuid; revision_number integer; newest integer; decision_value text;
begin
 if new.action_id is not null then
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.action_id::text,0));
  select a.contact_id into linked_contact from jobbot.outreach_actions a where a.id=new.action_id and a.owner_id=new.owner_id;
  if not found or linked_contact is distinct from new.contact_id then raise exception 'Action does not belong to contact'; end if;
 end if;
 if new.revision_id is not null and new.event_type in ('invitation_sent','message_sent','resume_shared') then
  select r.revision_no into revision_number from jobbot.outreach_action_revisions r where r.id=new.revision_id and r.action_id=new.action_id and r.owner_id=new.owner_id;
  select max(r.revision_no) into newest from jobbot.outreach_action_revisions r where r.action_id=new.action_id and r.owner_id=new.owner_id;
  select d.decision into decision_value from jobbot.outreach_decisions d where d.revision_id=new.revision_id and d.owner_id=new.owner_id order by d.created_at desc,d.id desc limit 1;
  if revision_number is null or revision_number<>newest or decision_value is distinct from 'approved' then raise exception 'Current revision must be approved before recording this send'; end if;
 end if;
 return new;
end $$;
create trigger outreach_interaction_guard before insert on jobbot.outreach_interactions for each row execute function jobbot.outreach_interaction_guard();
revoke all on function jobbot.outreach_interaction_guard() from public,anon,authenticated;
-- Never let a privileged client silently rewrite an approved revision or its history.
create function jobbot.outreach_immutable() returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception 'Outreach history is append-only'; end $$;
do $$ declare t text; begin
 foreach t in array array['outreach_actions','outreach_action_revisions','outreach_decisions','outreach_interactions','outreach_audit'] loop
  execute format('create trigger outreach_immutable before update or delete on jobbot.%I for each row execute function jobbot.outreach_immutable()',t);
 end loop;
end $$;
revoke all on function jobbot.outreach_immutable() from public,anon,authenticated;
revoke all on function jobbot.outreach_revision_guard() from public,anon,authenticated;
revoke all on function jobbot.outreach_decision_guard() from public,anon,authenticated;
-- Audit writes are atomic with the mutation, contain no message bodies, and
-- require the verified owner identity even though the trigger is privileged.
create function jobbot.outreach_audit_change() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (select auth.uid()) is null or (select auth.uid()) <> 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid or new.owner_id <> (select auth.uid()) then
  raise exception 'Unauthorized audit mutation';
 end if;
 insert into jobbot.outreach_audit(owner_id,entity_type,entity_id,operation,actor_id)
 values(new.owner_id,tg_table_name,new.id,tg_op,(select auth.uid()));
 return new;
end $$;
revoke all on function jobbot.outreach_audit_change() from public,anon,authenticated;
create function jobbot.outreach_touch() returns trigger language plpgsql security invoker set search_path='' as $$
begin new.updated_at:=pg_catalog.now(); return new; end $$;
create function jobbot.outreach_optout() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.event_type in ('declined','opted_out') then
  update jobbot.outreach_contacts set do_not_contact=true where id=new.contact_id and owner_id=new.owner_id;
 end if;
 return new;
end $$;
create trigger outreach_optout after insert on jobbot.outreach_interactions for each row execute function jobbot.outreach_optout();
do $$ declare t text; begin
 foreach t in array array['outreach_contacts','outreach_actions','outreach_action_revisions','outreach_decisions','outreach_interactions','outreach_followups','outreach_job_leads','outreach_work_requests'] loop
  execute format('create trigger audit_outreach after insert or update on jobbot.%I for each row execute function jobbot.outreach_audit_change()',t);
  if t=any(array['outreach_contacts','outreach_followups','outreach_job_leads','outreach_work_requests']) then
   execute format('create trigger touch_outreach before update on jobbot.%I for each row execute function jobbot.outreach_touch()',t);
  end if;
 end loop;
end $$;
alter table jobbot.outreach_contacts enable row level security;
alter table jobbot.outreach_actions enable row level security;
alter table jobbot.outreach_action_revisions enable row level security;
alter table jobbot.outreach_decisions enable row level security;
alter table jobbot.outreach_interactions enable row level security;
alter table jobbot.outreach_followups enable row level security;
alter table jobbot.outreach_job_leads enable row level security;
alter table jobbot.outreach_work_requests enable row level security;
alter table jobbot.outreach_audit enable row level security;
do $$ declare t text; begin
 foreach t in array array['outreach_contacts','outreach_actions','outreach_action_revisions','outreach_decisions','outreach_interactions','outreach_followups','outreach_job_leads','outreach_work_requests','outreach_audit'] loop
  execute format('create policy owner_read on jobbot.%I for select to authenticated using (owner_id=(select auth.uid()) and (select auth.uid())=%L::uuid)',t,'f2729195-5445-4272-ab85-cac5b03b0967');
  if t<>'outreach_audit' then
   execute format('create policy owner_insert on jobbot.%I for insert to authenticated with check (owner_id=(select auth.uid()) and (select auth.uid())=%L::uuid)',t,'f2729195-5445-4272-ab85-cac5b03b0967');
  end if;
  if t=any(array['outreach_contacts','outreach_followups','outreach_job_leads','outreach_work_requests']) then
   execute format('create policy owner_update on jobbot.%I for update to authenticated using (owner_id=(select auth.uid()) and (select auth.uid())=%L::uuid) with check (owner_id=(select auth.uid()) and (select auth.uid())=%L::uuid)',t,'f2729195-5445-4272-ab85-cac5b03b0967','f2729195-5445-4272-ab85-cac5b03b0967');
  end if;
 end loop;
end $$;
grant usage on schema jobbot to authenticated;
grant select on jobbot.outreach_contacts,jobbot.outreach_actions,jobbot.outreach_action_revisions,jobbot.outreach_decisions,jobbot.outreach_interactions,jobbot.outreach_followups,jobbot.outreach_job_leads,jobbot.outreach_work_requests,jobbot.outreach_audit to authenticated;
grant insert on jobbot.outreach_contacts,jobbot.outreach_actions,jobbot.outreach_action_revisions,jobbot.outreach_decisions,jobbot.outreach_interactions,jobbot.outreach_followups,jobbot.outreach_job_leads,jobbot.outreach_work_requests to authenticated;
grant update on jobbot.outreach_contacts,jobbot.outreach_followups,jobbot.outreach_job_leads,jobbot.outreach_work_requests to authenticated;
-- Creating an action and its first revision is atomic; no send occurs here.
create function public.jf_outreach_create_draft(p_contact_id uuid,p_action_type text,p_channel text,p_target text,p_target_url text,p_body text,p_reason text,p_context text,p_document_id uuid,p_document_sha256 text,p_application_id uuid,p_opportunity_id uuid) returns uuid
language plpgsql security invoker set search_path='' as $$
declare new_action uuid;
begin
 if (select auth.uid()) is distinct from 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid then raise exception 'Unauthorized'; end if;
 insert into jobbot.outreach_actions(contact_id,action_type,channel) values(p_contact_id,p_action_type,p_channel) returning id into new_action;
 insert into jobbot.outreach_action_revisions(action_id,target_snapshot,target_url,body,reason,context_summary,document_id,document_sha256,application_id,opportunity_id)
 values(new_action,p_target,p_target_url,coalesce(p_body,''),p_reason,p_context,p_document_id,p_document_sha256,p_application_id,p_opportunity_id);
 return new_action;
end $$;
revoke all on function public.jf_outreach_create_draft(uuid,text,text,text,text,text,text,text,uuid,text,uuid,uuid) from public,anon;
grant execute on function public.jf_outreach_create_draft(uuid,text,text,text,text,text,text,text,uuid,text,uuid,uuid) to authenticated;
create view public.jf_outreach_contacts with (security_invoker=true) as select * from jobbot.outreach_contacts;
create view public.jf_outreach_actions with (security_invoker=true) as select * from jobbot.outreach_actions;
create view public.jf_outreach_revisions with (security_invoker=true) as select * from jobbot.outreach_action_revisions;
create view public.jf_outreach_decisions with (security_invoker=true) as select * from jobbot.outreach_decisions;
create view public.jf_outreach_interactions with (security_invoker=true) as select * from jobbot.outreach_interactions;
create view public.jf_outreach_followups with (security_invoker=true) as select * from jobbot.outreach_followups;
create view public.jf_outreach_leads with (security_invoker=true) as select * from jobbot.outreach_job_leads;
create view public.jf_outreach_work_requests with (security_invoker=true) as select * from jobbot.outreach_work_requests;
revoke all on public.jf_outreach_contacts,public.jf_outreach_actions,public.jf_outreach_revisions,public.jf_outreach_decisions,public.jf_outreach_interactions,public.jf_outreach_followups,public.jf_outreach_leads,public.jf_outreach_work_requests from public,anon,authenticated;
grant select,insert on public.jf_outreach_contacts,public.jf_outreach_actions,public.jf_outreach_revisions,public.jf_outreach_decisions,public.jf_outreach_interactions,public.jf_outreach_followups,public.jf_outreach_leads,public.jf_outreach_work_requests to authenticated;
grant update on public.jf_outreach_contacts,public.jf_outreach_followups,public.jf_outreach_leads,public.jf_outreach_work_requests to authenticated;
commit;
;
