export type ScoredPost = {
  id: string;
  channel: string;
  version: number;
  created_at?: string | null;
};

export type ChannelEval = {
  channel?: string | null;
  content_version?: number | null;
  channel_post_id?: string | null;
  created_at?: string | null;
  overall_score?: number | null;
  status?: string | null;
  // Carried through so callers can read the evaluation itself, not only its score.
  criteria?: unknown;
  weakest_criteria_suggestions?: unknown;
};

/**
 * The evaluation belonging to a specific channel post.
 *
 * One function, used everywhere a score is read, so the join rule cannot drift again.
 * It has drifted five times: re-running adaptation restarts version numbers at 1, so
 * (channel, version) matches rows from other runs, and every consumer that joined on
 * it has been wrong at least once.
 *
 * Prefers `channel_post_id`, which is the actual identity (migration 017). Falls back
 * to the version number for rows written before that column existed, and when it does
 * it takes the NEWEST match rather than asserting there is only one: assuming
 * uniqueness there is exactly what produced a PGRST116 and a null score, which in turn
 * let a rewrite scoring 82 replace a version scoring 85.
 */
export function evalForPost(
  post: ScoredPost,
  evaluations: ChannelEval[],
  siblings?: ScoredPost[]
): ChannelEval | undefined {
  const byId = evaluations.filter((e) => e.channel_post_id && e.channel_post_id === post.id);
  if (byId.length > 0) return newest(byId);

  // Legacy rows, written before migration 017, carry only a channel and a number.
  // They are dated into a window: an evaluation belongs to this post if it was written
  // after it and before the NEXT post that reused the same version number. Without the
  // upper bound, a later run's v1 score attaches to an earlier run's v1, which is the
  // same wrong-join in a new disguise.
  const reuse = (siblings ?? [])
    .filter(
      (p) =>
        p.channel === post.channel &&
        p.version === post.version &&
        p.created_at &&
        post.created_at &&
        p.created_at > post.created_at
    )
    .map((p) => p.created_at as string)
    .sort();
  const until = reuse[0];

  const byVersion = evaluations.filter(
    (e) =>
      !e.channel_post_id &&
      e.channel === post.channel &&
      e.content_version === post.version &&
      (!post.created_at || !e.created_at || e.created_at >= post.created_at) &&
      (!until || !e.created_at || e.created_at < until)
  );
  return byVersion.length > 0 ? newest(byVersion) : undefined;
}

export function scoreForPost(
  post: ScoredPost,
  evaluations: ChannelEval[],
  siblings?: ScoredPost[]
): number | null {
  const found = evalForPost(post, evaluations, siblings);
  return typeof found?.overall_score === "number" ? found.overall_score : null;
}

function newest(rows: ChannelEval[]): ChannelEval {
  return [...rows].sort(
    (a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
  )[0];
}
