// Next renders this the instant a request link is clicked, so the click produces a
// visible response even though the page itself is fully dynamic (it reads the
// request, its sources, angles, sections, evaluations, channel posts, comments and
// schedule before it can render anything). Without it the old page just sat there
// during the fetch, which reads as a dead click.
//
// A skeleton in the shape of the real page rather than a bare spinner: it says what
// is coming, and the layout does not jump when the content lands.
export default function Loading() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12" aria-busy="true" aria-live="polite">
      <div className="h-3 w-24 animate-pulse rounded bg-border" />

      <div className="mt-4 flex items-start justify-between gap-4">
        <div className="h-7 w-2/3 animate-pulse rounded bg-border" />
        <div className="h-6 w-28 shrink-0 animate-pulse rounded-full bg-border" />
      </div>

      <div className="mt-8 flex gap-2">
        {[64, 56, 72, 48].map((w, i) => (
          <div key={i} className="h-8 animate-pulse rounded-lg bg-border" style={{ width: w }} />
        ))}
      </div>

      <div className="mt-6 rounded-xl border border-border bg-surface p-6">
        <div className="h-4 w-1/3 animate-pulse rounded bg-border" />
        <div className="mt-4 flex flex-col gap-2">
          {[100, 96, 88, 92, 70].map((w, i) => (
            <div key={i} className="h-3 animate-pulse rounded bg-border" style={{ width: `${w}%` }} />
          ))}
        </div>
      </div>

      <p className="mt-6 text-center text-xs text-muted">Opening this request…</p>
    </main>
  );
}
