import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      {/* Land in the app after auth (not the "/" marketing page). fallback, not
          force: an explicit ?redirect_url (e.g. a deep link) still wins. */}
      <SignIn fallbackRedirectUrl="/app" signUpUrl="/sign-up" />
    </div>
  );
}
