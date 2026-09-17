-- Workflow D (channel adaptation): a channel can have more than one tone_variant
-- row (the default, plus an explicitly-requested "alternate tone"). `chosen` marks
-- which one is canonical for scheduling - mirrors `angles.chosen`'s pattern for the
-- article-angle selection step. The first variant generated for a channel is chosen
-- by default (there's nothing to pick between yet); requesting an alternate tone
-- inserts a second row with chosen = false until the human explicitly picks one.
alter table channel_posts add column chosen boolean not null default true;
