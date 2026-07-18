import { z } from "zod";

/** CSV env → trimmed non-empty list. */
function csv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const boolish = z
  .string()
  .optional()
  .transform((v) => v === "1" || v?.toLowerCase() === "true");

const rawSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  REDIS_URL: z.string().default("redis://127.0.0.1:6379"),

  // Clerk offline verification: either the secret key (fetches JWKS once, then
  // networkless) OR a pinned PEM public key + issuer for a fully egress-free VM.
  CLERK_SECRET_KEY: z.string().optional(),
  CLERK_JWT_KEY: z.string().optional(),
  CLERK_ISSUER: z.string().optional(),

  CLERK_ALLOWED_USER_IDS: z.string().optional(),
  CLERK_AUTHORIZED_PARTIES: z.string().optional(),
  LIVE_ALLOWED_ORIGINS: z.string().optional(),

  LIVE_TTL_DAYS: z.coerce.number().int().positive().default(7),
  LIVE_PUSH_QUOTA_PER_DAY: z.coerce.number().int().positive().default(2000),

  // Dev-only tokenless bypass, mirrors the web app's DEV_OPEN_API escape hatch
  // (lets curl / the Zig desktop client smoke-test a local server). Ignored in
  // production. Open-mode requests use the "local" userId sentinel.
  DEV_OPEN_API: boolish,
  NODE_ENV: z.string().default("development"),
});

export type Config = {
  port: number;
  redisUrl: string;
  clerkSecretKey: string | undefined;
  clerkJwtKey: string | undefined;
  clerkIssuer: string | undefined;
  allowedUserIds: string[];
  authorizedParties: string[];
  allowedOrigins: string[];
  ttlDays: number;
  ttlSeconds: number;
  ttlHours: number;
  pushQuotaPerDay: number;
  devOpen: boolean;
  isProduction: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = rawSchema.safeParse(env);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(`Invalid live-server config: ${first?.path.join(".")} — ${first?.message}`);
  }
  const e = parsed.data;
  const isProduction = e.NODE_ENV === "production";
  const devOpen = e.DEV_OPEN_API && !isProduction;

  // Fail closed: in production we must be able to verify Clerk tokens, unless the
  // operator explicitly opted into open mode (which prod ignores anyway).
  if (isProduction && !e.CLERK_SECRET_KEY && !(e.CLERK_JWT_KEY && e.CLERK_ISSUER)) {
    throw new Error(
      "live-server: production requires CLERK_SECRET_KEY, or CLERK_JWT_KEY + CLERK_ISSUER, to verify tokens.",
    );
  }

  return {
    port: e.PORT,
    redisUrl: e.REDIS_URL,
    clerkSecretKey: e.CLERK_SECRET_KEY,
    clerkJwtKey: e.CLERK_JWT_KEY,
    clerkIssuer: e.CLERK_ISSUER,
    allowedUserIds: csv(e.CLERK_ALLOWED_USER_IDS),
    authorizedParties: csv(e.CLERK_AUTHORIZED_PARTIES),
    allowedOrigins: csv(e.LIVE_ALLOWED_ORIGINS),
    ttlDays: e.LIVE_TTL_DAYS,
    ttlSeconds: e.LIVE_TTL_DAYS * 24 * 60 * 60,
    ttlHours: e.LIVE_TTL_DAYS * 24,
    pushQuotaPerDay: e.LIVE_PUSH_QUOTA_PER_DAY,
    devOpen,
    isProduction,
  };
}

/** Open/self-host sentinel — the Redis namespace when there is no Clerk user. */
export const LOCAL_USER = "local";
