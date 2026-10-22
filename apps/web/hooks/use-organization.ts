"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { applyOrganizationOperation, getOrganization, getOrganizationOperation, type OrganizationOperation, type OrganizationOperationInput, type OrganizationResponse } from "@/lib/api";

export function useOrganization(refreshKey = 0) {
  const [data, setData] = useState<OrganizationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(n => n + 1), []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true);
    void getOrganization(controller.signal).then(value => { if (!controller.signal.aborted) { setData(value); setError(null); } }).catch(err => { if (!controller.signal.aborted) setError(err.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refreshKey, revision]);
  return { data, error, loading, refresh, supported: data?.capabilities.organization === 1 };
}

/** A timed-out write is unknown, so reconcile its durable identity before a
 * retry. The original input remains frozen; retry never invents a new ID. */
import { useAuth } from "@/lib/auth";
import { runOrganizationRequest } from "@/lib/organization-requests";

export function useOrganizationMutation(onResult: (operation: OrganizationOperation) => void) {
  const { userId } = useAuth();
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState<OrganizationOperationInput | null>(null);
  const run = async (input: OrganizationOperationInput) => {
    if (running.current || !userId) return;
    running.current = true; setBusy(true); setError(null);
    try {
      const operation = await runOrganizationRequest(userId, { kind: "organization", input });
      setUncertain(null); onResult(operation);
    } catch (err) {
      setUncertain(input); setError((err as Error).message);
    } finally { running.current = false; setBusy(false); }
  };
  return { busy, error, uncertain, run, reset: () => { setUncertain(null); setError(null); }, retry: () => uncertain && void run(uncertain) };
}
