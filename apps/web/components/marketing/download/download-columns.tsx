import { ArrowUpRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  WEB_APP_URL,
  getPlatform,
  type PlatformEntry,
  type PlatformIcon as PlatformIconName,
} from "@/lib/platforms";
import { PlatformActionButton } from "../platform-action";
import { PlatformIcon } from "../platform-icon";
import { StatusBadge } from "../status-badge";
import { btnOutline, display, glass, mono } from "../primitives";

const APP_IDS = ["macos", "android", "ios"] as const;
const EXTENSION_IDS = ["chrome", "firefox", "safari"] as const;

function WebFallback() {
  return (
    <a
      href={WEB_APP_URL}
      className={cn(btnOutline, "h-10 shrink-0 px-4")}
    >
      Use web app
      <ArrowUpRight className="size-4" aria-hidden />
    </a>
  );
}

function Availability({ entry }: { entry: PlatformEntry }) {
  if (entry.action.type !== "none") {
    return <PlatformActionButton entry={entry} compact />;
  }

  if (entry.id === "macos" || entry.id === "android") {
    return <WebFallback />;
  }

  return (
    <p className={cn(mono, "py-2 text-[11px] leading-4 text-muted-foreground")}>
      {entry.status === "review" ? "Marketplace review in progress" : "Marketplace release coming soon"}
    </p>
  );
}

function DownloadRow({ entry }: { entry: PlatformEntry }) {
  return (
    <article id={entry.id} className="scroll-mt-24 py-5 first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3.5">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-background/55">
            <PlatformIcon icon={entry.icon} className="size-5.5 text-foreground" />
          </span>
          <div className="min-w-0 pt-0.5">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <h3 className="min-w-0 [overflow-wrap:anywhere] text-[0.96rem] font-semibold tracking-[-0.01em] text-foreground">
                {entry.name}
              </h3>
              {entry.badge && <StatusBadge status={entry.status}>{entry.badge}</StatusBadge>}
            </div>
            <p className="mt-1 max-w-md text-sm leading-5 text-muted-foreground">{entry.blurb}</p>
          </div>
        </div>
        <div className="shrink-0 pl-[3.625rem] sm:max-w-[13.5rem] sm:pl-0">
          <Availability entry={entry} />
        </div>
      </div>
    </article>
  );
}

function WebPlatformRow({
  icon,
  name,
  description,
}: {
  icon: PlatformIconName;
  name: string;
  description: string;
}) {
  return (
    <article className="flex min-w-0 flex-col gap-4 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3.5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-background/55">
          <PlatformIcon icon={icon} className="size-5 text-foreground" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{name}</h3>
          <p className="mt-0.5 text-sm leading-5 text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="shrink-0 pl-[3.375rem] sm:pl-0">
        <WebFallback />
      </div>
    </article>
  );
}

function PwaGuide() {
  return (
    <details className="group mt-5 rounded-xl border border-border/70 bg-background/35 open:bg-background/55">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0 focus-visible:ring-offset-background active:bg-accent [&::-webkit-details-marker]:hidden">
        <span>Install the web app</span>
        <ChevronDown
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
          aria-hidden
        />
      </summary>
      <div className="border-t border-border/60 px-4 pb-4 pt-3">
        <ul className="space-y-3 text-sm leading-6 text-muted-foreground">
          <li>
            <strong className="font-medium text-foreground">iPhone or iPad · Safari:</strong>{" "}
            open Bookmark AI, tap Share, then Add to Home Screen.
          </li>
          <li>
            <strong className="font-medium text-foreground">Android · Chrome:</strong>{" "}
            open the browser menu, then tap Install app or Add to Home screen.
          </li>
          <li>
            <strong className="font-medium text-foreground">Mac · Safari:</strong>{" "}
            choose File, then Add to Dock.
          </li>
          <li>
            <strong className="font-medium text-foreground">Chrome or Edge · desktop:</strong>{" "}
            open Bookmark AI, select the install icon in the address bar, and confirm.
          </li>
        </ul>
      </div>
    </details>
  );
}

function ColumnHeader({
  id,
  label,
  title,
  description,
}: {
  id: string;
  label: string;
  title: string;
  description: string;
}) {
  return (
    <header className="border-b border-border/60 pb-5">
      <p className={cn(mono, "text-[10.5px] font-medium uppercase tracking-[0.2em] text-muted-foreground")}>
        {label}
      </p>
      <h2 id={id} className={cn(display, "mt-2 min-w-0 [overflow-wrap:anywhere] text-2xl font-semibold tracking-[-0.02em]")}>
        {title}
      </h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
    </header>
  );
}

export function DownloadColumns() {
  const apps = APP_IDS.map(getPlatform);
  const extensions = EXTENSION_IDS.map(getPlatform);

  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
      <section aria-labelledby="apps-heading" className={cn(glass, "min-w-0 rounded-2xl p-5 sm:p-7")}>
        <div>
          <ColumnHeader
            id="apps-heading"
            label="For your devices"
            title="Apps"
            description="Native releases are being refreshed. The web app is ready now and installs cleanly on phones and desktops."
          />
        </div>

        <div className="divide-y divide-border/60 py-5">
          {apps.map((entry) => (
            <DownloadRow key={entry.id} entry={entry} />
          ))}
        </div>

        <div id="web" className="scroll-mt-24 border-t border-border/60 pt-5">
          <p className={cn(mono, "mb-4 text-[10.5px] font-medium uppercase tracking-[0.2em] text-muted-foreground")}>
            Windows &amp; Linux
          </p>
          <div className="divide-y divide-border/60">
            <WebPlatformRow
              icon="windows"
              name="Windows"
              description="Use Bookmark AI as an installable web app in Chrome or Edge."
            />
            <WebPlatformRow
              icon="linux"
              name="Linux"
              description="Use the web app in Chrome or Edge, or keep it pinned in your browser."
            />
          </div>
          <PwaGuide />
        </div>
      </section>

      <section aria-labelledby="extensions-heading" className={cn(glass, "min-w-0 rounded-2xl p-5 sm:p-7")}>
        <div>
          <ColumnHeader
            id="extensions-heading"
            label="For your browser"
            title="Extensions"
            description="Install from the browser marketplace. Chrome is available now; Firefox is in review and Safari follows with the Mac release."
          />
        </div>
        <div className="divide-y divide-border/60 py-5">
          {extensions.map((entry) => (
            <DownloadRow key={entry.id} entry={entry} />
          ))}
        </div>
        <p className="border-t border-border/60 pt-5 text-xs leading-5 text-muted-foreground">
          Marketplace versions update automatically. Choose Sign in in the extension popup to authorize its separate session in your browser.
        </p>
      </section>
    </div>
  );
}
