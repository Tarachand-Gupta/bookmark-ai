/** Presentation hint only. Tenant query success remains the readiness authority. */
export function recentlyCreatedAccount(createdAt: string | undefined, now = Date.now()): boolean {
  if (!createdAt) return false;
  const age = now - Date.parse(createdAt);
  return Number.isFinite(age) && age >= 0 && age < 5 * 60_000;
}
