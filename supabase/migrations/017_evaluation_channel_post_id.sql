-- Ends the version-collision class by giving Pass 2 evaluations the one thing they
-- never had: a link to the post they scored.
--
-- Re-running adaptation restarts channel_posts.version at 1, so (request_id, channel,
-- version) identifies nothing. Every consumer that joined on it has been wrong at
-- least once:
--   * the chosen-version selector marked two rows chosen at the same time
--   * the edit-triage anchor compared an edit against a draft from another run
--   * five workflow fetches asked for the highest NUMBER and called it the newest
--   * the version picker rendered two children with the same React key
--   * the previous-score lookup matched three rows, returned null through
--     maybeSingle(), and let a rewrite scoring 82 replace a version scoring 85
--
-- Pass 1 has had section_id from the start and none of this happened to it. This is
-- the same column for the other pass.
--
-- Deliberately NOT renumbering versions or making them globally monotonic: the
-- workflows fetch their own freshly inserted rows by version number within a run
-- ("version=eq.2"), so renumbering underneath them would break the pipelines that
-- currently work. Version stays a label for a round; the id becomes the identity.
set lock_timeout = '5s';

alter table evaluation_results
  add column if not exists channel_post_id uuid references channel_posts(id) on delete cascade;

-- Backfill. For each Pass 2 evaluation, the post it scored is the one on the same
-- channel with the same version number that already existed when the evaluation was
-- written, taking the newest such row: a run evaluates the version it has just
-- inserted, so the closest preceding insert is the right one.
-- A correlated scalar subquery in SET, not UPDATE ... FROM LATERAL: the lateral
-- cannot reference the row being updated, which Postgres rejects with 42P10.
update evaluation_results e
set channel_post_id = (
  select cp.id
  from channel_posts cp
  where cp.request_id = e.request_id
    and cp.channel = e.channel
    and cp.version = e.content_version
    and cp.created_at <= e.created_at
  order by cp.created_at desc
  limit 1
)
where e.pass = 'pass_2_channel'
  and e.channel_post_id is null;

create index if not exists evaluation_results_channel_post_id_idx
  on evaluation_results (channel_post_id);
