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

// Extension CORS allowlist. moz-extension AND safari-web-extension ids are
// per-install UUIDs (unpinnable), so any origin on those schemes is allowed — the
// bearer token, or (Safari cookie path) the site's own session cookie, is the
// real gate. chrome-extension:// ids ARE stable and pinned, so those must EXACTLY
// match our authorized extension id; otherwise an arbitrary malicious extension
// could get CORS access to a user's session.
const SCHEME_ALLOWED_EXTENSION = /^(moz-extension|safari-web-extension):\/\//;
const CHROME_EXTENSION = /^chrome-extension:\/\//;
function isAllowedExtensionOrigin(origin: string): boolean {
  if (SCHEME_ALLOWED_EXTENSION.test(origin)) return true;
  if (CHROME_EXTENSION.test(origin)) return AUTHORIZED_PARTIES.includes(origin);
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
    // Allow the Safari cookie path (fetch with credentials:'include') to pass a
    // credentialed CORS check. Valid only because ACAO echoes the specific origin
    // above, never "*". Bearer clients (web/chrome/mobile) ignore it.
    "access-control-allow-credentials": "true",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

// ── Legacy /app deep links → /app/library ──────────────────────────────────
// `/app` is the dashboard now and the grid moved to `/app/library`
// (docs/features/dashboard.md §3). Every URL anyone ever shared, bookmarked, or
// hardcoded into a client points at `/app?<filter>` — so bare `/app` carrying ANY
// library param is redirected to `/app/library` with the query preserved, and the
// dashboard owns only the paramless landing. Done here rather than in the page so
// the library never mounts (and never flashes) behind a client-side hop.
//
// Keep this list in lockstep with what the library reads from the URL:
// FILTER_KEYS + q + ai + settings + section in components/library/library-page.tsx.
// `view` is included defensively — it's localStorage state today, but old links
// carrying it must still land on the grid.
const LEGACY_LIBRARY_PARAMS = [
  "q",
  "category",
  "browser",
  "device",
  "day",
  "from",
  "to",
  "tag",
  "ai",
  "settings",
  "section",
  "view",
] as const;

function legacyLibraryRedirect(request: NextRequest): NextResponse | null {
  // Trailing slash tolerated: Next normalizes it, but middleware can see either.
  const pathname = request.nextUrl.pathname.replace(/\/+$/, "") || "/";
  if (pathname !== "/app") return null;
  const params = request.nextUrl.searchParams;
  if (!LEGACY_LIBRARY_PARAMS.some((key) => params.has(key))) return null;
  const url = request.nextUrl.clone();
  url.pathname = "/app/library";
  return NextResponse.redirect(url);
}

// The API CORS handling, shared by both middleware variants. Returns the
// response for an API route, or null when the request isn't one.
function handleApiCors(request: NextRequest): NextResponse | null {
  if (!isApiRoute(request)) return null;
  const headers = corsHeaders(request.headers.get("origin"));
  if (request.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers });
  }
  // Trusted route stamp for requireUser()'s device-token scope check. ALWAYS
  // overwritten here (never passed through), so a client cannot spoof it —
  // requireUser rejects device tokens outright when the stamp is missing.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-bkm-route", `${request.method} ${request.nextUrl.pathname}`);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
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
    // After protect(), so an unauthenticated legacy link still goes to sign-in
    // first (and lands on the library once signed in).
    return legacyLibraryRedirect(request) ?? undefined;
  },
  // NOTE: no `authorizedParties` option here — @clerk/nextjs rejects tokens
  // with a MISSING azp claim (native mobile tokens have none). The azp check
  // with Express semantics (absent = pass, wrong = reject) lives in
  // lib/server/require-user.ts instead.
);

function keylessMiddleware(request: NextRequest): NextResponse {
  return handleApiCors(request) ?? legacyLibraryRedirect(request) ?? NextResponse.next();
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
