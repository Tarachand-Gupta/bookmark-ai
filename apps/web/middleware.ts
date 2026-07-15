import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import { AUTHORIZED_PARTIES } from "@/lib/authorized-parties";

// The app itself (/app and everything else) can't be used without logging in
// first. Public routes: the marketing home ("/", exact — /app stays protected)
// and the auth pages. API routes are NOT protect()ed here — they authenticate
// themselves via requireUser() (clean 401 JSON instead of a redirect, and
// Bearer-token clients like the extension and mobile app never want an HTML
// sign-in page). clerkMiddleware still runs on /api (and "/") so auth() has
// request context there — the marketing page reads it to redirect signed-in
// users straight to /app.
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/privacy",
  "/terms",
]);
const isApiRoute = createRouteMatcher(["/api(.*)"]);

// Browser CORS for the API: known web origins plus allowed extension origins.
// Unknown web origins get no CORS headers.
const CORS_WEB_ORIGINS = new Set(AUTHORIZED_PARTIES.filter((o) => o.startsWith("http")));

// Extension CORS allowlist. Firefox ids are per-install UUIDs (unpinnable), so
// any moz-extension origin is allowed — the bearer token is the real gate there.
// But chrome-extension:// and safari-web-extension:// ids ARE stable and pinned,
// so those must EXACTLY match our authorized extension id; otherwise an arbitrary
// malicious extension could get CORS access to a user's session.
const FIREFOX_EXTENSION = /^moz-extension:\/\//;
const PINNED_EXTENSION = /^(chrome|safari-web)-extension:\/\//;
function isAllowedExtensionOrigin(origin: string): boolean {
  if (FIREFOX_EXTENSION.test(origin)) return true;
  if (PINNED_EXTENSION.test(origin)) return AUTHORIZED_PARTIES.includes(origin);
  return false;
}

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin || (!CORS_WEB_ORIGINS.has(origin) && !isAllowedExtensionOrigin(origin))) {
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

// The API CORS handling, shared by both middleware variants. Returns the
// response for an API route, or null when the request isn't one.
function handleApiCors(request: NextRequest): NextResponse | null {
  if (!isApiRoute(request)) return null;
  const headers = corsHeaders(request.headers.get("origin"));
  if (request.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers });
  }
  const response = NextResponse.next();
  for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
  return response;
}

// Keyless self-host mode has no Clerk keys, and clerkMiddleware throws at
// request time without them — so pick the middleware at module load. With
// keys: the full gate (protect() every page, self-authenticating /api). Without
// keys: only API CORS, pages pass through unprotected (rendering the page UI
// still needs Clerk, but that's a build/config concern documented elsewhere).
const clerkGate = clerkMiddleware(
  async (auth, request) => {
    const apiResponse = handleApiCors(request);
    if (apiResponse) return apiResponse;
    if (!isPublicRoute(request)) {
      await auth.protect();
    }
  },
  // NOTE: no `authorizedParties` option here — @clerk/nextjs rejects tokens
  // with a MISSING azp claim (native mobile tokens have none). The azp check
  // with Express semantics (absent = pass, wrong = reject) lives in
  // lib/server/require-user.ts instead.
);

function keylessMiddleware(request: NextRequest): NextResponse {
  return handleApiCors(request) ?? NextResponse.next();
}

export default process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? clerkGate : keylessMiddleware;

export const config = {
  matcher: [
    // Run on everything except Next internals and static asset files.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes and Clerk's /__clerk auto-proxy path.
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
