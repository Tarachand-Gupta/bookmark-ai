import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import {
  drainMirrorQueue,
  enqueueMirrorAdd,
  queuedMirrorAdds,
  resetDrainGuard,
  type QueuedMirrorAdd,
} from "./native-sync-queue";

/**
 * A native bookmark save is a one-shot event — nothing ever re-fires
 * `bookmarks.onCreated` for that node — so a mirror POST that failed used to be
 * lost with nothing but a log line. These tests pin the durability contract:
 * failed adds survive, get retried later, stay bounded, and eventually give up
 * rather than retrying a doomed url forever.
 */
vi.mock("./diag", () => ({ diag: vi.fn() }));

beforeEach(() => {
  fakeBrowser.reset();
  resetDrainGuard();
});

async function urls(): Promise<string[]> {
  return (await queuedMirrorAdds()).map((e) => e.url);
}

describe("enqueueMirrorAdd", () => {
  it("keeps the entry with its metadata and first failed attempt counted", async () => {
    await enqueueMirrorAdd({ url: "https://a.test", title: "A", tags: ["reading"] });

    const queue = await queuedMirrorAdds();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      url: "https://a.test",
      title: "A",
      tags: ["reading"],
      tries: 1,
    });
  });

  it("keeps ONE pending mirror per url", async () => {
    await enqueueMirrorAdd({ url: "https://a.test", title: "old" });
    await enqueueMirrorAdd({ url: "https://a.test", title: "new" });

    const queue = await queuedMirrorAdds();
    expect(queue).toHaveLength(1);
    expect(queue[0]?.title).toBe("new");
  });

  it("caps the queue at 200, keeping the NEWEST entries", async () => {
    for (let i = 0; i < 205; i += 1) {
      await enqueueMirrorAdd({ url: `https://x.test/${i}` });
    }

    const queued = await urls();
    expect(queued).toHaveLength(200);
    expect(queued[0]).toBe("https://x.test/5");
    expect(queued.at(-1)).toBe("https://x.test/204");
  });
});

describe("drainMirrorQueue", () => {
  it("is a no-op on an empty queue", async () => {
    const send = vi.fn(async () => true);
    expect(await drainMirrorQueue(send)).toEqual({ sent: 0, kept: 0, dropped: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("delivers every queued add and empties the queue", async () => {
    await enqueueMirrorAdd({ url: "https://a.test" });
    await enqueueMirrorAdd({ url: "https://b.test", tags: ["reading", "article"] });
    const sent: QueuedMirrorAdd[] = [];

    const result = await drainMirrorQueue(async (entry) => {
      sent.push(entry);
      return true;
    });

    expect(result).toEqual({ sent: 2, kept: 0, dropped: 0 });
    expect(sent.map((e) => e.url)).toEqual(["https://a.test", "https://b.test"]);
    expect(sent[1]?.tags).toEqual(["reading", "article"]);
    expect(await urls()).toEqual([]);
  });

  it("re-queues what still fails, with the attempt count incremented", async () => {
    await enqueueMirrorAdd({ url: "https://a.test" });
    await enqueueMirrorAdd({ url: "https://b.test" });

    const result = await drainMirrorQueue(async (e) => e.url === "https://a.test");

    expect(result).toEqual({ sent: 1, kept: 1, dropped: 0 });
    const queue = await queuedMirrorAdds();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ url: "https://b.test", tries: 2 });
  });

  it("treats a thrown sender as a failure rather than losing the entry", async () => {
    await enqueueMirrorAdd({ url: "https://a.test" });

    const result = await drainMirrorQueue(async () => {
      throw new Error("offline");
    });

    expect(result).toEqual({ sent: 0, kept: 1, dropped: 0 });
    expect(await urls()).toEqual(["https://a.test"]);
  });

  it("gives up on an entry after 5 attempts instead of retrying forever", async () => {
    await enqueueMirrorAdd({ url: "https://doomed.test" });
    const alwaysFails = async () => false;

    // tries 1→2, 2→3, 3→4 keep it; the 4th drain would push it to 5 and drop it.
    for (const expected of [2, 3, 4]) {
      resetDrainGuard();
      await drainMirrorQueue(alwaysFails);
      expect((await queuedMirrorAdds())[0]?.tries).toBe(expected);
    }

    const final = await drainMirrorQueue(alwaysFails);
    expect(final).toEqual({ sent: 0, kept: 0, dropped: 1 });
    expect(await urls()).toEqual([]);
  });

  it("does not clobber an add queued WHILE the drain is running", async () => {
    await enqueueMirrorAdd({ url: "https://a.test" });

    const result = await drainMirrorQueue(async () => {
      // A native bookmark is created (and fails) mid-drain.
      await enqueueMirrorAdd({ url: "https://mid.test" });
      return false;
    });

    expect(result.kept).toBe(1);
    expect((await urls()).sort()).toEqual(["https://a.test", "https://mid.test"]);
  });

  it("refuses to run two drains at once (boot + alarm racing)", async () => {
    await enqueueMirrorAdd({ url: "https://a.test" });
    let inFlight = 0;
    let maxConcurrent = 0;
    const send = async () => {
      inFlight += 1;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return true;
    };

    const [first, second] = await Promise.all([drainMirrorQueue(send), drainMirrorQueue(send)]);

    expect(maxConcurrent).toBe(1);
    expect(first.sent + second.sent).toBe(1); // delivered once, not twice
  });
});
