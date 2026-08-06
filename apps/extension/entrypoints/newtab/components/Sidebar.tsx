import type { NewTabTemplate } from "@bookmark-ai/types";
import { resolveThumbnail } from "../thumbs";

/**
 * Template history sidebar (§4.7). Presets first, then customs — each row is a
 * thumbnail + name; clicking activates it. Customs get a delete affordance
 * (presets are read-only). The "New tab ✨" row clears the chat context.
 */
export function Sidebar({
  templates,
  activeId,
  onActivate,
  onDelete,
  onNewCustom,
}: {
  templates: NewTabTemplate[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onDelete: (id: string) => void;
  onNewCustom: () => void;
}) {
  const presets = templates.filter((t) => t.isPreset);
  const customs = templates.filter((t) => !t.isPreset);
  return (
    <aside className="flex w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border/60 bg-muted/30 p-3">
      <p className="px-1 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        Your tabs
      </p>
      {[...customs, ...presets].map((t) => {
        const thumb = resolveThumbnail(t.config);
        const active = t.id === activeId;
        return (
          <div key={t.id} className="group relative">
            <button
              type="button"
              onClick={() => onActivate(t.id)}
              title={t.name}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors ${
                active
                  ? "bg-background font-medium text-foreground shadow-sm ring-1 ring-border"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {thumb.kind === "data-url" ? (
                <img src={thumb.url} alt="" className="size-7 shrink-0 rounded-md" />
              ) : (
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-background text-[13px] ring-1 ring-border">
                  {thumb.glyph}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate">{t.name}</span>
              {active && <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />}
            </button>
            {!t.isPreset && (
              <button
                type="button"
                onClick={() => onDelete(t.id)}
                title={`Delete “${t.name}”`}
                className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 rounded-md px-1 text-muted-foreground/70 transition-colors hover:bg-destructive/10 hover:text-destructive group-hover:block"
              >
                ×
              </button>
            )}
          </div>
        );
      })}
      <button
        type="button"
        onClick={onNewCustom}
        className="mt-1 rounded-lg border border-dashed border-border px-2 py-1.5 text-left text-[13px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
      >
        + Describe a new tab…
      </button>
    </aside>
  );
}
