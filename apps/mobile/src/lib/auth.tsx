import "react-native-url-polyfill/auto";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, AppState, Linking, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Apple from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import * as Device from "expo-device";
import * as Application from "expo-application";
import { createClient, type Session } from "@supabase/supabase-js";
import { registerAuthSession, signOutAuthSessions, resetAccountApiState, resetLiveBaseCache, setAuthTokenProvider, setUnauthorizedHandler } from "../api";
import { AUTH_CALLBACK_URL, AUTH_NAMESPACE, SUPABASE_PUBLIC_KEY, SUPABASE_URL } from "./auth-config";
import { displayLabel, nativeAppleExchange, nativeCallback, type NativeFlow, type PendingNativeFlow } from "./auth-policy";
import { createSecureSessionStorage } from "./secure-session-storage";

if (!SUPABASE_URL || !SUPABASE_PUBLIC_KEY) throw new Error("Supabase mobile public configuration is required");
const secureOptions = { keychainService: AUTH_NAMESPACE, keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
export const sessionStorage = createSecureSessionStorage({
  getItem: (key) => SecureStore.getItemAsync(key, secureOptions),
  setItem: (key, value) => SecureStore.setItemAsync(key, value, secureOptions),
  removeItem: (key) => SecureStore.deleteItemAsync(key, secureOptions),
}, AUTH_NAMESPACE, Crypto.randomUUID);
export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
  // SDK2.117 owns refresh single-flight and the refresh-vs-signout commit guard.
  auth: { storage: sessionStorage, storageKey: `${AUTH_NAMESPACE}:session`, flowType: "pkce", autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
});
WebBrowser.maybeCompleteAuthSession();
let protectedRequestsBlocked = false;

export async function getToken(): Promise<string | null> {
  if (protectedRequestsBlocked) throw new Error("This sign-in has ended. Sign in again.");
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error("Sign-in is temporarily unavailable. Please retry when connected.");
  return data.session?.access_token ?? null;
}
setAuthTokenProvider(getToken);

export async function clearAccountCaches(userId?: string): Promise<void> {
  resetLiveBaseCache();
  const prefix = `${AUTH_NAMESPACE}:account:${userId ? `${userId}:` : ""}`;
  const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(prefix));
  if (keys.length) await AsyncStorage.multiRemove(keys);
}

const pendingKey = `${AUTH_NAMESPACE}:oauth-attempt`;
export async function beginNativeFlow(flow: NativeFlow): Promise<string> {
  const pending: PendingNativeFlow = { state: Crypto.randomUUID(), createdAt: Date.now(), flow };
  await sessionStorage.setItem(pendingKey, JSON.stringify(pending));
  const redirect = new URL(AUTH_CALLBACK_URL);
  redirect.searchParams.set("bmai_state", pending.state);
  return redirect.toString();
}

let callbackFlight: { code: string; result: Promise<void> } | null = null;
let browserOpen = false;
export async function completeNativeCallback(url: string): Promise<void> {
  const raw = await sessionStorage.getItem(pendingKey);
  const pending = raw ? JSON.parse(raw) as PendingNativeFlow : null;
  const code = nativeCallback(url, AUTH_CALLBACK_URL, pending, Date.now());
  if (callbackFlight?.code === code) return callbackFlight.result;
  const result = (async () => {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw new Error(error.message);
    await sessionStorage.removeItem(pendingKey);
  })();
  callbackFlight = { code, result };
  try { await result; } finally { if (callbackFlight?.result === result) callbackFlight = null; }
}

export async function signInWithGoogle(): Promise<void> {
  if (browserOpen) throw new Error("A sign-in attempt is already open");
  browserOpen = true;
  try {
    const redirectTo = await beginNativeFlow("google");
    const { data, error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo, skipBrowserRedirect: true } });
    if (error) throw error;
    if (!data.url || new URL(data.url).origin !== new URL(SUPABASE_URL!).origin) throw new Error("Unexpected sign-in provider URL");
    const result = await WebBrowser.openAuthSessionAsync(data.url, AUTH_CALLBACK_URL);
    if (result.type === "success") await completeNativeCallback(result.url);
    else await sessionStorage.removeItem(pendingKey);
  } finally { browserOpen = false; }
}

export async function signInWithApple(): Promise<void> {
  if (Platform.OS !== "ios" || !(await Apple.isAvailableAsync())) throw new Error("Apple Authentication is not available on this device");
  await nativeAppleExchange({
    nonce: Crypto.randomUUID(), state: Crypto.randomUUID(),
    hash: (nonce) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce),
    signIn: (request) => Apple.signInAsync({ ...request, requestedScopes: [Apple.AppleAuthenticationScope.FULL_NAME, Apple.AppleAuthenticationScope.EMAIL] }),
    exchange: async (token, nonce) => {
      const { error } = await supabase.auth.signInWithIdToken({ provider: "apple", token, nonce });
      if (error) throw error;
    },
    saveName: async (name) => {
      const { error } = await supabase.auth.updateUser({ data: { full_name: name } });
      if (error) throw error;
    },
  });
}

