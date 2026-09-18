-- Team review on requests that have reached ready_to_schedule (Decision #106).
-- Visibility is stage-gated rather than a sharing/permission model: a request is
-- private while in progress, and readable by everyone once it is final enough to
-- be worth reviewing. That is what makes per-request privacy (migration 007) and
-- team comments coexist without one cancelling the other.
--
-- Comments are advisory by design: they never block scheduling and the author is
-- under no obligation to act on them. Reviewers can read and comment, never edit.
create table request_comments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references requests(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  -- Null means a comment on the request as a whole rather than one channel's post.
  channel text check (channel in ('linkedin', 'x', 'newsletter')),
  -- Denormalised so a comment still shows who wrote it after the account is gone,
  -- and so listing comments never needs a join against auth.users.
  author_email text,
  body text not null,
  created_at timestamptz not null default now()
);

create index request_comments_request_id_idx on request_comments (request_id, created_at);

alter table request_comments enable row level security;

-- Permissive like every other policy in this schema: RLS is not the enforcement
-- point here, because almost every read goes through the service-role client,
-- which bypasses policies entirely. Access is enforced in the queries.
create policy "authenticated full access" on request_comments for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
