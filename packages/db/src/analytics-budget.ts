import { isMasterRepository, type MasterStore } from "./master-repository";
import type { Db } from "./client";

/** One atomic cross-instance reservation; invalid/corrupt counters fail closed. */
export async function reserveAnalyticsBudget(
  db: MasterStore,
  projectHash: string,
  utcMonth: string,
  count: number,
  limit: number,
): Promise<boolean> {
  if (isMasterRepository(db)) return db.reserveAnalyticsBudget(projectHash, utcMonth, count, limit);
  if (
    !/^[a-f0-9]{64}$/.test(projectHash) ||
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(utcMonth) ||
    !Number.isInteger(count) ||
    count <= 0 ||
    !Number.isInteger(limit) ||
    limit < count ||
    limit > 900_000
  )
    return false;
  const result = await db.execute({
    sql: `INSERT INTO platform_config (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = CAST(CAST(platform_config.value AS INTEGER) + CAST(? AS INTEGER) AS TEXT),
        updated_at = excluded.updated_at
      WHERE length(platform_config.value) BETWEEN 1 AND 6
        AND platform_config.value NOT GLOB '*[^0-9]*'
        AND CAST(platform_config.value AS INTEGER) <= ?
      RETURNING value`,
    args: [
      `posthog_budget:${projectHash}:${utcMonth}`,
      String(count),
      new Date().toISOString(),
      count,
      limit - count,
    ],
  });
  return result.rows.length === 1;
}
