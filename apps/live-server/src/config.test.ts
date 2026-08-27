import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { loadConfig } from "./config";

/**
 * Boot-time validation of LIVE_ENCRYPTION_SECRET.
 *
 * The failure this guards against: a secret that is SET but unusable (a hex key, a
 * truncated paste, a base64 blob of the wrong length) used to boot happily and store
 * every user's tabs as PLAINTEXT behind a single warn line — encryption silently
 * disabled on a box the operator believed was encrypted. It must instead abort the
 * process so systemd flaps the unit and the deploy health check goes red.
 *
 * `loadConfig` takes its env as an argument, so these cases never touch process.env.
 */

const VALID = randomBytes(32).toString("base64");

/** Minimum env for a dev-mode config (no prod fail-closed checks apply). */
const base = { NODE_ENV: "development" } as NodeJS.ProcessEnv;

test("LIVE_ENCRYPTION_SECRET unset → plaintext mode, no throw", () => {
  const config = loadConfig({ ...base });
  assert.equal(config.liveEncryptionSecret, undefined);
});

test("LIVE_ENCRYPTION_SECRET empty or whitespace → treated as unset, no throw", () => {
  assert.equal(loadConfig({ ...base, LIVE_ENCRYPTION_SECRET: "" }).liveEncryptionSecret, undefined);
  assert.equal(
    loadConfig({ ...base, LIVE_ENCRYPTION_SECRET: "   " }).liveEncryptionSecret,
    undefined,
    "a whitespace-only value is an unset value, not a broken one",
  );
});

test("a valid 32-byte base64 key boots and is surfaced trimmed", () => {
  const config = loadConfig({ ...base, LIVE_ENCRYPTION_SECRET: `  ${VALID}\n` });
  assert.equal(
    config.liveEncryptionSecret,
    VALID,
    "surrounding whitespace from a .env is tolerated",
  );
});

test("every set-but-invalid secret shape aborts the boot", () => {
  const invalid: Array<[string, string]> = [
    ["16 bytes", randomBytes(16).toString("base64")],
    ["48 bytes", randomBytes(48).toString("base64")],
    ["31 bytes", randomBytes(31).toString("base64")],
    ["hex instead of base64", randomBytes(32).toString("hex")],
    ["arbitrary junk", "not-base64-at-all"],
    ["truncated paste", VALID.slice(0, 20)],
  ];
  for (const [name, value] of invalid) {
    assert.throws(
      () => loadConfig({ ...base, LIVE_ENCRYPTION_SECRET: value }),
      (err: unknown) => {
        const message = (err as Error).message;
        assert.match(message, /LIVE_ENCRYPTION_SECRET is set but invalid/, name);
        // The message lands in journald and in public CI logs.
        assert.ok(!message.includes(value), `the error must never echo the secret (${name})`);
        return true;
      },
      `${name} must not boot`,
    );
  }
});

test("the boot check does not disturb the rest of the config", () => {
  const config = loadConfig({
    ...base,
    LIVE_ENCRYPTION_SECRET: VALID,
    PORT: "5199",
    REDIS_URL: "redis://127.0.0.1:6399",
    DEV_OPEN_API: "1",
  });
  assert.equal(config.port, 5199);
  assert.equal(config.redisUrl, "redis://127.0.0.1:6399");
  assert.equal(config.devOpen, true);
  assert.equal(config.isProduction, false);
});
