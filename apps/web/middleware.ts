import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// The app can't be used without logging in first: every route except the auth
// pages requires a signed-in user. Unauthenticated requests are redirected to
// the sign-in page (401 for API routes) by auth.protect().
const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Run on everything except Next internals and static asset files.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes and Clerk's /__clerk auto-proxy path.
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
