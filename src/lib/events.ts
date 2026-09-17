import { createAdminClient } from "@/lib/supabase/admin";

export async function logEvent(params: {
  requestId?: string | null;
  stage: string;
  status: "success" | "failed";
  detail?: string;
}) {
  const supabase = createAdminClient();
  const { error } = await supabase.from("event_log").insert({
    request_id: params.requestId ?? null,
    stage: params.stage,
    status: params.status,
    detail: params.detail ?? null,
  });
  // Logging must never silently swallow its own failure - if the log write
  // itself fails, there is nothing left to surface it except the server console.
  if (error) console.error("event_log insert failed", { params, error });
}
