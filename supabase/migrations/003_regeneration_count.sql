-- Tracks human-triggered "regenerate with comment" attempts (Workflow C) per
-- request. Capped at 5 (decided directly by the programmer during this build) -
-- enforced atomically by the regenerate API route, not just checked-then-written.
alter table requests add column regeneration_count int not null default 0;
