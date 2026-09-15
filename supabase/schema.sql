-- Week 4 — AI Content Research & Publishing Agent
-- Initial schema per week4-full-flow.md build order step 1.
-- Enums

create type request_status as enum (
  'draft',
  'researching',
  'awaiting_source_selection',
  'awaiting_angle_selection',
  'generating',
  'evaluating',
  'revising',
  'pending_approval',
  'approved',
  'rejected',
  'needs_human_attention',
  'adapting',
  'ready_to_schedule'
);

create type content_input_path as enum ('raw_idea', 'url');

create type source_status as enum ('pending_selection', 'selected', 'rejected', 'scraped', 'scrape_failed');

create type section_generation_status as enum ('generating', 'generated', 'generation_failed');

create type evaluation_pass as enum ('pass_1_article', 'pass_2_channel');

create type evaluation_status as enum ('pass', 'revise', 'reject');

create type channel as enum ('linkedin', 'x', 'newsletter');

create type scheduled_status as enum ('scheduled', 'published', 'publish_failed', 'overdue');

create type event_status as enum ('success', 'failed');

-- Workspace-level settings

create table audience_profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null check (char_length(description) > 0),
  created_at timestamptz not null default now()
);

create table tone_samples (
  id uuid primary key default gen_random_uuid(),
  channel channel not null,
  content text not null check (char_length(content) >= 20),
  created_at timestamptz not null default now()
);

create table newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Requests

create table requests (
  id uuid primary key default gen_random_uuid(),
  status request_status not null default 'draft',
  input_path content_input_path not null,
  raw_idea text,
  context text,
  primary_keyword text not null,
  desired_length text,
  channels channel[] not null,
  audience_profile_id uuid references audience_profiles(id),
  resolved_audience_profile_id uuid references audience_profiles(id),
  x_thread_length text default 'single' check (x_thread_length in ('single', 'mini', 'expansive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sources (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references requests(id) on delete cascade,
  url text not null,
  title text,
  status source_status not null default 'pending_selection',
  scraped_text text,
  fetch_error text,
  fetched_at timestamptz,
  created_at timestamptz not null default now(),
  unique (request_id, url)
);

create table excerpts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references requests(id) on delete cascade,
  source_id uuid not null references sources(id) on delete cascade,
  text text not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create table angles (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references requests(id) on delete cascade,
  working_title text not null,
  thesis text not null,
  section_shape jsonb not null,
  resonance_score int not null check (resonance_score between 0 and 15),
  chosen boolean not null default false,
  created_at timestamptz not null default now()
);

create table sections (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references requests(id) on delete cascade,
  angle_id uuid references angles(id),
  version int not null default 1,
  title text,
  body_markdown text,
  primary_keyword text,
  secondary_keywords text[],
  generation_status section_generation_status not null default 'generating',
  locked boolean not null default false,
  created_at timestamptz not null default now()
);

create table evaluation_results (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references requests(id) on delete cascade,
  section_id uuid references sections(id),
  channel channel,
  pass evaluation_pass not null,
  content_version int not null,
  overall_score int not null,
  status evaluation_status not null,
  criteria jsonb not null,
  unsupported_or_weak_claims jsonb,
  weakest_criteria_suggestions jsonb,
  hard_block_triggered boolean not null default false,
  hard_block_reason text,
  created_at timestamptz not null default now()
);

create table channel_posts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references requests(id) on delete cascade,
  channel channel not null,
  version int not null default 1,
  body text not null,
  tone_variant text not null default 'default',
  image_url text,
  locked boolean not null default false,
  created_at timestamptz not null default now()
);

create table scheduled_content (
  id uuid primary key default gen_random_uuid(),
  channel_post_id uuid not null references channel_posts(id) on delete cascade,
  channel channel not null,
  status scheduled_status not null default 'scheduled',
  scheduled_for timestamptz not null,
  published_at timestamptz,
  notification_sent boolean not null default false,
  created_at timestamptz not null default now()
);

-- Append-only event log (PRD test #8)

create table event_log (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references requests(id) on delete cascade,
  stage text not null,
  status event_status not null,
  detail text,
  created_at timestamptz not null default now()
);

create index event_log_request_id_idx on event_log(request_id);
create index sources_request_id_idx on sources(request_id);
create index excerpts_request_id_idx on excerpts(request_id);
create index sections_request_id_idx on sections(request_id);
create index evaluation_results_request_id_idx on evaluation_results(request_id);
create index channel_posts_request_id_idx on channel_posts(request_id);

-- Row Level Security
-- Decision #75: single flat role, one workspace — any authenticated user has
-- full read/write access to every table. No per-user ownership split.

alter table audience_profiles enable row level security;
alter table tone_samples enable row level security;
alter table newsletter_subscribers enable row level security;
alter table requests enable row level security;
alter table sources enable row level security;
alter table excerpts enable row level security;
alter table angles enable row level security;
alter table sections enable row level security;
alter table evaluation_results enable row level security;
alter table channel_posts enable row level security;
alter table scheduled_content enable row level security;
alter table event_log enable row level security;

create policy "authenticated full access" on audience_profiles for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on tone_samples for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on newsletter_subscribers for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on requests for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on sources for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on excerpts for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on angles for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on sections for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on evaluation_results for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on channel_posts for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on scheduled_content for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on event_log for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
