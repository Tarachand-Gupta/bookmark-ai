"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { Session, SupabaseClient, User } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useState } from "react";
import { safeAuthDestination, profileName } from "./auth-policy";
import { webSessionMetadata } from "./web-session-metadata";
let client: SupabaseClient | undefined;
let refresh: Promise<string | null> | null = null;
export function getBrowserSupabase(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) throw new Error("Authentication is not configured.");
    client = createBrowserClient(url, key, {
      auth: { flowType: "pkce", detectSessionInUrl: false },
      cookieOptions: { name: "bmai-supabase-qa-auth" },
    });
  }
  return client;
}
export async function getAccessToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error("Authentication is temporarily unavailable. Try again.");
  if (!data.session) return null;
  if (data.session.expires_at && data.session.expires_at <= Date.now() / 1000 + 30) {
    refresh ??= supabase.auth
      .refreshSession()
      .then(({ data, error }) => {
        if (error) throw new Error("Authentication could not be refreshed. Try again.");
        return data.session?.access_token ?? null;
      })
      .finally(() => {
        refresh = null;
      });
    return refresh;
  }
  return data.session.access_token;
}
type AuthState = { session: Session | null; isLoaded: boolean; error: string | null };
const Context = createContext<AuthState>({ session: null, isLoaded: false, error: null });
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, isLoaded: false, error: null });
  useEffect(() => {
    let active = true;
    let observed = false;
    try {
      const sb = getBrowserSupabase();
      const { data: subscription } = sb.auth.onAuthStateChange((_event, session) => {
        observed = true;
        if (active) setState({ session, isLoaded: true, error: null });
      });
      void sb.auth
        .getSession()
        .then(({ data, error }) => {
          if (active && !observed)
            setState({
              session: data.session,
              isLoaded: true,
              error: error ? "Authentication is temporarily unavailable." : null,
            });
        })
        .catch(() => {
          if (active)
            setState((s) => ({
              ...s,
              isLoaded: true,
              error: "Authentication is temporarily unavailable.",
            }));
        });
      return () => {
        active = false;
        subscription.subscription.unsubscribe();
      };
    } catch {
      setState((s) => ({ ...s, isLoaded: true, error: "Authentication is not configured." }));
    }
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    async function rejected() {
      try {
        const token = await getAccessToken();
        if (!token) return;
        const { error } = await getBrowserSupabase().auth.getUser(token);
        if (error && (error.status === 401 || error.status === 403)) {
          await getBrowserSupabase().auth.signOut({ scope: "local" });
          if (window.location.pathname.startsWith("/app")) window.location.assign("/sign-in");
        }
      } catch {
        /* outage is not a sign-out */
      }
    }
    window.addEventListener("bookmark-auth-rejected", rejected);
    return () => window.removeEventListener("bookmark-auth-rejected", rejected);
  }, []);
  useEffect(() => {
    if (!state.session) return;
    const controller = new AbortController();
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone;
    void getAccessToken()
      .then((token) =>
        fetch("/api/auth/sessions/current", {
          method: "POST",
          signal: controller.signal,
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify(webSessionMetadata(Boolean(standalone))),
        }),
      )
      .catch(() => undefined);
    return () => controller.abort();
  }, [state.session?.user.id]);
  return (
    <Context.Provider value={state}>
      <div key={state.session?.user.id ?? "signed-out"} className="contents">
        {children}
      </div>
    </Context.Provider>
  );
}
export function useAuth() {
  const state = useContext(Context);
  return {
    ...state,
    userId: state.session?.user.id ?? null,
    isSignedIn: !!state.session,
    getToken: getAccessToken,
  };
}
export function useUser() {
  const state = useContext(Context);
  const raw: User | undefined = state.session?.user;
  const name = profileName(raw?.user_metadata);
  const image =
    typeof raw?.user_metadata?.avatar_url === "string" &&
    /^https:\/\//.test(raw.user_metadata.avatar_url)
      ? raw.user_metadata.avatar_url
      : null;
  const user = raw
    ? {
        id: raw.id,
        username: name,
        fullName: name,
        firstName: name.split(" ")[0],
        lastName: name.split(" ").slice(1).join(" "),
        primaryEmailAddress: { emailAddress: raw.email ?? "" },
        emailAddresses: [{ emailAddress: raw.email ?? "" }],
        hasImage: !!image,
        imageUrl: image ?? "",
      }
    : null;
  return { isLoaded: state.isLoaded, isSignedIn: !!raw, user };
}
export async function signOut(
  options: { redirectUrl?: string; scope?: "local" | "others" | "global" } = {},
) {
  const token = await getAccessToken();
  if (token) {
    const response = await fetch("/api/auth/sessions/sign-out", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ scope: options.scope ?? "local" }),
    });
    if (!response.ok) throw new Error("Could not sign out. Try again.");
  }
  if (options.scope !== "others") {
    await getBrowserSupabase().auth.signOut({ scope: "local" });
    window.location.assign(safeAuthDestination(options.redirectUrl, "/sign-in"));
  }
}
export function useAccountAuth() {
  return { signOut };
}
