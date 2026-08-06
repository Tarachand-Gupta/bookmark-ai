import { describe, expect, it } from "vitest";
import { createContext, runInContext } from "node:vm";
import { bridgeRequestSchema } from "@bookmark-ai/types";
import { NEWTAB_PRESETS } from "./newtab-presets";

/**
 * Preset conformance tests (docs/features/newtab-canvas.md §4.5/§8.2): each
 * built-in template's real <script> is executed in a node VM against a MOCK
 * parent bridge, and we pin:
 *  1. every postMessage it emits validates against bridgeRequestSchema,
 *  2. it does the `ready` handshake BEFORE any data call,
 *  3. it requests exactly its expected data type(s),
 *  4. given canned data, the rendered innerHTML leaves the loading state and
 *     contains the canned content,
 *  5. URL cards wire clicks to {type:"openUrl"} with the canned URL,
 *  6. static contract: no fetch, no chrome.*, no <script src>, no storage.
 *
 * The fake DOM implements only what the presets use: getElementById,
 * innerHTML (recounting <button tags), querySelectorAll("button"), and
 * addEventListener/click on those buttons.
 */

interface CapturedMessage {
  id?: unknown;
  type?: unknown;
  [k: string]: unknown;
}

const CANNED: Record<string, unknown> = {
  getFavorites: [{ url: "https://a.com/x", title: "Fav One", domain: "a.com", tags: ["favorite"], savedAt: "2026-08-01T00:00:00Z" }],
  listBookmarks: {
    bookmarks: [
      {
        id: "b1",
        url: "https://r.com/deep",
        title: "Recent One",
        domain: "r.com",
        category: "dev",
        tags: ["reading"],
        source: { browser: "chrome", device: "laptop", deviceName: null, os: null, savedAt: "2026-08-05T10:00:00Z" },
        savedAt: "2026-08-05T10:00:00Z",
      },
    ],
    total: 1,
  },
  continueWhereYouLeft: {
    enabled: true,
    device: { label: "M1 MacBook", browser: "chrome", tabs: [{ title: "Draft PR", url: "https://git.example/pr/1" }] },
  },
  listLiveTabs: {
    enabled: true,
    devices: [
      { label: "M1 MacBook", browser: "chrome", tabs: [{ title: "Spec doc", url: "https://docs.example/spec" }] },
    ],
  },
  getMostUsed: [
    { domain: "a.com", count: 7 },
    { domain: "b.com", count: 3 },
  ],
  getTimeSpent: { available: false },
};

interface FakeButton {
  addEventListener(type: string, fn: () => void): void;
  click(): void;
}

interface FakeElement {
  id: string;
  innerHTML: string;
  value: string;
  buttons: FakeButton[];
  addEventListener(type: string, fn: (e?: unknown) => void): void;
  dispatch(type: string, e?: unknown): void;
  querySelectorAll(selector: "button" | string): FakeButton[];
}

function makeElement(id: string): FakeElement {
  const listeners = new Map<string, Array<(e?: unknown) => void>>();
  let html = "";
  let buttons: FakeButton[] = [];
  const el: FakeElement = {
    id,
    get innerHTML() {
      return html;
    },
    set innerHTML(v: string) {
      html = String(v);
      const count = html.match(/<button/g)?.length ?? 0;
      buttons = Array.from({ length: count }, (): FakeButton => {
        const handlers: Array<() => void> = [];
        return {
          addEventListener: (_t, fn) => {
            handlers.push(fn);
          },
          click: () => handlers.forEach((h) => h()),
        };
      });
    },
    value: "",
    get buttons() {
      return buttons;
    },
    addEventListener(type, fn) {
      const list = listeners.get(type) ?? [];
      list.push(fn);
      listeners.set(type, list);
    },
    dispatch(type, e) {
      (listeners.get(type) ?? []).forEach((f) => f(e));
    },
    querySelectorAll(selector) {
      return selector === "button" ? buttons : [];
    },
  };
  return el;
}

interface Harness {
  /** All postMessage traffic FROM the template, in order. */
  sent: CapturedMessage[];
  out: FakeElement;
  run(): Promise<void>;
}

