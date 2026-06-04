import { createBrowserClient } from "@supabase/ssr";

// Browser Supabase client. DORMANT placeholder — created and exported so login
// can be wired later, but nothing in the app currently calls it as a gate.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_placeholder"
  );
}
