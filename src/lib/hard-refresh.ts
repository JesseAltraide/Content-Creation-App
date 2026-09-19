/**
 * Re-render the page after an action that changed server state.
 *
 * This is a full browser reload, deliberately, and it exists so the reason is written
 * down once instead of being rediscovered.
 *
 * `router.refresh()` does not reliably re-render the server components in this app.
 * It has failed three separate times, each reported as "I pressed the button and
 * nothing happened": the request page polled every ten seconds and never updated
 * (Error #43), the request list sat on stale badges, and picking sources left the
 * button saying "Continuing" with the page unchanged. Every one of those was a
 * refresh that returned without re-rendering.
 *
 * The cost is real: a reload loses scroll position and any unsaved form state, and it
 * is slower than a client-side re-render would be. That is the trade being made. An
 * action that appears to do nothing is worse than an action that takes another second,
 * and this app's server components carry almost everything worth seeing.
 *
 * Use this after a mutation. For plain navigation, use a Link.
 */
export function hardRefresh(): void {
  window.location.reload();
}
