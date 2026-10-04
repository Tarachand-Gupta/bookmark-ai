import type { Session, SupabaseClient } from "@supabase/supabase-js";

export type EmailMode = "signIn" | "signUp" | "reset";
type EmailAuth = Pick<SupabaseClient["auth"], "signInWithPassword" | "signUp" | "signInWithOtp" | "resend" | "resetPasswordForEmail" | "verifyOtp" | "updateUser" | "getSession" | "signOut">;
export type EmailStep = { phase: "complete" } | { phase: "code"; mode: EmailMode; notice?: string };
export const validEmailCode = (code: string) => /^\d{6,10}$/.test(code.trim());

/** Supabase deliberately does not reveal whether an invalid password belongs to an existing email. */
export function createEmailAuthFlow(auth: EmailAuth, redirectTo: string, adopt: (session: Session, current: () => boolean) => Promise<void>) {
  let epoch = 0, transferred = false, adopting = false;
  let pending: { email: string; mode: EmailMode } | null = null;
  let recoverySession: Session | null = null;
  let cleanup: Promise<unknown> = Promise.resolve();
  const revoke = async () => {
    const stored = await auth.getSession();
    if (stored.data.session && !transferred) {
      const result = await auth.signOut({ scope: "local" });
      if (result.error) throw result.error;
    }
  };
  const reset = () => {
    epoch++; pending = null; recoverySession = null;
    cleanup = cleanup.catch(() => undefined).then(revoke);
    return cleanup;
  };
  const check = async (started: number) => {
    if (started !== epoch) { await revoke(); throw new Error("That sign-in was canceled. Start again."); }
  };
  const complete = async (session: Session | null, started: number): Promise<EmailStep> => {
    if (!session) throw new Error("Couldn't finish sign-in. Try again.");
    await check(started);
    adopting = true;
    try { await adopt(session, () => started === epoch); transferred = true; return { phase: "complete" }; }
    catch (failure) { await revoke(); throw failure; }
    finally { adopting = false; }
  };
  const begin = async () => { await reset(); transferred = false; return epoch; };
  return {
    reset,
    // Successful SDK publication unmounts this screen; it must retain the adopted session.
    dispose() { if (!adopting && !transferred) void reset().catch(() => undefined); },
    async password(email: string, password: string): Promise<EmailStep> {
      const started = await begin(); email = email.trim();
      const signed = await auth.signInWithPassword({ email, password });
      await check(started);
      if (!signed.error) return complete(signed.data.session, started);
      if (signed.error.code === "email_not_confirmed") {
        const sent = await auth.resend({ type: "signup", email, options: { emailRedirectTo: redirectTo } });
        await check(started); if (sent.error) throw sent.error;
        pending = { email, mode: "signUp" };
        return { phase: "code", mode: "signUp", notice: `We emailed you a code to finish signing in — sent to ${email}` };
      }
      if (signed.error.code !== "invalid_credentials") throw signed.error;
      if (password.length < 8) throw new Error("Check your email and password. New passwords must be at least 8 characters.");
      // Existing-account signup stays obfuscated by the provider; never enumerate accounts.
      const created = await auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } });
      await check(started); if (created.error) throw created.error;
      if (created.data.session) return complete(created.data.session, started);
      if (created.data.user?.identities?.length === 0) throw new Error("Check your email and password, or use the email code option.");
      pending = { email, mode: "signUp" };
      return { phase: "code", mode: "signUp" };
    },
    async code(email: string): Promise<EmailStep> {
      const started = await begin(); email = email.trim();
      const result = await auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: redirectTo } });
      await check(started); if (result.error) throw result.error;
      pending = { email, mode: "signIn" }; return { phase: "code", mode: "signIn" };
    },
    async recovery(email: string): Promise<EmailStep> {
      const started = await begin(); email = email.trim();
      const result = await auth.resetPasswordForEmail(email, { redirectTo });
      await check(started); if (result.error) throw result.error;
      pending = { email, mode: "reset" }; return { phase: "code", mode: "reset" };
    },
    async verify(email: string, mode: EmailMode, code: string, password: string): Promise<EmailStep> {
      const started = epoch;
      if (!pending || pending.email !== email.trim() || pending.mode !== mode) throw new Error("Your sign-in expired. Enter your email again to restart.");
      if (!validEmailCode(code)) throw new Error("Enter the full code from your email.");
      if (mode === "reset" && password.length < 8) throw new Error("New password must be at least 8 characters.");
      let session = recoverySession;
      if (!session) {
        const result = await auth.verifyOtp({ email: pending.email, token: code.trim(), type: mode === "reset" ? "recovery" : "email" });
        await check(started); if (result.error) throw result.error;
        session = result.data.session;
        if (!session || session.user.email?.toLowerCase() !== pending.email.toLowerCase()) { await revoke(); throw new Error("Invalid sign-in identity"); }
        if (mode === "reset") recoverySession = session;
      }
      if (mode === "reset") {
        const updated = await auth.updateUser({ password });
        await check(started); if (updated.error) throw updated.error;
        const current = await auth.getSession();
        await check(started); if (current.error) throw current.error;
        session = current.data.session;
      }
      return complete(session, started);
    },
  };
}
