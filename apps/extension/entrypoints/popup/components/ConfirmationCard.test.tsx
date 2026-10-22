import { afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Bookmark } from "@bookmark-ai/types";
import { apiUrlItem, createBookmarkResult, setAuthTokenProvider } from "@/lib/api";
import { ConfirmationCard } from "./ConfirmationCard";

afterEach(() => { setAuthTokenProvider(async () => null); });

it.each([false, true])("shows the server save verdict and returned title (existing: %s)", async (existing) => {
  await apiUrlItem.setValue("https://fixture.invalid");
  setAuthTokenProvider(async () => "fixture-token");
  const bookmark = {
    id: "saved-one", url: "https://page.invalid", title: existing ? "My edited title" : "New page",
    domain: "page.invalid", og: {}, category: "Research", tags: ["reference"],
  } as Bookmark;
  const fetch = vi.fn(async () => new Response(JSON.stringify({ bookmark, existing }), { status: existing ? 200 : 201 }));
  vi.stubGlobal("fetch", fetch);
  const result = await createBookmarkResult({ url: bookmark.url, title: "Browser title" } as never);
  const html = renderToStaticMarkup(<ConfirmationCard variant="bookmark" {...result} />);
  expect(fetch).toHaveBeenCalledOnce();
  expect(result.existing).toBe(existing);
  expect(html).toContain(existing ? "Already saved" : ">Saved<");
  expect(html).toContain(bookmark.title);
  expect(html).not.toContain("Browser title");
});
