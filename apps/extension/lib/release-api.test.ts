import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  generation: 1,
  origin: "https://app.test",
  token: "test-only-credential",
  fetch: vi.fn(),
}));
vi.mock("./api", () => ({ getApiBaseUrl: async () => h.origin, authFetch: h.fetch }));
vi.mock("./supabase-oauth", () => ({
  SUPABASE_AUTH: true,
  getOAuthToken: async () => h.token,
  oauthGeneration: () => h.generation,
}));
vi.mock("./net", () => ({ fetchWithTimeout: h.fetch }));
import { executeReleaseJob, releaseSession } from "./release-api";
import type { ReleaseJob } from "./release-state";
const session = () => ({
  scope: { accountId: "A", origin: h.origin },
  generation: h.generation,
  token: h.token,
});
const job: ReleaseJob = {
  status: "unknown",
  request: {
    kind: "edit",
    bookmarkId: "id",
    input: {
      operationId: "stable-edit-id",
      changes: { readingState: "not_on_list" },
      expected: { readingState: "v1" },
    },
  },
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => {
  h.fetch.mockReset();
  h.generation++;
  h.origin = "https://app.test";
  h.token = "test-only-credential";
});
it("uses protected accountId rather than email or a body claim", async () => {
  h.fetch.mockImplementation(async () =>
    json({ accountId: "A", signedIn: true, email: "irrelevant@example.test" }),
  );
  expect((await releaseSession()).scope).toEqual({ accountId: "A", origin: h.origin });
  await expect(releaseSession({ accountId: "B", origin: h.origin })).rejects.toThrow(
    "Account or server changed",
  );
});
it("refuses expired credentials rather than treating cached identity as authorization", async () => {
  h.token = "";
  await expect(releaseSession()).rejects.toThrow("Sign in again");
  expect(h.fetch).not.toHaveBeenCalled();
});
it("reconciles a lost edit response without repeating the mutation", async () => {
  h.fetch
    .mockResolvedValueOnce(json({ operation: { id: "stable-edit-id" } }))
    .mockResolvedValueOnce(json({ bookmark: { id: "id" } }));
  expect((await executeReleaseJob(session(), job)).bookmark?.id).toBe("id");
  expect(h.fetch.mock.calls.every((call) => call[1].method === "GET")).toBe(true);
});
it("replays only after receipt 404 with identical versions and operation ID", async () => {
  h.fetch
    .mockResolvedValueOnce(json({}, 404))
    .mockResolvedValueOnce(json({ operation: { id: "stable-edit-id" } }));
  await executeReleaseJob(session(), job);
  expect(h.fetch.mock.calls[1]?.[1]).toMatchObject({
    method: "PATCH",
    body: JSON.stringify(job.request.input),
    credentials: "omit",
    redirect: "error",
    headers: expect.objectContaining({ Authorization: "Bearer test-only-credential" }),
  });
});
it.each([401, 403, 500])(
  "does not replay when receipt lookup is unresolved (%s)",
  async (status) => {
    h.fetch.mockResolvedValueOnce(json({}, status));
    await expect(executeReleaseJob(session(), job)).rejects.toThrow();
    expect(h.fetch).toHaveBeenCalledOnce();
  },
);
it("rejects a late identity response after account generation changes", async () => {
  h.fetch.mockImplementation(async () => {
    h.generation++;
    return json({ accountId: "A", signedIn: true });
  });
  await expect(releaseSession()).rejects.toThrow("Account or server changed");
});
it("refuses an origin change before dispatch", async () => {
  const previous = session();
  h.origin = "https://other.test";
  await expect(executeReleaseJob(previous, job)).rejects.toThrow("Account or server changed");
  expect(h.fetch).not.toHaveBeenCalled();
});