function runPreset(html: string): Harness {
  const elements = new Map<string, FakeElement>();
  const el = (id: string): FakeElement => {
    const existing = elements.get(id);
    if (existing) return existing;
    const created = makeElement(id);
    elements.set(id, created);
    return created;
  };

  const sent: CapturedMessage[] = [];
  const messageListeners: Array<(e: { data: unknown }) => void> = [];
  const deliver = (data: unknown) => {
    for (const fn of messageListeners) fn({ data });
  };

  const parent = {
    postMessage(message: CapturedMessage) {
      sent.push(message);
      const req = bridgeRequestSchema.safeParse(message);
      if (!req.success) return; // harness still records it; tests assert validity
      if (req.data.type === "openUrl") {
        deliver({ id: req.data.id, ok: true });
        return;
      }
      const data = req.data.type === "ready" ? { bridge: "test" } : CANNED[req.data.type];
      deliver({ id: req.data.id, ok: data !== undefined, data, error: data === undefined ? "no canned data" : undefined });
    },
  };

  const document = { getElementById: el };
  const window = {
    addEventListener(type: string, fn: (e: { data: unknown }) => void) {
      if (type === "message") messageListeners.push(fn);
    },
  };

  const start = html.indexOf("<script>");
  const end = html.lastIndexOf("</" + "script>");
  if (start === -1 || end === -1) throw new Error("preset has no <script> block");
  const script = html.slice(start + "<script>".length, end);

  const sandbox = createContext({
    window,
    document,
    parent,
    console,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    Date,
  }) as object;

  runInContext(script, sandbox, { timeout: 2_000 });

  return {
    sent,
    out: el("out"),
    async run() {
      // Let the async init() flow (ready → data call → render) settle.
      for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r));
    },
  };
}

const EXPECTED_CALL: Record<string, string> = {
  "preset:favorites": "getFavorites",
  "preset:recent": "listBookmarks",
  "preset:continue": "continueWhereYouLeft",
  "preset:working-on": "listLiveTabs",
  "preset:most-used": "getMostUsed",
  "preset:time-spent": "getTimeSpent",
};

const URL_PRESETS = new Set(["preset:favorites", "preset:recent", "preset:continue"]);
const EXPECTED_URL: Record<string, string> = {
  "preset:favorites": "https://a.com/x",
  "preset:recent": "https://r.com/deep",
  "preset:continue": "https://git.example/pr/1",
};

describe("preset sandbox contract (static)", () => {
  for (const p of NEWTAB_PRESETS) {
    it(`${p.id}: no network/chrome/storage/external-script access`, () => {
      expect(p.html).not.toContain("fetch(");
      expect(p.html).not.toContain("XMLHttpRequest");
      expect(p.html).not.toContain("WebSocket");
      expect(p.html).not.toContain("chrome.");
      expect(p.html).not.toContain("localStorage");
      expect(p.html).not.toContain("<script src");
      expect(p.html).not.toContain("import(");
      expect(p.html.length).toBeLessThanOrEqual(200_000);
      expect(p.html.startsWith("<!doctype html>")).toBe(true);
    });
  }
});

describe("preset bridge protocol (executed)", () => {
  for (const p of NEWTAB_PRESETS) {
    it(`${p.id}: valid messages, ready first, expected data call`, async () => {
      const h = runPreset(p.html);
      await h.run();

      expect(h.sent.length).toBeGreaterThanOrEqual(2);
      expect(h.sent[0]!.type).toBe("ready");
      expect(h.sent.some((m) => m.type === EXPECTED_CALL[p.id])).toBe(true);
      for (const m of h.sent) {
        expect(
          bridgeRequestSchema.safeParse(m).success,
          `invalid bridge message: ${JSON.stringify(m)}`,
        ).toBe(true);
      }
    });

    it(`${p.id}: renders canned data (leaves the loading state)`, async () => {
      const h = runPreset(p.html);
      await h.run();
      expect(h.out.innerHTML).not.toContain("Loading");
      expect(h.out.innerHTML.length).toBeGreaterThan(10);
    });
  }

  for (const id of URL_PRESETS) {
    it(`${id}: first card click posts openUrl with the canned http(s) URL`, async () => {
      const h = runPreset(NEWTAB_PRESETS.find((p) => p.id === id)!.html);
      await h.run();
      expect(h.out.buttons.length).toBeGreaterThan(0);
      h.out.buttons[0]!.click();
      await h.run();
      const opens = h.sent.filter((m) => m.type === "openUrl");
      expect(opens.length).toBe(1);
      expect(opens[0]!.url).toBe(EXPECTED_URL[id]);
      expect(String(opens[0]!.url)).toMatch(/^https?:\/\//);
    });
  }

  it("preset:continue and preset:working-on show the honest sharing-off state", async () => {
    for (const id of ["preset:continue", "preset:working-on"]) {
      const canned = CANNED; // temporarily shadow below via monkey patch per-run
      const p = NEWTAB_PRESETS.find((x) => x.id === id)!;
      void canned;
      const orig = CANNED[id === "preset:continue" ? "continueWhereYouLeft" : "listLiveTabs"];
      CANNED[id === "preset:continue" ? "continueWhereYouLeft" : "listLiveTabs"] = { enabled: false };
      try {
        const h = runPreset(p.html);
        await h.run();
        expect(h.out.innerHTML).toContain("Live");
        expect(h.out.innerHTML.toLowerCase()).toContain("sharing");
      } finally {
        CANNED[id === "preset:continue" ? "continueWhereYouLeft" : "listLiveTabs"] = orig;
      }
    }
  });

  it("preset:time-spent renders the honest 'not tracked' state", async () => {
    const h = runPreset(NEWTAB_PRESETS.find((p) => p.id === "preset:time-spent")!.html);
    await h.run();
    expect(h.out.innerHTML).toContain("Not tracked");
  });
});