interface AuthState {
  session: Session | null; isLoaded: boolean; isSignedIn: boolean; userId: string | null;
  user: Session["user"] | null; getToken: typeof getToken;
  recovery: boolean; finishRecovery(): void;
  error: string | null; retry(): void;
  signOut(scope?: "local" | "global" | "others"): Promise<void>;
}
const AuthContext = createContext<AuthState | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoaded, setLoaded] = useState(false), [error, setError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState(false), [attempt, setAttempt] = useState(0);
  const [revoked, setRevoked] = useState(false);
  const invalidated = useRef(false);
  const previousUser = useRef<string | null>(null);
  const authEpoch = useRef(0);
  const signOut = useCallback(async (scope: "local" | "global" | "others" = "local") => {
    await signOutAuthSessions(scope);
    if (scope !== "others") {
      const { error: failure } = await supabase.auth.signOut({ scope: "local" });
      if (failure) throw new Error("Couldn't finish sign-out on this device. Please retry.");
    }
    if (scope !== "others") { await clearAccountCaches(); await sessionStorage.removeItem(pendingKey); setRecovery(false); }
  }, []);
  useEffect(() => {
    let mounted = true;
    const initialize = async () => {
      const epoch = authEpoch.current;
      try {
        const { data, error: failure } = await supabase.auth.getSession();
        if (failure) throw failure;
        if (mounted && authEpoch.current === epoch) { setSession(data.session); setError(null); }
      } catch { if (mounted && authEpoch.current === epoch) setError("Sign-in couldn't be restored. Unlock this device and check your connection, then retry."); }
      finally { if (mounted) setLoaded(true); }
    };
    const { data: listener } = supabase.auth.onAuthStateChange((event, next) => {
      if (!mounted) return;
      authEpoch.current++;
      // Keep callbacks synchronous; never reenter refresh from TOKEN_REFRESHED.
      if (previousUser.current !== (next?.user.id ?? null)) {
        resetAccountApiState();
        if (previousUser.current) void clearAccountCaches(previousUser.current);
      }
      previousUser.current = next?.user.id ?? null;
      setSession(next); setLoaded(true);
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") { invalidated.current = false; protectedRequestsBlocked = false; setRevoked(false); }
      if (next) setError(null);
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      if (event === "SIGNED_OUT") { setRecovery(false); void clearAccountCaches(); }
    });
    const active = () => {
      if (AppState.currentState === "active") { supabase.auth.startAutoRefresh(); void initialize(); }
      else { supabase.auth.stopAutoRefresh(); if (!isLoaded) void initialize(); }
    };
    active();
    const state = AppState.addEventListener("change", active);
    setUnauthorizedHandler(() => {
      if (invalidated.current) return;
      invalidated.current = true; protectedRequestsBlocked = true; resetAccountApiState(); setRevoked(true);
      void clearAccountCaches();
      // A definitive protected-request401 hides private views immediately.
      // The SDK alone removes its session; a temporary sign-out failure keeps
      // encrypted credentials available for its eventual server retry.
      void supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    });
    const callback = (url: string | null) => {
      if (!url || browserOpen || !url.startsWith(AUTH_CALLBACK_URL)) return;
      void completeNativeCallback(url).catch(() => { if (mounted) Alert.alert("Couldn't complete sign-in", "The sign-in link expired or couldn't complete. Start a new sign-in attempt."); });
    };
    void Linking.getInitialURL().then(callback);
    const links = Linking.addEventListener("url", ({ url }) => callback(url));
    return () => { mounted = false; listener.subscription.unsubscribe(); state.remove(); links.remove(); supabase.auth.stopAutoRefresh(); setUnauthorizedHandler(null); };
  }, [attempt, signOut]);
  useEffect(() => {
    if (!session) return;
    const label = displayLabel(Device.modelName ?? (Platform.OS === "ios" ? Platform.isPad ? "iPad" : "iPhone" : "Android"), "Mobile device");
    void registerAuthSession({ clientType: Platform.OS === "ios" ? "ios" : "android", deviceName: label, os: `${Platform.OS} ${Device.osVersion ?? Platform.Version}`, appVersion: Application.nativeApplicationVersion ?? undefined }).catch(() => undefined);
  }, [session?.access_token]);
  return <AuthContext.Provider value={{ session: revoked ? null : session, isLoaded, isSignedIn: !!session && !revoked, userId: revoked ? null : session?.user.id ?? null, user: revoked ? null : session?.user ?? null, getToken, recovery, finishRecovery: () => setRecovery(false), error, retry: () => setAttempt((value) => value + 1), signOut }}>{children}</AuthContext.Provider>;
}
export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider is missing");
  return value;
}
