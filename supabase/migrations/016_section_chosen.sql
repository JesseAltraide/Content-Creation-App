-- Drafts get the same treatment channel posts already have: every attempt is kept,
-- the highest scoring one is what you see, and the author can pick a different one.
--
-- Until now the article shown was simply the newest row. A regeneration that scored
-- worse than the draft it followed silently became the article, and the better one
-- was still in the table with nothing offering it. That is the same complaint that
-- produced the channel version picker, one table over.
--
-- `chosen` rather than deriving "highest score" at read time, because the author has
-- to be able to disagree with the number and have that stick.
set lock_timeout = '5s';

alter table sections
  add column if not exists chosen boolean not null default false;

-- Backfill: the highest-scoring section per request, ties going to the newest, which
-- is the same rule the picker applies from here on. Requests whose drafts were never
-- scored fall back to their newest row rather than being left with nothing chosen.
with ranked as (
  select
    s.id,
    s.request_id,
    row_number() over (
      partition by s.request_id
      order by coalesce(e.overall_score, -1) desc, s.created_at desc
    ) as rank
  from sections s
  left join lateral (
    select overall_score
    from evaluation_results e
    where e.section_id = s.id and e.pass = 'pass_1_article'
    order by created_at desc
    limit 1
  ) e on true
)
update sections
set chosen = true
where id in (select id from ranked where rank = 1);

-- One chosen draft per request, enforced rather than assumed. The channel posts
-- equivalent was left as a convention and drifted to four chosen rows on one channel.
create unique index if not exists sections_one_chosen_per_request
  on sections (request_id)
  where chosen;
