-- Content Manager (Decision #107). Reverses Decision #96, which dropped the role
-- because nothing answered "how does someone become content manager, and who
-- promotes whom". Per-user accounts (migration 007) make that answerable cheaply:
-- one nullable pointer on the existing workspace_settings singleton, set directly,
-- with no promotion UI and no role system.
--
-- NULL means the workspace is unclaimed, and everyone can still edit settings.
-- That is deliberate: making settings manager-only while no manager exists would
-- lock every user out of configuring a fresh install, including the onboarding
-- gate that blocks generation until settings exist.
alter table workspace_settings
  add column content_manager_user_id uuid references auth.users(id) on delete set null;

-- When the content manager changes the audience or tone, everyone else needs to
-- know, because those define what the evaluator grades every future draft against.
-- Stored as a row rather than a transient toast so it can be shown exactly once
-- per user, survive a refresh, and still be there for someone who was not logged
-- in at the time.
create table settings_announcements (
  id uuid primary key default gen_random_uuid(),
  author_user_id uuid references auth.users(id) on delete set null,
  author_email text,
  -- What area changed, so the popup can lead with it.
  kind text not null check (kind in ('audience', 'tone', 'workspace', 'subscribers')),
  summary text not null,
  created_at timestamptz not null default now()
);

create index settings_announcements_created_at_idx on settings_announcements (created_at desc);

-- Per-user acknowledgement. Composite PK means a second dismissal is a no-op
-- rather than a duplicate row.
create table settings_announcement_reads (
  announcement_id uuid not null references settings_announcements(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

alter table settings_announcements enable row level security;
alter table settings_announcement_reads enable row level security;

create policy "authenticated full access" on settings_announcements for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "authenticated full access" on settings_announcement_reads for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
