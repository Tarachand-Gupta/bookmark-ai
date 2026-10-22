import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  listBookmarksQuerySchema,
  searchQuerySchema,
  MAX_ORGANIZATION_SELECTION,
} from "@bookmark-ai/types";
import { searchFullText } from "@bookmark-ai/db";
import { createOrganizationSelection, performSearch, OrganizationError } from "@bookmark-ai/engine";
import { enforceQuota, getRequestApiContext } from "@/lib/server/api-context";
import { organizationErrorResponse } from "@/lib/server/organization-response";
const schema = z
  .object({
    bookmarkIds: z.array(z.string().min(1)).max(MAX_ORGANIZATION_SELECTION).optional(),
    query: listBookmarksQuerySchema.optional(),
    search: searchQuerySchema.optional(),
  })
  .strict()
  .refine(
    (v) => [v.bookmarkIds, v.query, v.search].filter((x) => x !== undefined).length === 1,
    "Choose one selection source",
  );
export async function POST(req: NextRequest) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  await ctx.ready;
  const p = schema.safeParse(await req.json().catch(() => null));
  if (!p.success)
    return NextResponse.json(
      { error: p.error.issues[0]?.message ?? "Invalid selection" },
      { status: 400 },
    );
  try {
    if (p.data.search) {
      const search = p.data.search;
      if (search.mode === "text") {
        const ranked = await searchFullText(
          ctx.db,
          search.q,
          MAX_ORGANIZATION_SELECTION + 1,
          search,
        );
        if (ranked.length > MAX_ORGANIZATION_SELECTION)
          throw new OrganizationError(
            "selection-too-large",
            "Narrow the search before selecting all matches.",
            422,
          );
        const selection = await createOrganizationSelection(ctx.db, {
          bookmarkIds: ranked.map((r) => r.bookmark.id),
        });
        selection.scope = "all_matches";
        await ctx.db.execute({
          sql: "UPDATE organization_selections SET selection_json=? WHERE id=?",
          args: [JSON.stringify(selection), selection.id],
        });
        return NextResponse.json({ selection });
      }
      const over = await enforceQuota(ctx.userId, "searches");
      if (over) return over;
      const ranked = await performSearch(ctx.db, ctx.gemini, { ...search, offset: 0, limit: 200 });
      return NextResponse.json({
        selection: await createOrganizationSelection(ctx.db, {
          rankedIds: ranked.results.map((r) => r.bookmark.id),
          rankingLimit: 200,
        }),
      });
    }
    return NextResponse.json({ selection: await createOrganizationSelection(ctx.db, p.data) });
  } catch (e) {
    return organizationErrorResponse(e);
  }
}
