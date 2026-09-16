const STATUS_STYLES: Record<string, string> = {
  draft: "bg-black/5 text-muted",
  researching: "bg-warning-soft text-warning",
  awaiting_source_selection: "bg-warning-soft text-warning",
  awaiting_angle_selection: "bg-accent-soft text-accent",
  generating: "bg-accent-soft text-accent",
  evaluating: "bg-accent-soft text-accent",
  revising: "bg-warning-soft text-warning",
  pending_approval: "bg-accent-soft text-accent",
  approved: "bg-success-soft text-success",
  rejected: "bg-danger-soft text-danger",
  needs_human_attention: "bg-danger-soft text-danger",
  adapting: "bg-accent-soft text-accent",
  ready_to_schedule: "bg-success-soft text-success",
};

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? "bg-black/5 text-muted";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${style}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}
