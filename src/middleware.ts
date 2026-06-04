import { NextResponse, type NextRequest } from "next/server";

// Auth is DORMANT. This middleware is a deliberate pass-through so every route
// stays public for the MVP. When Supabase login is switched on, replace the
// body with the standard `updateSession` token-refresh logic and guard
// protected routes (e.g. await supabase.auth.getClaims()).
export function middleware(_req: NextRequest) {
  return NextResponse.next();
}

export const config = {
  // Run on app routes but skip static assets, image optimisation, and the upload
  // endpoint — the proxy buffers request bodies, so excluding /api/upload keeps
  // large file uploads from being buffered (and truncated) in memory.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/upload).*)"],
};
