import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { AUTHORIZED_PARTIES } from "@/lib/authorized-parties";

// The app can't be used without logging in first: every page except the auth
// pages requires a signed-in user. API routes are NOT protect()ed here — they
// authenticate themselves via requireUser() (clean 401 JSON instead of a
// redirect, and Bearer-token clients like the extension and mobile app never
// want an HTML sign-in page). clerkMiddleware still runs on /api so auth()
// has request context there.
const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);
const isApiRoute = createRouteMatcher(["/api(.*)"]);

// Browser CORS for the API: known web origins and any browser-extension
// scheme (Firefox ids are per-install UUIDs, so no pinning — the bearer
// token is the real gate). Unknown web origins get no CORS headers.
const CORS_WEB_ORIGINS = new Set(AUTHORIZED_PARTIES.filter((o) => o.startsWith("http")));
const EXTENSION_SCHEME = /^(chrome|moz|safari-web)-extension:\/\//;

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin || (!CORS_WEB_ORIGINS.has(origin) && !EXTENSION_SCHEME.test(origin))) {
    return { vary: "Origin" };
  }
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "authorization,content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

export default clerkMiddleware(
  async (auth, request) => {
    if (isApiRoute(request)) {
      const headers = corsHeaders(request.headers.get("origin"));
      if (request.method === "OPTIONS") {
        return new NextResponse(null, { status: 204, headers });
      }
      const response = NextResponse.next();
      for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      return response;
    }
    if (!isPublicRoute(request)) {
      await auth.protect();
    }
  },
  // NOTE: no `authorizedParties` option here — @clerk/nextjs rejects tokens
  // with a MISSING azp claim (native mobile tokens have none). The azp check
  // with Express semantics (absent = pass, wrong = reject) lives in
  // lib/server/require-user.ts instead.
);

export const config = {
  matcher: [
    // Run on everything except Next internals and static asset files.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes and Clerk's /__clerk auto-proxy path.
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
