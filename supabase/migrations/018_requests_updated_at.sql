-- requests.updated_at has never moved. Nothing sets it: the column exists with a
-- default, no trigger maintains it, and neither this app nor n8n writes it on a status
-- change. Every request has updated_at exactly equal to created_at, on every row in
-- the table.
--
-- That turned the stalled-run sweep into the opposite of a safety net. It filtered on
-- `updated_at < now - 20 minutes` and reported silence from the same column, so any
-- request older than the threshold looked permanently stalled: a run entered
-- 'generating' at 09:22:33 and was reset 28 seconds later with "86 minutes of
-- silence", twice, on a request that then passed at 91/100.
--
-- Both readers now measure from the event log instead, which is the real activity
-- signal. This makes the column honest as well, so the next thing to read it is not
-- misled the same way.
set lock_timeout = '5s';

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists requests_set_updated_at on requests;
create trigger requests_set_updated_at
  before update on requests
  for each row
  execute function set_updated_at();

-- Existing rows carry a created_at-equal value that means nothing. The newest event is
-- the closest honest answer for anything that already happened.
update requests r
set updated_at = coalesce(
  (select max(e.created_at) from event_log e where e.request_id = r.id),
  r.created_at
);
