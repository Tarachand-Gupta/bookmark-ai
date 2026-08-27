import type { ReactNode } from "react";
import { Tile } from "./ui/tile";
import { BookmarkIcon, ExternalLinkIcon, LayersIcon, SettingsIcon } from "./ui/icons";
import { Spinner } from "./Spinner";

/**
 * While the live panel is expanded it owns the popup, so the four actions it
 * displaced collapse into this 4-up icon strip: same `Tile` primitive, `compact`
 * layout, 16px glyph over a 10px label. Nothing is lost — every action on the
 * default screen is still one click away.
 */
export function CompactStrip({
  saving,
  savingSession,
  savable,
  busy,
  tabCount,
  onSave,
  onSaveSession,
  onOpenApp,
  onOpenSettings,
}: {
  saving: boolean;
  savingSession: boolean;
  savable: boolean;
  busy: boolean;
  tabCount: number | null;
  onSave: () => void;
  onSaveSession: () => void;
  onOpenApp: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <div className="grid grid-cols-4 gap-2">
      <StripTile
        label="Save"
        onClick={onSave}
        disabled={!savable || busy}
        icon={saving ? <Spinner /> : <BookmarkIcon className="size-4" strokeWidth={1.8} />}
        title="Save this page"
      />
      <StripTile
        label="Session"
        onClick={onSaveSession}
        disabled={busy || !tabCount}
        icon={savingSession ? <Spinner /> : <LayersIcon className="size-4" strokeWidth={1.8} />}
        title="Save this window as a session"
      />
      <StripTile
        label="App"
        onClick={onOpenApp}
        icon={<ExternalLinkIcon className="size-4" strokeWidth={1.8} />}
        title="Open the web app"
      />
      <StripTile
        label="Settings"
        onClick={onOpenSettings}
        icon={<SettingsIcon className="size-4" strokeWidth={1.8} />}
        title="Open settings"
      />
    </div>
  );
}

function StripTile({
  label,
  icon,
  title,
  onClick,
  disabled,
}: {
  label: string;
  icon: ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Tile layout="compact" onClick={onClick} disabled={disabled} title={title} aria-label={title}>
      <span className="text-foreground">{icon}</span>
      <span className="text-[10px] font-medium text-muted-foreground">{label}</span>
    </Tile>
  );
}
