import type { PushLiveStateInput, UpdateLiveSettingsInput } from "@bookmark-ai/types";
import { authFetch, getLiveBaseUrl } from "./api";

/**
 * The Live Sessions endpoints the extension consumes (§4.3). Unlike the one-shot
 * save helpers in ./api, these never throw: the checkpoint loop must fail silently
 * and back off (§4.5), so every call resolves to a small outcome the caller
 * branches on. Auth reuses the background's Clerk token provider via ./api's
 * `authHeaders` — the popup has no provider set, so these run in the background.
 */

export type PushOutcome =
  // On success the server echoes this device's new-window policy so we mirror it
  // off the push we already send (absent in the body ⇒ leave the mirror alone).
  | { ok: true; newWindowsShared?: boolean }
  | { ok: false; disabled: boolean }; // disabled = server 403, the account flag is off (§5.2)

/** POST /live (dedicated live server, no /api prefix). 200 → ok; 403 → the
 * account flag is off, stop publishing; anything else (401 signed-out, 429
 * quota, 5xx, network) → transient, back off. On 200 the body carries the
 * per-device `newWindowsShared` policy, surfaced for the caller to mirror. */
export async function pushLiveState(body: PushLiveStateInput): Promise<PushOutcome> {
  const base = await getLiveBaseUrl();
  let res: Response;
  try {
    res = await authFetch(`${base}/live`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, disabled: false }; // offline / unreachable — transient
  }
  if (res.ok) {
    let newWindowsShared: boolean | undefined;
    try {
      const parsed = (await res.json()) as { newWindowsShared?: boolean };
      if (typeof parsed?.newWindowsShared === "boolean") newWindowsShared = parsed.newWindowsShared;
    } catch {
      // Body is optional metadata — a parse failure never fails the push.
    }
    return { ok: true, newWindowsShared };
  }
  return { ok: false, disabled: res.status === 403 };
}

/** POST /live/settings — the account-wide opt-in flag. Off purges every device
 * server-side (§5.7). Returns whether the write reached the server. */
export async function updateLiveSettings(body: UpdateLiveSettingsInput): Promise<boolean> {
  const base = await getLiveBaseUrl();
  try {
    const res = await authFetch(`${base}/live/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** DELETE /live/:deviceId — forget this device's mirror. Best-effort: the row
 * TTLs out regardless (§5.7), so a failure here is swallowed. */
export async function deleteLiveDevice(deviceId: string): Promise<void> {
  const base = await getLiveBaseUrl();
  try {
    await authFetch(`${base}/live/${encodeURIComponent(deviceId)}`, {
      method: "DELETE",
    });
  } catch {
    // swallow — teardown is best-effort
  }
}
