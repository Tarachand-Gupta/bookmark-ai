import { OAuthConsent } from "@/components/auth/oauth-consent";
export default function ConsentPage() {
  return (
    <OAuthConsent
      clientIds={(process.env.SUPABASE_EXTENSION_CLIENT_IDS ?? "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)}
      redirects={(process.env.SUPABASE_EXTENSION_REDIRECT_URIS ?? "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)}
    />
  );
}
