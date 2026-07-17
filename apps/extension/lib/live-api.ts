import type { PushLiveStateInput, UpdateLiveSettingsInput } from "@bookmark-ai/types";
import { authHeaders, getApiBaseUrl } from "./api";

/**
 * The Live Sessions endpoints the extension consumes (§4.3). Unlike the one-shot
 * save helpers in ./api, these never throw: the checkpoint loop must fail silently
 * and back off (§4.5), so every call resolves to a small outcome the caller
 * branches on. Auth reuses the background's Clerk token provider via ./api's
 * `authHeaders` — the popup has no provider set, so these run in the background.
 */

export type PushOutcome =
  | { ok: true }
  | { ok: false; disabled: boolean }; // disabled = server 403, the account flag is off (§5.2)

/** POST /api/live. 200 → ok; 403 → the account flag is off, stop publishing;
 * anything else (401 signed-out, 429 quota, 5xx, network) → transient, back off. */
export async function pushLiveState(body: PushLiveStateInput): Promise<PushOutcome> {
  const base = await getApiBaseUrl();
  let res: Response;
  try {
    res = await fetch(`${base}/api/live`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, disabled: false }; // offline / unreachable — transient
  }
  if (res.ok) return { ok: true };
  return { ok: false, disabled: res.status === 403 };
}

/** POST /api/live/settings — the account-wide opt-in flag. Off purges every device
 * server-side (§5.7). Returns whether the write reached the server. */
export async function updateLiveSettings(body: UpdateLiveSettingsInput): Promise<boolean> {
  const base = await getApiBaseUrl();
  try {
    const res = await fetch(`${base}/api/live/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** DELETE /api/live/:deviceId — forget this device's mirror. Best-effort: the row
 * TTLs out regardless (§5.7), so a failure here is swallowed. */
export async function deleteLiveDevice(deviceId: string): Promise<void> {
  const base = await getApiBaseUrl();
  try {
    await fetch(`${base}/api/live/${encodeURIComponent(deviceId)}`, {
      method: "DELETE",
      headers: { ...(await authHeaders()) },
    });
  } catch {
    // swallow — teardown is best-effort
  }
}
