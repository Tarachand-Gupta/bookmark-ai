"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { recentlyCreatedAccount } from "@/lib/account-readiness";
import { getMeta, ProvisioningError } from "@/lib/api";
import { AccountSetup } from "./account-setup";

/** Mount data consumers only once a real tenant query confirms readiness. */
export function AccountReadiness({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const [state, setState] = useState<"checking" | "provisioning" | "ready" | "error">("checking");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + 60_000;
    setState("checking");
    const check = async () => {
      try {
        await getMeta(controller.signal);
        if (!controller.signal.aborted) { clearTimeout(timeout); setState("ready"); }
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ProvisioningError && Date.now() < deadline) {
          setState("provisioning");
          retry = setTimeout(check, 2_000);
        } else { clearTimeout(timeout); setState("error"); }
      }
    };
    void check();
    // A stalled request has the same actionable end state as repeated 503s.
    const timeout = setTimeout(() => {
      controller.abort();
      clearTimeout(retry);
      setState("error");
    }, 60_000);
    return () => { controller.abort(); clearTimeout(timeout); clearTimeout(retry); };
  }, [attempt]);
  if (state === "ready") return children;
  const displayState = state === "checking" && recentlyCreatedAccount(session?.user.created_at) ? "provisioning" : state;
  return <AccountSetup state={displayState} onRetry={() => setAttempt((value) => value + 1)} />;
}
