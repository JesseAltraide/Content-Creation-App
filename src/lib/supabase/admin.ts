import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role client for server-only code paths (API routes, cron jobs) that
// must bypass RLS to perform atomic conditional writes across tables. Never
// import this into client components.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
