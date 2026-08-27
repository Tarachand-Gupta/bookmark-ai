import { IconButton } from "./ui/button";
import { LaptopIcon, SettingsIcon } from "./ui/icons";

/**
 * The default screen's last, quietest row: which device this popup is speaking
 * for, and the way into the web app's settings. No top border — the whitespace
 * is the separation, and a rule there made the popup read as three stacked
 * panels instead of one column.
 *
 * The gear keeps the existing deep link (`/app?settings=devices`).
 */
export function DeviceFooter({
  deviceLabel,
  onOpenSettings,
}: {
  deviceLabel: string;
  onOpenSettings: () => void;
}) {
  return (
    <footer className="flex items-center gap-1.5 pt-0.5">
      <LaptopIcon className="size-[13px] text-muted-foreground" />
      <span className="min-w-0 truncate text-[11px] text-muted-foreground">
        {deviceLabel || "This device"}
      </span>
      <IconButton
        onClick={onOpenSettings}
        title="Settings"
        aria-label="Settings"
        className="ml-auto"
      >
        <SettingsIcon className="size-3.5" />
      </IconButton>
    </footer>
  );
}
