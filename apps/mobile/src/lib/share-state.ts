export interface PendingShareRecord { id: string; url: string; title?: string; owner: string | null }
export function shareForAccount(record: PendingShareRecord | null, userId: string | null, loaded: boolean): PendingShareRecord | null {
  if (!record || !loaded) return record;
  // An unsigned capture must be durably assigned before a signed-in save.
  if (userId && record.owner === null) return null;
  return record.owner !== null && record.owner !== userId ? null : record;
}
export function bindShare(record: PendingShareRecord, userId: string): PendingShareRecord { return record.owner === null ? { ...record, owner: userId } : record; }
export function canConsumeShare(record: PendingShareRecord | null, expectedId: string): boolean { return record?.id === expectedId; }
/** One save claim per captured share, even when a strict-mode effect reruns. */
export function createShareClaims() {
  const claims = new Set<string>();
  return (id: string) => { if (claims.has(id)) return false; claims.add(id); return true; };
}
