-- One shared workspace-level setting, same pattern as audience_profiles and
-- tone_samples (Decision #16/#96): this app models one company's shared workspace,
-- not per-user settings - there's no coherent answer for "whose email does a
-- scheduled post's reminder go to" under the flat single-role model (Decision #75).
-- Single row enforced via a fixed boolean primary key (the standard Postgres
-- singleton-table trick) rather than an app-level check.
create table workspace_settings (
  id boolean primary key default true,
  notification_email text,
  updated_at timestamptz not null default now(),
  constraint workspace_settings_singleton check (id)
);

insert into workspace_settings (id) values (true);

alter table workspace_settings enable row level security;

create policy "authenticated full access" on workspace_settings for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
