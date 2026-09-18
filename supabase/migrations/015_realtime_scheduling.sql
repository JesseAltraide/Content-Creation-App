-- Scheduling moves off the host and into the database.
--
-- Vercel's Hobby plan runs a cron once a day, which is fine for a sweep and useless
-- for the two things it was carrying: an email telling someone their request needs
-- them, and a newsletter going out at the time they picked. Once a day turns "your
-- draft is ready" into tomorrow's news and makes a 9am send a 6am-next-day send.
--
-- Postgres can schedule, and this project already depends on Postgres. pg_cron runs
-- the timer and pg_net makes the HTTP call, both available on Supabase's free tier.
-- The endpoints do not change: the same two routes, with the same CRON_SECRET bearer
-- token, just called every minute by the database instead of once a day by the host.
--
-- The Vercel cron entries are removed in the same change. Two schedulers hitting the
-- same publish endpoint is how the same newsletter gets delivered twice.
set lock_timeout = '5s';

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Where to call, and with what. A table rather than hardcoded values in the job
-- bodies, so moving the app to a different URL or rotating the secret is an update
-- rather than a migration.
--
-- One row, enforced the same way workspace_settings does it.
create table if not exists app_config (
  id boolean primary key default true check (id),
  base_url text not null,
  cron_secret text not null,
  updated_at timestamptz not null default now()
);

-- RLS on with NO policies: unreachable through PostgREST by any signed-in user,
-- readable only by the service role and by these jobs. It holds the token that
-- protects the cron endpoints, so nothing in the browser has any business reading it.
alter table app_config enable row level security;

-- Idempotent: re-running this migration reschedules rather than duplicating, and a
-- duplicated publish job would mean duplicated sends.
do $$
declare
  job text;
begin
  foreach job in array array['content-agent-publish', 'content-agent-notify'] loop
    if exists (select 1 from cron.job where jobname = job) then
      perform cron.unschedule(job);
    end if;
  end loop;
end
$$;

-- Every minute. The publish route only acts on items whose time has come and the
-- notify route only on requests whose status has changed since it last told anyone,
-- so a run with nothing to do costs one HTTP request that returns immediately.
select cron.schedule(
  'content-agent-publish',
  '* * * * *',
  $job$
  select net.http_get(
    url := (select base_url from app_config where id) || '/api/cron/publish',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select cron_secret from app_config where id)
    ),
    timeout_milliseconds := 60000
  );
  $job$
);

select cron.schedule(
  'content-agent-notify',
  '* * * * *',
  $job$
  select net.http_get(
    url := (select base_url from app_config where id) || '/api/cron/notify',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select cron_secret from app_config where id)
    ),
    timeout_milliseconds := 60000
  );
  $job$
);

-- Both jobs no-op safely until this row exists, because base_url is null and the
-- http_get is never issued. Fill it in with:
--
--   insert into app_config (base_url, cron_secret)
--   values ('https://your-app.vercel.app', 'the same CRON_SECRET as Vercel')
--   on conflict (id) do update
--     set base_url = excluded.base_url,
--         cron_secret = excluded.cron_secret,
--         updated_at = now();
