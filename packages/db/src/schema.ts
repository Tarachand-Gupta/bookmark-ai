import type { Db } from "./client";
import { runMigrations, TENANT_MIGRATIONS } from "./migrations";

// EMBEDDING_DIM now lives with the baseline DDL in migrations.ts; re-exported
// here so existing `from "./schema"` / "@bookmark-ai/db" imports keep working.
export { EMBEDDING_DIM } from "./migrations";

/**
 * Idempotent schema setup for a tenant DB. Delegates to the versioned migration
 * runner (`schema_migrations` version table + additive migrations). Same name
 * and signature as before — the adapters call this unchanged at boot.
 */
export async function ensureSchema(db: Db): Promise<void> {
  await runMigrations(db, TENANT_MIGRATIONS);
}
