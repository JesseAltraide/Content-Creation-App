function tierStyle(pct: number) {
  if (pct >= 0.73) return { bar: "bg-success", text: "text-success" }; // 11-15/15
  if (pct >= 0.47) return { bar: "bg-warning", text: "text-warning" }; // 7-10/15
  return { bar: "bg-danger", text: "text-danger" }; // 0-6/15
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
  const { bar, text } = tierStyle(pct);

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
