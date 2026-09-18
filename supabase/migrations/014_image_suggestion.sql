-- LinkedIn and X are reminder channels: the human posts them by hand, which is also
-- the moment they would attach an image. Nothing in the pipeline had an opinion about
-- that, so a post that badly needs a chart and one that would be diluted by a stock
-- photo arrived looking identical.
--
-- Stored per channel post version rather than per request, because the answer belongs
-- to the specific text: a revision that drops the one statistic also drops the reason
-- to chart it. Nullable, so a post simply has no opinion until one is asked for.
set lock_timeout = '5s';

alter table channel_posts
  add column if not exists image_suggestion jsonb;
