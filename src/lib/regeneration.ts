// One cap, one place. This was duplicated between the regenerate route and the
// review-actions UI, and select-angle now needs it too: a re-pick of an angle that
// has already been generated against spends an attempt from the same budget, since
// it costs exactly the same work as pressing Regenerate.
export const REGENERATION_CAP = 5;
