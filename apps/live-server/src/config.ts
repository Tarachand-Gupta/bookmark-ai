import { z } from "zod";
import { decodeEncryptionSecret } from "./crypto";

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

  // Long-lived device tokens (Safari extension header-auth). Verified here with
  // the same HMAC secret the web app mints with — see src/device-token.ts. Optional:
  // the Clerk path stays primary, so a missing secret just declines `bkd_…` tokens.
  DEVICE_TOKEN_SECRET: z.string().optional(),

  // App-level AES-256-GCM key for encrypting `windowsJson` at rest in Redis
  // (base64 of 32 raw bytes — see src/crypto.ts). Optional: unset/empty ⇒ windowsJson
  // is stored as plaintext (dev). SET-BUT-INVALID is a hard boot failure (below) —
  // silently degrading a configured key to plaintext is the worst outcome.
  LIVE_ENCRYPTION_SECRET: z.string().optional(),

  LIVE_TTL_DAYS: z.coerce.number().int().positive().default(7),
  LIVE_PUSH_QUOTA_PER_DAY: z.coerce.number().int().positive().default(2000),

  // SSE fan-out tuning. COALESCE_MS: trailing window that batches pubsub-triggered
  // frames per user into one read+serialize+broadcast (0 = send each immediately).
  // REFRESH_EMIT_MS: while ≥1 viewer is connected, re-emit a fresh frame this often
  // so idle devices' "last seen" age stays current (must be > 0 to avoid a busy loop).
  LIVE_FANOUT_COALESCE_MS: z.coerce.number().int().nonnegative().default(500),
  LIVE_REFRESH_EMIT_MS: z.coerce.number().int().positive().default(60_000),

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
  deviceTokenSecret: string | undefined;
  liveEncryptionSecret: string | undefined;
  ttlDays: number;
  ttlSeconds: number;
  ttlHours: number;
  pushQuotaPerDay: number;
  fanoutCoalesceMs: number;
  refreshEmitMs: number;
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

  // Fail closed: an empty CORS allowlist means "reflect any origin" (see
  // cors.ts resolveAllowedOrigin) — a safe dev default, but a hole in production.
  // Require LIVE_ALLOWED_ORIGINS to be set explicitly there rather than silently
  // accepting every origin. Dev keeps reflect-any.
  if (isProduction && csv(e.LIVE_ALLOWED_ORIGINS).length === 0) {
    throw new Error(
      "live-server: production requires LIVE_ALLOWED_ORIGINS (CORS allowlist); refusing to reflect any origin.",
    );
  }

  // Fail LOUDLY on a set-but-unusable encryption key. An unset/empty value is a
  // deliberate opt-out (plaintext + a one-time warn, dev ergonomics), but a value
  // that is present and does NOT decode to exactly 32 base64 bytes means someone
  // INTENDED encryption and would otherwise get plaintext storage behind a single
  // warn line — a silent security downgrade. Throwing here exits the process, so
  // systemd flaps the unit and the deploy's post-deploy health check goes red.
  // NB: the message never echoes the value (it is a secret and CI logs are public).
  const liveEncryptionSecret = e.LIVE_ENCRYPTION_SECRET?.trim() || undefined;
  if (liveEncryptionSecret && !decodeEncryptionSecret(liveEncryptionSecret)) {
    throw new Error(
      "live-server: LIVE_ENCRYPTION_SECRET is set but invalid — it must be base64 of exactly " +
        "32 raw bytes (openssl rand -base64 32). Refusing to start and silently store live " +
        "tabs as plaintext. Unset the variable to opt into plaintext mode deliberately.",
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
    deviceTokenSecret: e.DEVICE_TOKEN_SECRET,
    liveEncryptionSecret,
    ttlDays: e.LIVE_TTL_DAYS,
    ttlSeconds: e.LIVE_TTL_DAYS * 24 * 60 * 60,
    ttlHours: e.LIVE_TTL_DAYS * 24,
    pushQuotaPerDay: e.LIVE_PUSH_QUOTA_PER_DAY,
    fanoutCoalesceMs: e.LIVE_FANOUT_COALESCE_MS,
    refreshEmitMs: e.LIVE_REFRESH_EMIT_MS,
    devOpen,
    isProduction,
  };
}

/** Open/self-host sentinel — the Redis namespace when there is no Clerk user. */
export const LOCAL_USER = "local";
