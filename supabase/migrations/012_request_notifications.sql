-- Work runs on n8n, not in the browser, so a request can sit finished (or dead)
-- for hours with nothing telling the person who asked for it. The only way to find
-- out was to navigate back and look. This is what the notification sweep keys off.
--
-- The STATUS is recorded, not just a boolean: a request passes through several
-- states that need the human (pick sources, pick an angle, review the draft,
-- schedule it), and each one deserves its own email. Storing the last status we
-- notified about means "notify when it changes to something that needs them", not
-- "notify once ever".
set lock_timeout = '5s';

alter table requests
  add column if not exists notified_status text,
  add column if not exists notified_at timestamptz;

-- Everything that already exists is history. Without this every request in the
-- table would generate an email on the sweep's first run.
update requests set notified_status = status where notified_status is null;
