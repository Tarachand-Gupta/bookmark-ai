import { clerkMiddleware } from "@clerk/nextjs/server";

// Clerk runs on every route so auth state is available everywhere (server and
// client), but no route is force-protected: the app's own header shows
// Sign in / Sign up when signed out and a UserButton when signed in. The
// bookmark library stays publicly viewable. To gate specific routes later,
// switch to `clerkMiddleware(async (auth) => { await auth.protect() })` with a
// route matcher.
export default clerkMiddleware();

export const config = {
  matcher: [
    // Run on everything except Next internals and static asset files.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes and Clerk's /__clerk auto-proxy path.
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
