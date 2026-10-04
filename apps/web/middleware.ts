import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { AUTHORIZED_PARTIES } from "@/lib/authorized-parties";

// The app itself (/app and everything else) can't be used without logging in
// first. Public routes: the marketing home ("/", exact — /app stays protected),
// the auth pages, the legal/support pages the app stores link to (their
// URLs are entered in App Store Connect / Play Console and must load signed
// out), and the public /download page. API routes are NOT protect()ed here — they authenticate
// themselves via requireUser() (clean 401 JSON instead of a redirect, and
// Bearer-token clients like the extension and mobile app never want an HTML
// sign-in page). clerkMiddleware still runs on /api (and "/") so auth() has
// request context there — the marketing page reads it to redirect signed-in
// users straight to /app.
function isPublicRoute(request: NextRequest): boolean {
  const path = request.nextUrl.pathname;
  return (
    path === "/" ||
    ["/sign-in", "/sign-up", "/auth", "/privacy", "/terms", "/support", "/download"].some(
      (prefix) => path === prefix || path.startsWith(prefix + "/"),
    )
  );
}
function isApiRoute(request: NextRequest): boolean {
  return request.nextUrl.pathname.startsWith("/api/");
}

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
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers":
      "authorization,content-type,x-bookmark-client,x-bookmark-analytics-consent",
    // Response headers a cross-origin caller (the extension) may read: the chat
    // route's conversation id, which key answered, and the optional advisory
    // (`own-key-incomplete`) — see /api/chat.
    "access-control-expose-headers": "X-Conversation-Id, X-Ai-Source, X-Ai-Note, X-Ai-Model-Tier",
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
// FILTER_KEYS + q + ai + section in components/library/library-page.tsx.
// `view` is included defensively — it's localStorage state today, but old links
// carrying it must still land on the grid.
//
// `settings` is deliberately NOT here: the Settings modal is not a library view,
// and the DASHBOARD handles `?settings=<section>` itself now (see
// components/dashboard/dashboard-page.tsx). Redirecting it bounced every settings
// deep link off Home onto the grid — including the header avatar's "Manage
// account", which builds its URL from wherever you already are, and the
// extension's gear (`/app?settings=devices`). Both now open the modal in place.
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
  requestHeaders.set("x-bkm-origin", request.nextUrl.origin);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
  return response;
}

export default async function middleware(request: NextRequest) {
  const api = handleApiCors(request);
  if (api) return api;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    if (isPublicRoute(request)) return NextResponse.next();
    return new NextResponse("Authentication is not configured.", { status: 503 });
  }
  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookieOptions: { name: "bmai-supabase-qa-auth" },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies) => {
        cookies.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  if (isPublicRoute(request)) return response;
  try {
    const { data: claims, error: claimError } = await supabase.auth.getClaims();
    const value = claims?.claims;
    if (!claimError && value) {
      const audience = value.aud;
      const validAudience =
        audience === "authenticated" ||
        (Array.isArray(audience) && audience.includes("authenticated"));
      if (
        value.iss !== url.replace(/\/$/, "") + "/auth/v1" ||
        !validAudience ||
        typeof value.session_id !== "string" ||
        !value.session_id ||
        value.role !== "authenticated"
      )
        return new NextResponse("Invalid authentication.", { status: 401 });
      const { data, error } = await supabase.auth.getUser();
      if (error && (error.status === undefined || error.status >= 500 || error.status === 429))
        return new NextResponse("Authentication is temporarily unavailable. Try again.", {
          status: 503,
          headers: { "cache-control": "no-store" },
        });
      if (data.user) {
        if (
          data.user.factors?.some((factor) => factor.status === "verified") &&
          value.aal !== "aal2"
        ) {
          const destination = request.nextUrl.clone();
          destination.pathname = "/auth/mfa";
          destination.search = "";
          destination.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
          const redirect = NextResponse.redirect(destination);
          response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
          return redirect;
        }
        const destination = legacyLibraryRedirect(request);
        if (destination) {
          response.cookies.getAll().forEach((cookie) => destination.cookies.set(cookie));
          return destination;
        }
        response.headers.set("cache-control", "private, no-store");
        return response;
      }
    } else if (claimError && (claimError.status === undefined || claimError.status >= 500)) {
      return new NextResponse("Authentication is temporarily unavailable. Try again.", {
        status: 503,
      });
    }
    const destination = request.nextUrl.clone();
    destination.pathname = "/sign-in";
    destination.search = "";
    destination.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    const redirect = NextResponse.redirect(destination);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  } catch {
    return new NextResponse("Authentication is temporarily unavailable. Try again.", {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
}

export const config = {
  matcher: [
    // Run on everything except Next internals and static asset files.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes and Clerk's /__clerk auto-proxy path.
    "/(api|trpc)(.*)",
  ],
};
