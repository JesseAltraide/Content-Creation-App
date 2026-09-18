-- Per-user request isolation. Reverses part of Decision #16/#96's flat model:
-- requests become private to whoever created them, while audience profiles, tone
-- samples, the subscriber list and workspace settings stay SHARED, because those
-- define the brand voice the evaluator grades against (Decisions #13/#14) and
-- splitting them would mean the same company publishing in several voices, each
-- graded to a different standard.
--
-- Nullable on purpose. Existing rows predate ownership and there is no honest way
-- to attribute them, so they stay NULL and remain visible to everyone as legacy
-- rows rather than silently disappearing from the programmer's test data.
alter table requests
  add column user_id uuid references auth.users(id) on delete set null;

create index requests_user_id_idx on requests (user_id);

-- RLS is not the enforcement point here and must not be mistaken for it: almost
-- every read in this app goes through the service-role client (createAdminClient),
-- which bypasses RLS entirely. Ownership is filtered in the queries themselves.
-- This policy stays permissive so nothing that currently works breaks.
