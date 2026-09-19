export type DraftRow = {
  id: string;
  version: number;
  created_at: string;
  chosen?: boolean | null;
};

export type DraftEval = {
  section_id?: string | null;
  content_version?: number | null;
  overall_score?: number | null;
  created_at?: string | null;
};

/**
 * The score attached to a draft, or null if it was never scored.
 *
 * Matched on section_id, not on the version number. Two sections can share a version
 * number once a re-picked angle restarts numbering at 1, and matching on the number
 * then shows one draft's text beside another draft's score. The fallback to the
 * number exists only for rows written before section_id was populated, and only when
 * it is unambiguous within the request.
 */
export function scoreForDraft(section: DraftRow, evaluations: DraftEval[]): number | null {
  const byId = evaluations.filter((e) => e.section_id === section.id);
  if (byId.length > 0) {
    const newest = byId[byId.length - 1];
    return typeof newest.overall_score === "number" ? newest.overall_score : null;
  }
  const byVersion = evaluations.filter(
    (e) => !e.section_id && e.content_version === section.version
  );
  if (byVersion.length === 1 && typeof byVersion[0].overall_score === "number") {
    return byVersion[0].overall_score;
  }
  return null;
}

/**
 * Which draft the author should be looking at.
 *
 * Same rule as channel posts, one table over: the highest score is what you see, an
 * explicit choice beats the score, and ties go to the newer draft.
 *
 * Before this, the article shown was simply the newest row, so a regeneration that
 * scored worse than the draft before it silently became the article while the better
 * one sat in the table with nothing offering it.
 *
 * `chosen` is optional on purpose: it reads correctly whether or not migration 016 has
 * been applied, falling back to the score when the column is absent or unset.
 */
export function pickDraft<T extends DraftRow>(sections: T[], evaluations: DraftEval[]): T | undefined {
  if (sections.length === 0) return undefined;

  const explicit = sections.filter((s) => s.chosen);
  if (explicit.length > 0) {
    // More than one chosen means something wrote without clearing. Newest wins rather
    // than whichever row the query happened to return first, which is the failure
    // mode that made a channel post look like it had vanished.
    return [...explicit].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0];
  }

  return [...sections].sort((a, b) => {
    const diff = (scoreForDraft(b, evaluations) ?? -1) - (scoreForDraft(a, evaluations) ?? -1);
    if (diff !== 0) return diff;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  })[0];
}
