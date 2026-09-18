-- Going back to angle selection after a dead end, then re-picking the SAME angle,
-- re-ran the whole of Workflow B (generation + up to 2 revision rounds + two Opus
-- evaluations, the ~$0.12 / ~200s path) without consuming a regeneration attempt.
-- That is a regeneration in everything but name, and it was unbounded: the 5-attempt
-- cap on the Regenerate button could be walked around indefinitely by bouncing
-- through needs_human_attention.
--
-- angles.chosen can't tell us this, because back-to-angle-selection resets it to
-- false by design so the angle can be re-picked. This is the durable record of
-- "generation has actually been run against this angle before".
set lock_timeout = '5s';

alter table angles
  add column if not exists generation_count integer not null default 0;

-- Existing rows: an angle that is currently chosen has been generated against at
-- least once. Anything else genuinely has not.
update angles set generation_count = 1 where chosen = true and generation_count = 0;
