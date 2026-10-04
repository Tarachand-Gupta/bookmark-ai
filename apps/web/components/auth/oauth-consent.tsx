"use client";
import { useEffect, useState, useRef } from "react";
import type { OAuthAuthorizationDetails } from "@supabase/supabase-js";
import { getBrowserSupabase, useAuth } from "@/lib/auth";

import { createConsentRequest } from '@/lib/oauth-consent-request';

export function OAuthConsent({
  clientIds,
  redirects,
}: {
  clientIds: string[];
  redirects: string[];
}) {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const requestDetails = useRef(createConsentRequest((id: string) => getBrowserSupabase().auth.oauth.getAuthorizationDetails(id)));
  const [details, setDetails] = useState<OAuthAuthorizationDetails | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  function redirect(url: string) {
    const target = new URL(url);
    if (target.hash || !redirects.includes(target.origin + target.pathname))
      throw new Error("Unrecognized extension callback");
    location.replace(target.href);
  }
  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn || !userId) { setError('Sign in to authorize this extension'); return; }
    let active = true;
    const id = new URL(location.href).searchParams.get("authorization_id");
    if (!id || id.length > 256) {
      setError("Invalid authorization request");
      return;
    }
    void requestDetails.current(id, userId)
      .then(({ data, error }) => {
        if (!active) return;
        if (error || !data) throw new Error("Authorization request expired or unavailable");
        if ("redirect_url" in data) {
          redirect(data.redirect_url);
          return;
        }
        if (
          !clientIds.includes(data.client.id) ||
          !redirects.includes(data.redirect_uri) ||
          data.scope.split(" ").some((scope) => !["openid", "email", "profile"].includes(scope))
        )
          throw new Error("This client is not authorized");
        setDetails(data);
      })
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [clientIds, redirects, isLoaded, isSignedIn, userId]);
  async function decide(approve: boolean) {
    if (!details || busy) return;
    setBusy(true);
    setError("");
    try {
      const method = approve ? "approveAuthorization" : "denyAuthorization";
      const { data, error } = await getBrowserSupabase().auth.oauth[method](
        details.authorization_id,
        { skipBrowserRedirect: true },
      );
      if (error || !data) throw new Error("Could not complete authorization. Try again.");
      redirect(data.redirect_url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Authorization failed");
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 px-6 py-16">
      <h1 className="text-2xl font-semibold">Connect your extension</h1>
      {error && <p role="alert">{error}</p>}
      {details ? (
        <>
          <p>
            {details.client.name} wants to save bookmarks and sessions, synchronize browser
            bookmarks, and share Live tabs using your account. Its Live switch can enable sharing
            for your account or turn it off and clear all shared device snapshots.
          </p>
          <p className="text-sm text-muted-foreground">
            Signed in as {details.user.email}. This extension receives a separate session. You can
            revoke it in account settings.
          </p>
          <div className="flex gap-3">
            <button
              disabled={busy}
              onClick={() => void decide(true)}
              className="rounded bg-primary px-4 py-2 text-primary-foreground"
            >
              Authorize extension
            </button>
            <button
              disabled={busy}
              onClick={() => void decide(false)}
              className="rounded border px-4 py-2"
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        !error && <p>Loading authorization request…</p>
      )}
    </main>
  );
}
