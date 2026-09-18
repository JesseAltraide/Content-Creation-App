-- The schedule route already meant to keep one pending schedule per channel post:
-- it deletes any existing 'scheduled' row before inserting a new one. That is
-- check-then-act, and it loses the race. Two clicks landing together both delete
-- nothing, then both insert, and the queue holds two rows for the same post.
--
-- Found live: two concurrent schedule calls returned 200 and 200, leaving two rows.
-- For LinkedIn and X that is a duplicate reminder email. For the newsletter it is
-- the same issue sent twice to every subscriber, which is the kind of mistake a
-- reader notices and cannot be taken back.
--
-- Enforced in the database rather than more carefully in the route, because the
-- route cannot make delete-then-insert atomic on its own, and any future code path
-- that queues content inherits this for free. Partial, so the history of already
-- published, failed and overdue rows is untouched.
set lock_timeout = '5s';

create unique index if not exists scheduled_content_one_pending_per_post
  on scheduled_content (channel_post_id)
  where status = 'scheduled';
