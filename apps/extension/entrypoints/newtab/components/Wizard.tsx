import { useState } from "react";
import type { NewTabTemplate } from "@bookmark-ai/types";
import { iconUrl } from "@/lib/icon";
import { resolveThumbnail } from "../thumbs";

/**
 * First-run wizard (§4.6): pick a starter OR describe your tab in plain
 * English — two paths to one outcome (an active template). Renders while no
 * newtab_settings row exists (the "seen it" marker).
 */
export function Wizard({
  presets,
  busy,
  note,
  onPick,
  chatBox,
}: {
  presets: NewTabTemplate[];
  busy: boolean;
  note: string | null;
  onPick: (id: string) => void;
  /** The chat box is lifted into AppState so the wizard and popover share one
   *  implementation (ChatInput). */
  chatBox: React.ReactNode;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
      <div className="flex items-center gap-3">
        <img src={iconUrl()} alt="" className="size-10 rounded-xl" />
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Welcome to your tab</h1>
          <p className="text-sm text-muted-foreground">
            Pick a starting point, or describe what you want.
          </p>
        </div>
      </div>

      <div className="grid w-full max-w-3xl grid-cols-2 gap-3 sm:grid-cols-3">
        {presets.map((t) => {
          const thumb = resolveThumbnail(t.config);
          const selected = picked === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setPicked(t.id)}
              className={`flex flex-col items-center gap-2 rounded-xl border bg-card p-4 text-center transition-colors ${
                selected ? "border-foreground/50 ring-2 ring-foreground/20" : "hover:border-foreground/25"
              }`}
            >
              {thumb.kind === "data-url" ? (
                <img src={thumb.url} alt="" className="size-12 rounded-lg" />
              ) : (
                <span className="flex size-12 items-center justify-center rounded-lg bg-muted text-2xl">
                  {thumb.glyph}
                </span>
              )}
              <span className="text-[13px] font-medium leading-tight">{t.name}</span>
            </button>
          );
        })}
      </div>

      {chatBox}

      <button
        type="button"
        disabled={!picked || busy}
        onClick={() => picked && onPick(picked)}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-opacity disabled:opacity-40"
      >
        {busy ? "Setting up…" : "Use this template"}
      </button>

      {note && <p className="max-w-md text-center text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
