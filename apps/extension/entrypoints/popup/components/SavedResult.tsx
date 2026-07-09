import type { Bookmark } from "@bookmark-ai/types";

export function SavedResult({ bookmark }: { bookmark: Bookmark }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 text-card-foreground shadow-sm">
      <div className="flex items-center gap-2">
        <span className="flex size-5 items-center justify-center rounded-full bg-primary text-[11px] text-primary-foreground">
          ✓
        </span>
        <p className="truncate text-sm font-medium">Saved “{bookmark.title}”</p>
      </div>
      {bookmark.og.image && (
        <img
          src={bookmark.og.image}
          alt=""
          className="max-h-28 w-full rounded-lg border object-cover"
        />
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-md bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
          {bookmark.category}
        </span>
        {bookmark.tags.map((tag) => (
          <span
            key={tag}
            className="rounded-md bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
          >
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
}
