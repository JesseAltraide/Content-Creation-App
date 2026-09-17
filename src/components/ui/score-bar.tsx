function tierStyle(score: number, max: number, floor?: number) {
  // Tiers are derived from the actual floor, not a fixed percentage - a criterion
  // scoring exactly at its floor is the documented "soft flag, still proceeds" case
  // (e.g. resonance 7-10/15), not a hard failure, and shouldn't render as red.
  if (floor === undefined) {
    const pct = score / max;
    if (pct >= 0.73) return { bar: "bg-success", text: "text-success" };
    if (pct >= 0.47) return { bar: "bg-warning", text: "text-warning" };
    return { bar: "bg-danger", text: "text-danger" };
  }
  if (score < floor) return { bar: "bg-danger", text: "text-danger" };
  if (score < floor + (max - floor) / 2) return { bar: "bg-warning", text: "text-warning" };
  return { bar: "bg-success", text: "text-success" };
}

export function ScoreBar({
  label,
  score,
  max,
  floor,
}: {
  label: string;
  score: number;
  max: number;
  floor?: number;
}) {
  const pct = Math.max(0, Math.min(1, score / max));
  const { bar, text } = tierStyle(score, max, floor);

  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-foreground">{label}</span>
        <span className={`font-semibold ${text}`}>
          {score}/{max}
        </span>
      </div>
      <div className="relative mt-1.5 h-2 w-full overflow-hidden rounded-full bg-black/5">
        <div
          className={`h-full rounded-full ${bar} transition-all`}
          style={{ width: `${pct * 100}%` }}
        />
        {floor !== undefined && (
          <div
            className="absolute top-0 h-full w-px bg-foreground/30"
            style={{ left: `${(floor / max) * 100}%` }}
            title={`Floor: ${floor}/${max}`}
          />
        )}
      </div>
    </div>
  );
}
