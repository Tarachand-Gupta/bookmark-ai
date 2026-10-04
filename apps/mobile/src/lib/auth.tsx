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
import { getApiUrl, registerAuthSession, signOutAuthSessions, resetAccountApiState, resetLiveBaseCache, setAuthTokenProvider, setUnauthorizedHandler, setMfaRequiredHandler } from "../api";
import { AUTH_CALLBACK_URL, AUTH_NAMESPACE, SUPABASE_PUBLIC_KEY, SUPABASE_URL } from "./auth-config";
import { displayLabel, nativeAppleExchange, nativeCallback, type NativeFlow, type PendingNativeFlow } from "./auth-policy";
import { createSecureSessionStorage } from "./secure-session-storage";
import { adoptHostedSession, createHostedCallbackFlight } from "./hosted-session";
import { hostedCallback, hostedSignInURL, type HostedAttempt } from "./hosted-auth-policy";
import { createMfaVerificationGuard, createSessionAssuranceGate } from "./session-assurance";

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
const assuranceGate = createSessionAssuranceGate(async (token) => {
  // Passing the JWT fetches current provider factors instead of stale user metadata.
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel(token);
  if (error || !data) throw new Error("Sign-in verification is temporarily unavailable.");
  return data;
});

export async function getToken(): Promise<string | null> {
  if (protectedRequestsBlocked) throw new Error("This sign-in has ended. Sign in again.");
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error("Sign-in is temporarily unavailable. Please retry when connected.");
  if (!data.session) return null;
  await assuranceGate.check(data.session);
  if (protectedRequestsBlocked) throw new Error("This sign-in has ended. Sign in again.");
  if (!assuranceGate.allowed(data.session)) throw new Error("Complete sign-in verification before opening your library.");
  return data.session.access_token;
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
  if(new URL(url).searchParams.has("flow"))return completeHostedCallback(url);
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

const hostedPendingKey = `${AUTH_NAMESPACE}:hosted-attempt`;
let hostedEpoch = 0;
const runHostedCallback = createHostedCallbackFlight();
let hostedCompletedFlow: string | null = null;
let hostedCompletedCallback: string | null = null;
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function hostedRequest(action: string, body: unknown) {
  const response = await fetch(`${getApiUrl()}/api/auth/native/${action}`, { method: "POST", credentials: "omit", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("Sign-in could not complete. Return to the app and try again.");
  return response.json();
}
export async function cancelHostedSignIn() {
  hostedEpoch++;
  const raw = await sessionStorage.getItem(hostedPendingKey);
  await sessionStorage.removeItem(hostedPendingKey);
  if(raw) { const attempt=JSON.parse(raw) as HostedAttempt; await hostedRequest("cancel", {flowId:attempt.flowId,verifier:attempt.verifier}).catch(()=>undefined); }
}
async function completeHostedCallback(url:string):Promise<void> {
  if(url===hostedCompletedCallback)return;
  return runHostedCallback(async()=>{
    const epoch=hostedEpoch;
    const raw=await sessionStorage.getItem(hostedPendingKey);
    const attempt=hostedCallback(url,AUTH_CALLBACK_URL,raw?JSON.parse(raw):null);
    const result=await hostedRequest("exchange",{flowId:attempt.flowId,verifier:attempt.verifier,completionCode:attempt.completionCode});
    if(result.status!=="complete"||!result.session)throw new Error("Sign-in has not finished. Try again.");
    const payload=result.session;
    const revoke=()=>fetch(`${SUPABASE_URL}/auth/v1/logout?scope=local`,{method:"POST",headers:{apikey:SUPABASE_PUBLIC_KEY!,authorization:`Bearer ${payload.access_token}`},credentials:"omit"}).catch(()=>undefined);
    await adoptHostedSession(supabase.auth,payload,`${SUPABASE_URL}/auth/v1`,()=>epoch===hostedEpoch,revoke,()=>sessionStorage.removeItem(hostedPendingKey));
    hostedCompletedFlow=attempt.flowId;hostedCompletedCallback=url;
    // Mail/Safari can deliver Linking before ASWebAuthenticationSession finishes.
    if(Platform.OS==="ios"&&browserOpen){try{WebBrowser.dismissAuthSession();}catch{}}
  });
}
export async function signInInBrowser():Promise<void> {
  if(browserOpen)throw new Error("A sign-in attempt is already open");
  browserOpen=true;
  try {
    await cancelHostedSignIn();
    hostedCompletedFlow=null;hostedCompletedCallback=null;
    const verifier=base64url(await Crypto.getRandomBytesAsync(32));
    const state=base64url(await Crypto.getRandomBytesAsync(32));
    const challenge=(await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,verifier,{encoding:Crypto.CryptoEncoding.BASE64})).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
    const result=await hostedRequest("start",{clientType:Platform.OS,codeChallenge:challenge,state});
    if(result.state!==state||!Number.isFinite(result.expiresAt)||result.expiresAt<=Date.now()||result.expiresAt>Date.now()+5*60_000)throw new Error("Invalid sign-in response");
    const attempt:HostedAttempt={flowId:result.flowId,state,verifier,expiresAt:result.expiresAt};
    const url=hostedSignInURL(result.browserUrl,getApiUrl(),attempt.flowId);
    await sessionStorage.setItem(hostedPendingKey,JSON.stringify(attempt));
    const outcome=await WebBrowser.openAuthSessionAsync(url,AUTH_CALLBACK_URL);
    if(outcome.type==="success")await completeHostedCallback(outcome.url);
    else if(hostedCompletedFlow!==attempt.flowId){
      // A Linking delivery may already be adopting the session when the browser dismisses.
      await runHostedCallback(async()=>undefined);
      if(hostedCompletedFlow!==attempt.flowId)await cancelHostedSignIn();
    }
  } catch(error){if(!hostedCompletedFlow){await cancelHostedSignIn();throw error;}}
  finally {browserOpen=false;}
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
  mfaStatus: ReturnType<typeof assuranceGate.getState>["status"];
  retryMFA(): void; verifyMFA(factorId: string, code: string): Promise<void>; cancelMFA(): Promise<void>;
}
const AuthContext = createContext<AuthState | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoaded, setLoaded] = useState(false), [error, setError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState(false), [attempt, setAttempt] = useState(0);
  const [revoked, setRevoked] = useState(false);
  const [assurance, setAssurance] = useState(assuranceGate.getState);
  const [assuranceAttempt, setAssuranceAttempt] = useState(0);
  const invalidated = useRef(false);
  const previousUser = useRef<string | null>(null);
  const observedSession = useRef<Session | null>(null);
  const authEpoch = useRef(0);
  const verification = useRef(createMfaVerificationGuard());
  const signOut = useCallback(async (scope: "local" | "global" | "others" = "local") => {
    if (scope !== "others") await cancelHostedSignIn();
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
        if (mounted && authEpoch.current === epoch) { observedSession.current = data.session; assuranceGate.observe(data.session); setSession(data.session); setError(null); }
      } catch { if (mounted && authEpoch.current === epoch) setError("Sign-in couldn't be restored. Unlock this device and check your connection, then retry."); }
      finally { if (mounted) setLoaded(true); }
    };
    const { data: listener } = supabase.auth.onAuthStateChange((event, next) => {
      if (!mounted) return;
      authEpoch.current++;
      if (!verification.current.observe(event, next?.user.id ?? null)) {
        // The SDK already persisted this late verify response. Never admit it;
        // remove that stale session asynchronously outside the SDK callback.
        protectedRequestsBlocked = true; invalidated.current = true; setRevoked(true); resetAccountApiState();
        observedSession.current = null; assuranceGate.observe(null); setSession(null);
        void Promise.resolve().then(() => supabase.auth.signOut({ scope: "local" })).catch(() => undefined);
        return;
      }
      // Keep callbacks synchronous; never reenter refresh from TOKEN_REFRESHED.
      if (previousUser.current !== (next?.user.id ?? null)) {
        resetAccountApiState();
        if (previousUser.current) void clearAccountCaches(previousUser.current);
      }
      previousUser.current = next?.user.id ?? null;
      observedSession.current = next;
      assuranceGate.observe(next, event === "USER_UPDATED");
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
      verification.current.invalidate();
      invalidated.current = true; protectedRequestsBlocked = true; resetAccountApiState(); setRevoked(true);
      void clearAccountCaches();
      // A definitive protected-request401 hides private views immediately.
      // The SDK alone removes its session; a temporary sign-out failure keeps
      // encrypted credentials available for its eventual server retry.
      void supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    });
    setMfaRequiredHandler(() => {
      assuranceGate.observe(observedSession.current, true);
      resetAccountApiState();
      setAssuranceAttempt((value) => value + 1);
    });
    const callback = (url: string | null) => {
      if (!url || !url.startsWith(AUTH_CALLBACK_URL) || (browserOpen && !new URL(url).searchParams.has("flow"))) return;
      void completeNativeCallback(url).catch(() => { if (mounted) Alert.alert("Couldn't complete sign-in", "The sign-in link expired or couldn't complete. Start a new sign-in attempt."); });
    };
    void Linking.getInitialURL().then(callback);
    const links = Linking.addEventListener("url", ({ url }) => callback(url));
    return () => { mounted = false; listener.subscription.unsubscribe(); state.remove(); links.remove(); supabase.auth.stopAutoRefresh(); setUnauthorizedHandler(null); setMfaRequiredHandler(null); };
  }, [attempt, signOut]);
  useEffect(() => assuranceGate.subscribe(setAssurance), []);
  useEffect(() => { if (session && !revoked) void assuranceGate.check(session); }, [session, revoked, assuranceAttempt]);
  const retryMFA = () => { assuranceGate.observe(session, true); setAssuranceAttempt((value) => value + 1); };
  const verifyMFA = async (factorId: string, code: string) => {
    const original = session;
    if (!original || assuranceGate.getState().token !== original.access_token) throw new Error("This sign-in changed. Retry verification.");
    const ticket = verification.current.begin(original.user.id);
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
      if (!ticket.valid) throw new Error("This sign-in changed. Start sign-in again.");
      if (error) throw new Error(error.message);
      // SDK emits MFA_CHALLENGE_VERIFIED; the guarded observer owns admission.
    } finally { verification.current.finish(ticket); }
  };
  const cancelMFA = async () => {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) throw new Error("Reconnect to cancel this sign-in, then try again.");
    await clearAccountCaches(); await sessionStorage.removeItem(pendingKey); setRecovery(false);
  };
  const admitted = !!session && !revoked && assurance.token === session.access_token && assurance.userId === session.user.id && assurance.status === "ready";
  useEffect(() => {
    if (!session || !admitted) return;
    const label = displayLabel(Device.modelName ?? (Platform.OS === "ios" ? Platform.isPad ? "iPad" : "iPhone" : "Android"), "Mobile device");
    void registerAuthSession({ clientType: Platform.OS === "ios" ? "ios" : "android", deviceName: label, os: `${Platform.OS} ${Device.osVersion ?? Platform.Version}`, appVersion: Application.nativeApplicationVersion ?? undefined }).catch(() => undefined);
  }, [session?.access_token, admitted]);
  return <AuthContext.Provider value={{ session: admitted ? session : null, isLoaded, isSignedIn: admitted, userId: admitted ? session.user.id : null, user: admitted ? session.user : null, getToken, recovery, finishRecovery: () => setRecovery(false), error, retry: () => setAttempt((value) => value + 1), signOut, mfaStatus: revoked ? "signed-out" : session && assurance.token !== session.access_token ? "checking" : assurance.status, retryMFA, verifyMFA, cancelMFA }}>{children}</AuthContext.Provider>;
}
export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider is missing");
  return value;
}
