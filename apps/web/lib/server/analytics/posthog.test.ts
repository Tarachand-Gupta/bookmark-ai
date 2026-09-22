import { afterEach, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reserveAnalyticsBudget } from "@bookmark-ai/db";
import {
  analyticsPlatform,
  analyticsBudgetCycle,
  createProductAnalytics,
  type ProductEventInput,
} from "./posthog";
const event: ProductEventInput = {
  event: "bookmark_save_completed",
  platform: "ios",
  userId: "private-user",
};
function setup(extra: Record<string, string | undefined> = {}) {
  const reserve = vi.fn().mockResolvedValue(true);
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  const logger = createProductAnalytics({
    env: {
      POSTHOG_ENABLED: "true",
      POSTHOG_PROJECT_TOKEN: "fake-token",
      NODE_ENV: "production",
      ...extra,
    },
    reserve,
    fetch,
    random: () => 0.05,
  });
  return { logger, reserve, fetch };
}
afterEach(() => vi.useRealTimers());
it.each([
  { POSTHOG_ENABLED: "false" },
  { POSTHOG_PROJECT_TOKEN: "" },
  { NODE_ENV: "development" },
  { VERCEL_ENV: "preview" },
  { POSTHOG_MONTHLY_EVENT_LIMIT: "0" },
  { POSTHOG_MONTHLY_EVENT_LIMIT: "900001" },
  { POSTHOG_MONTHLY_EVENT_LIMIT: "invalid" },
  { POSTHOG_BILLING_CYCLE_START_DAY: "29" },
])("fails closed %j", async (overrides) => {
  const { logger, fetch, reserve } = setup(overrides);
  await logger.capture(event);
  await logger.flush();
  expect(fetch).not.toHaveBeenCalled();
  expect(reserve).not.toHaveBeenCalled();
});
it("allows explicit nonproduction override, skips unknown or unauthenticated clients", async () => {
  const { logger, fetch } = setup({ VERCEL_ENV: "preview", POSTHOG_ALLOW_NON_PRODUCTION: "true" });
  await logger.capture({ ...event, userId: null });
  await logger.capture({ ...event, platform: "unknown" });
  await logger.flush();
  expect(fetch).not.toHaveBeenCalled();
  await logger.capture(event);
  await logger.flush();
  expect(fetch).toHaveBeenCalledOnce();
});
it("requires Firefox granted consent and exact platform enums", () => {
  for (const consent of ["", "denied", "granted"]) {
    const request = new Request("https://test.test", {
      headers: {
        "X-Bookmark-Client": "extension-firefox",
        "X-Bookmark-Analytics-Consent": consent,
      },
    });
    expect(analyticsPlatform(request)).toBe(
      consent === "granted" ? "extension-firefox" : "unknown",
    );
  }
  expect(analyticsPlatform(new Request("https://test.test"))).toBe("unknown");
  expect(
    analyticsPlatform(
      new Request("https://test.test", {
        headers: { "X-Bookmark-Client": "ios", "X-Bookmark-Analytics-Consent": "denied" },
      }),
    ),
  ).toBe("unknown");
});
it("sanitizes properties, hashes user IDs, disables profiles and geoip", async () => {
  const { logger, fetch, reserve } = setup();
  await logger.capture({
    ...event,
    properties: {
      item_count: 2,
      duration_ms: Infinity,
      ...{ query: "secret", url: "secret", sample_rate: 999 },
    },
  });
  await logger.flush();
  const [url, init] = fetch.mock.calls[0]!;
  const body = JSON.parse(init.body);
  expect(url).toBe("https://us.i.posthog.com/batch/");
  expect(init.redirect).toBe("error");
  expect(init.body).not.toMatch(/secret|private-user|Infinity/);
  expect(body.batch[0].distinct_id).toMatch(/^[a-f0-9]{64}$/);
  expect(body.batch[0].properties).toEqual({
    item_count: 2,
    platform: "ios",
    sample_rate: 1,
    $process_person_profile: false,
    $geoip_disable: true,
  });
  expect(reserve).toHaveBeenCalledWith(
    expect.stringMatching(/^[a-f0-9]{64}$/),
    expect.stringMatching(/^\d{4}-\d{2}$/),
    1,
    900000,
  );
});
it("samples searches before quota with valid zero support", async () => {
  for (const rate of ["0", "0.01", "invalid"]) {
    const { logger, reserve } = setup({ POSTHOG_SEARCH_SAMPLE_RATE: rate });
    await logger.capture({ ...event, event: "search_completed" });
    await logger.flush();
    expect(reserve).not.toHaveBeenCalled();
  }
  const { logger, reserve } = setup();
  await logger.capture({ ...event, event: "search_completed" });
  await logger.flush();
  expect(reserve).toHaveBeenCalledOnce();
});
it("fails closed on missing/rejected budget and database error", async () => {
  const { logger, reserve, fetch } = setup();
  reserve.mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("db down"));
  await logger.capture(event);
  await logger.flush();
  await logger.capture(event);
  await logger.flush();
  expect(fetch).not.toHaveBeenCalled();
});
it("reserves before send and never retries or refunds failed attempts", async () => {
  const { logger, reserve, fetch } = setup();
  fetch
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockRejectedValueOnce(new Error("down"));
  await logger.capture(event);
  await logger.flush();
  await logger.capture(event);
  await logger.flush();
  await logger.flush();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(reserve).toHaveBeenCalledTimes(2);
  expect(reserve.mock.invocationCallOrder[0]).toBeLessThan(fetch.mock.invocationCallOrder[0]!);
});
it("bounds queue and batches", async () => {
  const { logger, reserve, fetch } = setup();
  for (let i = 0; i < 250; i++) await logger.capture(event);
  await logger.flush();
  expect(fetch).toHaveBeenCalledTimes(4);
  expect(reserve.mock.calls.every((call) => call[2] === 50)).toBe(true);
});
it("bounds stalled reservation and transport", async () => {
  vi.useFakeTimers();
  const { logger, reserve, fetch } = setup();
  reserve.mockImplementationOnce(() => new Promise(() => {}));
  await logger.capture(event);
  const first = logger.flush();
  await vi.advanceTimersByTimeAsync(2001);
  await first;
  expect(fetch).not.toHaveBeenCalled();
  fetch.mockImplementationOnce(() => new Promise(() => {}));
  await logger.capture(event);
  const second = logger.flush();
  await vi.advanceTimersByTimeAsync(2001);
  await second;
  expect(fetch.mock.calls[0]![1].signal.aborted).toBe(true);
});
it("anchors UTC billing cycles including year rollover", () => {
  expect(analyticsBudgetCycle(new Date("2026-09-21T23:59:59Z"), 22)).toBe("2026-08");
  expect(analyticsBudgetCycle(new Date("2026-09-22T00:00:00Z"), 22)).toBe("2026-09");
  expect(analyticsBudgetCycle(new Date("2027-01-01T00:00:00Z"), 22)).toBe("2026-12");
  expect(analyticsBudgetCycle(new Date("2027-01-01T00:00:00Z"), 1)).toBe("2027-01");
});
it("atomically caps independent connections, resets cycles and rejects corrupt counters", async () => {
  const dir = mkdtempSync(join(tmpdir(), "analytics-budget-"));
  const clients = [
    createClient({ url: `file:${dir}/budget.db` }),
    createClient({ url: `file:${dir}/budget.db` }),
  ];
  const hash = "a".repeat(64);
  try {
    await clients[0]!.execute(
      "CREATE TABLE platform_config(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL)",
    );
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        reserveAnalyticsBudget(clients[i % 2]!, hash, "2026-09", 1, 13),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(13);
    expect(await reserveAnalyticsBudget(clients[0]!, hash, "2026-09", 1, 13)).toBe(false);
    expect(await reserveAnalyticsBudget(clients[1]!, hash, "2026-10", 1, 13)).toBe(true);
    await clients[0]!.execute({
      sql: "UPDATE platform_config SET value=? WHERE key=?",
      args: ["corrupt", `posthog_budget:${hash}:2026-10`],
    });
    expect(await reserveAnalyticsBudget(clients[1]!, hash, "2026-10", 1, 13)).toBe(false);
    expect(await reserveAnalyticsBudget(clients[1]!, hash, "2026-11", 1, 900001)).toBe(false);
  } finally {
    clients.forEach((client) => client.close());
    rmSync(dir, { recursive: true, force: true });
  }
});

it("emits the configured sample rate and ignores a caller override", async () => {
  const { logger, fetch } = setup({ POSTHOG_SEARCH_SAMPLE_RATE: "0.25" });
  await logger.capture({
    ...event,
    event: "search_completed",
    properties: { ...{ sample_rate: 999 } } as never,
  });
  await logger.flush();
  expect(JSON.parse(fetch.mock.calls[0]![1].body).batch[0].properties.sample_rate).toBe(0.25);
});
