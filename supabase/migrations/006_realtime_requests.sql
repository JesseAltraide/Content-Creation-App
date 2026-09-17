-- WorkingBanner (src/app/requests/[id]/working-banner.tsx) needs to know when a
-- background pipeline stage (researching/generating/adapting) actually changes,
-- without polling the DB on a timer. Adding these two tables to the realtime
-- publication lets the client subscribe to postgres_changes directly and only
-- refresh when something real happens: either the request row itself changes
-- (a status transition) or a new event_log row lands for it (a failure that
-- doesn't necessarily change status, e.g. a webhook trigger erroring before n8n
-- even runs) - both are needed, since a failed retry only shows up as the latter.
alter publication supabase_realtime add table requests;
alter publication supabase_realtime add table event_log;
