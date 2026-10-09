export type AccountStatus = "checking" | "ok" | "provisioning" | "setup-error" | "forbidden";

/** Only an observed successful API response or its persisted marker admits the shell. */
export function accountProbeFailure(kind: "forbidden" | "provisioning" | "unavailable", previouslyReady: boolean, sawProvisioning: boolean, expired: boolean): AccountStatus {
  if (kind === "forbidden") return "forbidden";
  if (kind === "provisioning" || sawProvisioning) return expired ? "setup-error" : "provisioning";
  return previouslyReady ? "ok" : "setup-error";
}
