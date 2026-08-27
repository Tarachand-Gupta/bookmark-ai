import { useState } from "react";
import type { Bookmark, Session } from "@bookmark-ai/types";
import { Pill } from "./ui/pill";
import { CheckIcon, ImageIcon, LayersIcon } from "./ui/icons";

/**
 * ONE confirmation card for both save paths — the bookmark save and the
 * "keep open" session save used to be two near-identical components
 * (`SavedResult` / `SessionSavedResult`) that drifted apart. The variant only
 * changes the headline, the thumbnail, and whether AI chips appear.
 *
 * The closing session save still needs no confirmation: the window vanishing and
 * the web app opening IS the feedback, and this popup dies with its window.
 */
export type ConfirmationProps =
  | { variant: "bookmark"; bookmark: Bookmark }
  | { variant: "session"; session: Session };

export function ConfirmationCard(props: ConfirmationProps) {
  return (
    <section className="flex flex-col gap-2.5 rounded-lg border border-border p-3">
      <div className="flex items-center gap-2">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 dark:bg-emerald-500">
          <CheckIcon className="size-[11px] text-white" strokeWidth={3} />
        </span>
        <p className="text-[13px] font-semibold">
          {props.variant === "bookmark" ? "Saved to your library" : "Session saved"}
        </p>
      </div>

      {props.variant === "bookmark" ? (
        <BookmarkBody bookmark={props.bookmark} />
      ) : (
        <SessionBody session={props.session} />
      )}
    </section>
  );
}

function BookmarkBody({ bookmark }: { bookmark: Bookmark }) {
  const [imageFailed, setImageFailed] = useState(false);
  const image = bookmark.og.image && !imageFailed ? bookmark.og.image : null;
  const tags = bookmark.tags.slice(0, 4);

  return (
    <>
      <div className="flex items-start gap-2.5">
        <span className="flex h-11 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-gradient-to-br from-muted to-border">
          {image ? (
            <img
              src={image}
              alt=""
              className="size-full object-cover"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <ImageIcon className="size-4 text-muted-foreground" />
          )}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="line-clamp-2 text-[13px] font-medium leading-[1.35]">{bookmark.title}</p>
          <p className="truncate text-[11px] text-muted-foreground">{bookmark.domain}</p>
        </div>
      </div>

      {/* The payoff of the save: what the AI decided this page is. */}
      {(bookmark.category || tags.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {bookmark.category && <Pill tone="category">{bookmark.category}</Pill>}
          {tags.map((tag) => (
            <Pill key={tag}>{tag}</Pill>
          ))}
        </div>
      )}
    </>
  );
}

function SessionBody({ session }: { session: Session }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="flex h-11 w-16 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-muted to-border">
        <LayersIcon className="size-4 text-muted-foreground" strokeWidth={1.8} />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="line-clamp-2 text-[13px] font-medium leading-[1.35]">
          {session.name || "Untitled session"}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          {session.tabCount} tab{session.tabCount === 1 ? "" : "s"} · your tabs stay open
        </p>
      </div>
    </div>
  );
}
