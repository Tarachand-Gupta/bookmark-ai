/** Client presentation gate only; every protected backend request independently authenticates. */
export interface AssuranceSession { access_token: string; user: { id: string } }
export type AssuranceStatus = "signed-out" | "checking" | "ready" | "required" | "unavailable";
export interface AssuranceState { status: AssuranceStatus; token: string | null; userId: string | null }
export function createSessionAssuranceGate(inspect: (token: string) => Promise<{ currentLevel: string | null; nextLevel: string | null }>) {
  let state: AssuranceState = { status: "signed-out", token: null, userId: null };
  let revision = 0;
  let flight: { revision: number; result: Promise<AssuranceState> } | null = null;
  const listeners = new Set<(state: AssuranceState) => void>();
  const publish = (next: AssuranceState) => { state = next; for (const listener of listeners) listener(state); };
  const observe = (session: AssuranceSession | null, force = false) => {
    if (!force && state.token === (session?.access_token ?? null) && state.userId === (session?.user.id ?? null)) return;
    revision++;
    publish({ status: session ? "checking" : "signed-out", token: session?.access_token ?? null, userId: session?.user.id ?? null });
  };
  const allowed = (session: AssuranceSession) => state.status === "ready" && state.token === session.access_token && state.userId === session.user.id;
  const check = async (session: AssuranceSession): Promise<AssuranceState> => {
    // Only the SDK event/restore observer can replace the current identity.
    // A delayed caller must never restore an earlier token after signout/switch.
    if (state.token !== session.access_token || state.userId !== session.user.id) return state;
    if (state.status === "ready" || state.status === "required") return state;
    if (flight?.revision === revision) return flight.result;
    const started = revision;
    const result = (async () => {
      let status: AssuranceStatus;
      try {
        const level = await inspect(session.access_token);
        // Missing/unknown claims never admit protected application UI.
        status = level.currentLevel === "aal2" || (level.currentLevel === "aal1" && level.nextLevel === "aal1")
          ? "ready" : level.nextLevel === "aal2" ? "required" : "unavailable";
      } catch { status = "unavailable"; }
      if (revision === started) publish({ status, token: session.access_token, userId: session.user.id });
      return state;
    })();
    flight = { revision: started, result };
    try { return await result; } finally { if (flight?.result === result) flight = null; }
  };
  return {
    observe, check, allowed, getState: () => state,
    subscribe(listener: (state: AssuranceState) => void) { listeners.add(listener); listener(state); return () => { listeners.delete(listener); }; },
  };
}

/** auth-js MFA verify can save a session after a concurrent signout. Guard its event admission. */
export function createMfaVerificationGuard() {
  let pending: { userId: string; valid: boolean } | null = null;
  return {
    begin(userId: string) {
      if (pending) throw new Error("Verification is already running.");
      const ticket = { userId, valid: true }; pending = ticket; return ticket;
    },
    invalidate() { if (pending) pending.valid = false; },
    observe(event: string, userId: string | null) {
      if (event === "MFA_CHALLENGE_VERIFIED") return !!pending?.valid && pending.userId === userId;
      if (event !== "INITIAL_SESSION" && pending) pending.valid = false;
      return true;
    },
    finish(ticket: { userId: string; valid: boolean }) {
      if (pending === ticket) pending = null;
      return ticket.valid;
    },
  };
}
