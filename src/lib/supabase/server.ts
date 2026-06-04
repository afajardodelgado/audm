import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Server Supabase client. DORMANT placeholder — wired with the standard cookie
// adapter so it's ready to enforce auth later, but no layout/route currently
// calls supabase.auth.getClaims() to guard access, so every route stays public.
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_placeholder",
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component — safe to ignore; middleware would
            // refresh the session in a real auth setup.
          }
        },
      },
    }
  );
}
