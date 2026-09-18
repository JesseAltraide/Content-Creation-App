// Where a run that stopped without reporting back should be put so the human has a
// way forward. Shared by the manual reset button and the cron sweep, because two
// copies of this map would eventually disagree about what "safe" means.
export const SAFE_STATE: Record<string, { to: string; unchooseAngles?: boolean }> = {
  adapting: { to: "approved" },
  generating: { to: "awaiting_angle_selection", unchooseAngles: true },
  revising: { to: "awaiting_angle_selection", unchooseAngles: true },
  researching: { to: "needs_human_attention" },
};

// The manual button uses the banner's own 5 minute threshold, because a human looking
// at a silent page has context the server does not. The sweep is deliberately much
// more patient: it acts without anyone asking, so a false positive would cancel a
// healthy run. The worst full run measured on this project was 224 seconds, and
// Workflow B with two revision rounds is the longest path, so 20 minutes is roughly
// five times the worst case actually observed.
export const STALLED_SWEEP_MS = 20 * 60 * 1000;
export const STALLED_MANUAL_MS = 5 * 60 * 1000;
