-- Claude explains WHY an idea resonates (or does not) with an audience, and that
-- explanation was only ever used in the blocked-event detail. On the success path
-- it was discarded, so a request that auto-matched its audience could show which
-- profile won and the score, but never the reasoning behind either. With more than
-- one audience profile on file that is the interesting part: "why this audience
-- rather than the other one".
--
-- Same omission as Error #20, which fixed the blocked path only. The success path
-- kept throwing it away.
set lock_timeout = '5s';

alter table angles
  add column if not exists resonance_reasoning text;
