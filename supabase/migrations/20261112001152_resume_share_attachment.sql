alter table jobbot.outreach_proposals
  add column if not exists attachment_path text;

alter table jobbot.outreach_settings
  add column if not exists base_resume_path text;

update jobbot.outreach_settings
   set base_resume_path = 'applications/sqlite_li_4481262703/resume/v1/Govardhan_Narala_Resume_Turnberry_AIMLEngineer.pdf'
 where owner_id = 'f2729195-5445-4272-ab85-cac5b03b0967'
   and base_resume_path is null;

update jobbot.outreach_proposals
   set state = 'rejected',
       error = 'text-only resume promise, replaced by resume_share'
 where id = '72d18307-f7c2-4696-b0f8-27da053437c3'
   and state = 'pending_approval';

insert into jobbot.outreach_proposals (
  owner_id, contact_id, action_type, channel, target_name,
  proposed_text, state, attachment_path
)
select 'f2729195-5445-4272-ab85-cac5b03b0967',
       '9388f356-9a7d-49ad-a0af-2779cee29ec6',
       'resume_share', 'linkedin', 'Chaitanya Prasad Reddy Narala',
       'Sure. Resume is attached.',
       'pending_approval',
       base_resume_path
from jobbot.outreach_settings
where owner_id = 'f2729195-5445-4272-ab85-cac5b03b0967';
