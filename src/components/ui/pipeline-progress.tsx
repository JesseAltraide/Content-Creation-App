type StageState = "done" | "current" | "upcoming" | "blocked";

const STAGES = [
  { key: "research", label: "Research" },
  { key: "angle", label: "Angle" },
  { key: "draft", label: "Draft & review" },
  { key: "adapt", label: "Adapt" },
  { key: "schedule", label: "Scheduled" },
] as const;

type StageKey = (typeof STAGES)[number]["key"];

// A stage the most recent event happened in, used only to place needs_human_attention
// on the right step - the request_status enum has no equivalent for "attention
// needed while adapting" the way it does for "researching" vs "generating", so the
// blocked stage has to come from event_log's stage field instead.
const EVENT_STAGE_TO_PIPELINE_STAGE: Record<string, StageKey> = {
  research_search_trigger: "research",
  scrape_and_propose_trigger: "research",
  angle_proposal: "angle",
  excerpt_selection: "draft",
  generation: "draft",
  evaluation: "draft",
  revision: "draft",
  regeneration_setup: "draft",
  channel_adaptation: "adapt",
  pass2_evaluation: "adapt",
};

function resolveStage(
  status: string,
  blockedEventStage?: string
): { current: StageKey; blocked: boolean } {
  switch (status) {
    case "draft":
    case "researching":
    case "awaiting_source_selection":
      return { current: "research", blocked: false };
    case "awaiting_angle_selection":
      return { current: "angle", blocked: false };
    case "generating":
    case "evaluating":
    case "revising":
    case "pending_approval":
      return { current: "draft", blocked: false };
    case "approved":
    case "adapting":
      return { current: "adapt", blocked: false };
    case "ready_to_schedule":
      return { current: "schedule", blocked: false };
    case "needs_human_attention":
      return {
        current: (blockedEventStage && EVENT_STAGE_TO_PIPELINE_STAGE[blockedEventStage]) || "research",
        blocked: true,
      };
    case "rejected":
      return { current: "draft", blocked: true };
    default:
      return { current: "research", blocked: false };
  }
}

export function PipelineProgress({
  status,
  failed = false,
  blockedEventStage,
}: {
  status: string;
  failed?: boolean;
  blockedEventStage?: string;
}) {
  const { current, blocked: statusBlocked } = resolveStage(status, blockedEventStage);
  const blocked = statusBlocked || failed;
  const currentIndex = STAGES.findIndex((s) => s.key === current);

  function stateFor(index: number): StageState {
    if (index < currentIndex) return "done";
    if (index === currentIndex) return blocked ? "blocked" : "current";
    return "upcoming";
  }

  return (
    <div className="flex items-center">
      {STAGES.map((stage, i) => {
        const state = stateFor(i);
        return (
          <div key={stage.key} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                  state === "done"
                    ? "bg-success text-white"
                    : state === "current"
                      ? "bg-accent text-accent-foreground"
                      : state === "blocked"
                        ? "bg-danger text-white"
                        : "bg-black/5 text-muted"
                }`}
              >
                {state === "done" ? "✓" : state === "blocked" ? "!" : i + 1}
              </div>
              <span
                className={`text-xs font-medium ${
                  state === "upcoming" ? "text-muted" : "text-foreground"
                }`}
              >
                {stage.label}
              </span>
            </div>
            {i < STAGES.length - 1 && (
              <div
                className={`mx-2 h-0.5 flex-1 rounded ${
                  i < currentIndex ? "bg-success" : "bg-black/10"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
