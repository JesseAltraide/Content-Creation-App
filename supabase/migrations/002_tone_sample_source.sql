-- Adds a source column to tone_samples distinguishing real previous posts from a
-- described target voice (for a brand-new company with nothing to sample yet).
-- See Change entry revising Decision #13 in week4-progress.md.

alter table tone_samples
  add column if not exists source text not null default 'real_post'
    check (source in ('real_post', 'described_target'));
