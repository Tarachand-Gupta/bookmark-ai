"use client";
import { useAccountDetails, useSettingsResource } from "./account-details-provider";
import { preloadAccountSecurity } from "@/lib/account-security-cache";
import { preloadSettingsResources, settingsResourceCache } from "@/lib/settings-resource-cache";

import { useEffect, useRef, useState } from "react";
import { useUser, getBrowserSupabase, signOut } from "@/lib/auth";
import { AccountSecurity } from "@/components/auth/account-security";
import { AccountSettingsRow } from "@/components/auth/account-settings-row";
import {
  Activity,
  Check,
  ChevronLeft,
  ChevronRight,
  X,
  Database,
  Download,
  Loader2,
  LogOut,
  Plug,
  Palette,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import type { ObservabilityResponse } from "@bookmark-ai/types";
import {
  deleteAccount,
  exportData,
  getAccount,
  getMe,
  importData,
} from "@/lib/api";
import { DEFAULT_PLAN, PLAN_FEATURES, type PlanId } from "@/lib/plan";
import { cn } from "@/lib/utils";
import { AiCreditsMeter } from "./ai-credits-meter";
import { AiSetupCard } from "./ai-setup-card";
import { DevicesSection, Switch } from "./devices-settings";
import { FEATURE_ICONS } from "./feature-icons";
import { McpSection } from "./mcp-settings";
import { ObservabilitySection } from "./observability-settings";
import { ReleasesIcon, ReleasesSection } from "./releases-settings";
import { SettingsGroup, SettingsRow, SettingsSection } from "./settings-section";
import { SkillsIcon, SkillsSection } from "./skills-settings";
import { SyncSection } from "./sync-settings";
import { ThemeChoices } from "@/components/theme-picker";
import { useFloatingAi } from "@/hooks/use-floating-ai";

export interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Explicit links open a detail pane. Otherwise mobile starts at the menu, desktop at AI. */
  initialSection?: SectionId;
}

/** Sections in the settings modal, in rail order. The "observability" section
 * is ADMIN-ONLY: it appears in the rail only after the admin-gated GET
 * succeeds (see the fetch in SettingsDialog). */
const SECTIONS = [
  { id: "ai", label: "AI", icon: Sparkles },
  { id: "skills", label: "Skills", icon: SkillsIcon },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "data", label: "Data", icon: Database },
  { id: "sync", label: "Sync", icon: FEATURE_ICONS.bookmarks },
  { id: "devices", label: "Live sessions", icon: FEATURE_ICONS.live },
  { id: "mcp", label: "Connections", icon: Plug },
  { id: "observability", label: "Observability", icon: Activity },
  // Same admin gate as Observability (CONTRACT §12).
  { id: "releases", label: "Releases", icon: ReleasesIcon },
  { id: "plan", label: "Plan & usage", icon: Activity },
  { id: "account", label: "Account", icon: UserRound },
] as const;
export type SectionId = (typeof SECTIONS)[number]["id"];

const MOBILE_GROUPS: { label: string; sections: SectionId[] }[] = [
  { label: "Preferences & account", sections: ["account", "appearance", "plan"] },
  { label: "AI & library", sections: ["ai", "skills", "data", "sync", "devices"] },
  { label: "Connections", sections: ["mcp"] },
  { label: "Administration", sections: ["observability", "releases"] },
];

/** All valid section ids — used to validate the `?settings=<id>` deep link. */
export const SECTION_IDS = SECTIONS.map((s) => s.id) as SectionId[];

/**
 * Settings modal. A left rail selects a section; each pane is its own component
 * that loads and saves its own slice of `user_settings` — this file owns only the
 * shell (rail, scroll pane, section state). The AI pane is the SHARED
 * `<AiSetupCard />`, the same surface the onboarding tour and the chat's
 * free-limit wall render, so there is exactly one AI form in the app.
 */
export function SettingsDialog({ open, onOpenChange, initialSection }: SettingsDialogProps) {
  const admin = useSettingsResource("observability", false);
  const accountId = admin.accountId;
  const [section, setSection] = useState<SectionId>("ai");
  // Read at open time only, so re-renders that change the prop don't yank the
  // user off the section they navigated to.
  const initialSectionRef = useRef(initialSection);
  initialSectionRef.current = initialSection;
  const [mobileDetail, setMobileDetail] = useState(!!initialSection);
  const menuRef = useRef<HTMLElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const { preferences, setPreference } = useFloatingAi();
  useEffect(() => {
    if (open) {
      setSection(initialSectionRef.current ?? "ai");
      setMobileDetail(!!initialSectionRef.current);
    }
  }, [open, accountId]);
  const paneRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (paneRef.current) paneRef.current.scrollTop = 0; }, [section]);

  // Every open rechecks the server permission. A cached admin payload alone
  // never grants access, and another identity cannot inherit the admin rail.
  const [adminGrant, setAdminGrant] = useState<{ accountId: string; data: ObservabilityResponse } | null>(null);
  const observability = open && admin.active && adminGrant?.accountId === accountId ? adminGrant.data : null;
  useEffect(() => {
    setAdminGrant(null);
    if (!open || !accountId || !admin.active) return;
    void preloadSettingsResources(accountId);
    void preloadAccountSecurity(accountId);
    let cancelled = false;
    const current = admin.isCurrent;
    void admin.refresh().then(data => {
      if (!cancelled && current() && data) {
        setAdminGrant({ accountId, data });
        void settingsResourceCache.read(accountId, "releases");
      }
    });
    return () => { cancelled = true; };
  }, [open, accountId, admin.active, admin.refresh]);

  const visibleSections = SECTIONS.filter(
    s => (s.id !== "observability" && s.id !== "releases") || observability !== null,
  );
  const selectSection = (id: SectionId) => {
    setSection(id);
    setMobileDetail(true);
    requestAnimationFrame(() => {
      if (backRef.current?.getClientRects().length) backRef.current.focus();
    });
  };
  const backToMenu = () => {
    setMobileDetail(false);
    requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>(`[data-settings-section="${section}"]`)?.focus());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="flex h-dvh max-h-dvh max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:max-w-none md:h-[min(720px,calc(100dvh-64px))] md:max-h-[calc(100dvh-64px)] md:max-w-3xl md:rounded-lg md:border">
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">
          Configure Bookmark AI, including appearance, your account and the AI provider.
        </DialogDescription>
        <div className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b px-2 pt-[env(safe-area-inset-top)] md:hidden">
          <div>
            {mobileDetail && (
              <Button ref={backRef} variant="ghost" className="h-12 gap-1 px-2" onClick={backToMenu}>
                <ChevronLeft aria-hidden className="size-4" />Back
              </Button>
            )}
          </div>
          <h2 className="py-4 text-base font-semibold">{mobileDetail ? SECTIONS.find(s => s.id === section)?.label : "Settings"}</h2>
          <Button variant="ghost" className="h-12 justify-self-end px-3" onClick={() => onOpenChange(false)}>Done</Button>
        </div>
        <Button variant="ghost" size="icon" aria-label="Close settings" className="absolute right-3 top-3 z-10 hidden size-8 md:flex" onClick={() => onOpenChange(false)}>
          <X aria-hidden className="size-4" />
        </Button>
        {/* Constrained flex children keep long panes scrollable at every width. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
          <nav ref={menuRef} aria-label="Settings sections" className={cn("min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain bg-muted/30 p-4 pb-[max(16px,env(safe-area-inset-bottom))] md:flex md:w-48 md:flex-none md:flex-col md:overflow-hidden md:border-r md:p-3", mobileDetail && "hidden")}>
            <h2 className="hidden shrink-0 px-2 pb-3 text-base font-semibold md:block">Settings</h2>
            <div className="space-y-6 md:hidden">
              {MOBILE_GROUPS.map(group => {
                const sections = group.sections.flatMap(id => visibleSections.filter(s => s.id === id));
                if (!sections.length) return null;
                return (
                  <section key={group.label} aria-label={group.label} className="space-y-2">
                    <h3 className="px-3 text-xs font-medium text-muted-foreground">{group.label}</h3>
                    <ul className="divide-y overflow-hidden rounded-xl border bg-background">
                      {sections.map(s => {
                        const Icon = s.icon;
                        return (
                          <li key={s.id}>
                            <button type="button" data-settings-section={s.id} onClick={() => selectSection(s.id)} className="flex min-h-12 w-full cursor-pointer items-center gap-3 px-3 py-3 text-left text-sm hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring">
                              <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                              <span className="flex-1">{s.label}</span>
                              <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
            </div>
            <ul className="hidden min-h-0 flex-1 flex-col gap-1 overflow-y-auto md:flex">
              {visibleSections.map(s => {
                const Icon = s.icon;
                return (
                  <li key={s.id} className="shrink-0">
                    <button type="button" onClick={() => selectSection(s.id)} aria-current={section === s.id ? "page" : undefined} className={cn(
                      "flex w-full cursor-pointer items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-sm transition-colors",
                      section === s.id ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground hover:bg-accent/50",
                    )}>
                      <Icon className="size-4" aria-hidden />{s.label}
                    </button>
                  </li>
                );
              })}
            </ul>
            <SettingsSignOut />
          </nav>
          <div key={`${accountId ?? "signed-out"}:${admin.active}`} ref={paneRef} className={cn("min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain p-4 pb-[max(16px,env(safe-area-inset-bottom))] md:block md:p-6", !mobileDetail && "hidden")}>
            {/* The AI pane IS the shared card (free-credits callout, optional
                bring-your-own-provider form, test-&-list-models) — this pane used
                to duplicate the whole form inline, so a fix in one place silently
                left the other stale. */}
            {section === "ai" && (
              <SettingsSection
                title="AI"
                icon={Sparkles}
                description="Choose included AI or connect your own provider for chat. Search by meaning is included."
              >
                {/* The card draws its own border/padding — it's the pane's single
                    block, so it doesn't need a SettingsGroup around it. */}
                <AiSetupCard />
              </SettingsSection>
            )}

            {section === "appearance" && (
              <SettingsSection title="Appearance" icon={Palette} description="Choose a theme and light, dark, or system appearance. Saved in this browser.">
                <ThemeChoices />
                <SettingsGroup divided title="Floating AI bar" description="Keep a shortcut to Ask AI at the bottom of your library. Saved in this browser.">
                  <SettingsRow label="Show on desktop" htmlFor="floating-ai-desktop" control={<Switch id="floating-ai-desktop" checked={preferences.desktop} onChange={value => setPreference("desktop", value)} />} />
                  <SettingsRow label="Show on mobile" htmlFor="floating-ai-mobile" control={<Switch id="floating-ai-mobile" checked={preferences.mobile} onChange={value => setPreference("mobile", value)} />} />
                </SettingsGroup>
              </SettingsSection>
            )}

            {section === "skills" && <SkillsSection />}

            {section === "data" && <DataSection />}

            {section === "sync" && <SyncSection />}

            {section === "devices" && <DevicesSection />}

            {section === "mcp" && <McpSection />}

            {/* Renders only when the admin probe succeeded, so a non-admin
                deep link shows nothing. Remounts per open (the dialog unmounts
                its content when closed), so `initial` is always this open's. */}
            {section === "releases" && observability && <ReleasesSection />}
            {section === "observability" && observability && (
              <ObservabilitySection initial={observability} />
            )}

            {section === "plan" && <SettingsSection title="Plan & usage" icon={Activity} description="Your plan and included AI usage."><PlanGroup /><UsageGroup /></SettingsSection>}
            {section === "account" && <AccountSection />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** One local-session exit, anchored outside the scrolling settings sections. */
function SettingsSignOut() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await signOut();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign out. Try again.");
      setBusy(false);
    }
  };
  return (
    <div className="mt-2 shrink-0 border-t pt-2 sm:mt-3 sm:pt-3">
      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void run()} className="w-full justify-start text-destructive hover:bg-destructive/10 hover:text-destructive">
        {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <LogOut aria-hidden className="size-4" />}
        {busy ? "Signing out…" : "Sign out"}
      </Button>
      {error && <p role="alert" className="px-2 pt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

/**
 * Data section: export the whole library to a JSON file, or import a previously
 * exported bundle back. Import merges by URL and preserves timestamps, so
 * re-importing the same file is a safe no-op (idempotent upsert).
 */
function DataSection() {
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const runExport = async () => {
    setExporting(true);
    setExportMsg(null);
    setExportError(null);
    try {
      const bundle = await exportData();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `bookmark-ai-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
      const { bookmarks, sessions } = bundle.counts;
      setExportMsg(
        `Exported ${bookmarks} bookmark${bookmarks === 1 ? "" : "s"} and ${sessions} session${
          sessions === 1 ? "" : "s"
        }.`,
      );
    } catch (e: unknown) {
      setExportError((e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input so re-selecting the same file fires change again.
    e.target.value = "";
    if (!file) return;
    setImporting(true);
    setImportMsg(null);
    setImportError(null);
    try {
      const text = await file.text();
      let bundle: unknown;
      try {
        bundle = JSON.parse(text);
      } catch {
        throw new Error("That file isn't a valid Bookmark AI export.");
      }
      const { imported } = await importData(bundle);
      setImportMsg(
        `Imported ${imported.bookmarks} bookmark${
          imported.bookmarks === 1 ? "" : "s"
        }, ${imported.sessions} session${imported.sessions === 1 ? "" : "s"}.`,
      );
    } catch (e: unknown) {
      setImportError((e as Error).message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <SettingsSection
      title="Data"
      icon={Database}
      description="Export a complete, portable copy of your library, or restore one back."
    >
      <SettingsGroup
        title="Export"
        description="Downloads every bookmark and session as a single JSON file."
      >
        <Button type="button" variant="outline" size="sm" onClick={runExport} disabled={exporting}>
          {exporting ? (
            <>
              <Loader2 className="animate-spin" aria-hidden />
              Exporting…
            </>
          ) : (
            <>
              <Download aria-hidden />
              Export data
            </>
          )}
        </Button>
        {exportMsg && <p className="text-sm text-emerald-600 dark:text-emerald-500">{exportMsg}</p>}
        {exportError && <p className="text-sm text-destructive">{exportError}</p>}
      </SettingsGroup>

      <SettingsGroup
        divided
        title="Restore backup"
        description="Merges an exported file by URL and keeps original timestamps — re-importing the same file is safe and won’t create duplicates."
      >
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={onFile}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileRef.current?.click()}
          disabled={importing}
        >
          {importing ? (
            <>
              <Loader2 className="animate-spin" aria-hidden />
              Importing…
            </>
          ) : (
            <>
              <Upload aria-hidden />
              Restore backup
            </>
          )}
        </Button>
        {importMsg && <p className="text-sm text-emerald-600 dark:text-emerald-500">{importMsg}</p>}
        {importError && <p className="text-sm text-destructive">{importError}</p>}
      </SettingsGroup>
    </SettingsSection>
  );
}

/** Account overview progressively reveals one task; sensitive actions retain their confirmations. */
function AccountSection() {
  const [activePanel, setActivePanel] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (activePanel !== "delete") {
      setConfirming(false);
      setError(null);
    }
  }, [activePanel]);

  const runDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await deleteAccount();
      // Clear the local session and land on the public home page.
      await getBrowserSupabase().auth.signOut({ scope: "local" });
      window.location.assign("/");
    } catch (e: unknown) {
      setError((e as Error).message);
      setDeleting(false);
    }
  };

  return (
    <SettingsSection
      title="Account"
      icon={UserRound}
      description="Manage your profile and account access."
      className="[&>header]:hidden md:[&>header]:block"
    >
      <IdentityGroup />

      <div className="overflow-hidden rounded-xl border">
        <AccountSecurity activePanel={activePanel} onPanelChange={setActivePanel} />
      </div>

      <AccountSettingsRow panel="delete" title="Delete account" icon={Trash2} activePanel={activePanel} onPanelChange={setActivePanel} disabled={deleting}>
        <p className="text-sm text-muted-foreground">Permanently delete your account and all bookmarks and sessions. This cannot be undone.</p>
        <div className="space-y-3">
            {!confirming ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => {
                  setError(null);
                  setConfirming(true);
                }}
              >
                <Trash2 aria-hidden />
                Delete account
              </Button>
            ) : (
              <>
                <p className="text-xs font-medium">
                  Are you sure? This is permanent and cannot be undone.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={runDelete}
                    disabled={deleting}
                  >
                    {deleting ? (
                      <>
                        <Loader2 className="animate-spin" aria-hidden />
                        Deleting…
                      </>
                    ) : (
                      "Yes, delete my account"
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirming(false)}
                    disabled={deleting}
                  >
                    Cancel
                  </Button>
                </div>
              </>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </AccountSettingsRow>
    </SettingsSection>
  );
}

/**
 * The plan block (CONTRACT §2): a "Free plan" badge and the plan's feature
 * lines, from the SAME `PLAN_FEATURES` the marketing pricing card renders, so
 * the two can't drift. `getAccount()` supplies the plan id and already falls
 * back to Free for a server that predates the field — everyone is on Free.
 */
function PlanGroup() {
  const details = useAccountDetails();
  const plan = details?.account?.plan ?? null;
  const info = PLAN_FEATURES[plan ?? DEFAULT_PLAN];

  return (
    <SettingsGroup title="Plan" description="What your account includes today.">
      {details?.errors.account && <p role="alert" className="text-sm text-destructive">Couldn’t refresh your plan. {details.errors.account} <button className="underline" onClick={details.refresh}>Try again</button></p>}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          {plan === null ? (
            <Skeleton className="h-5 w-20 rounded-full" />
          ) : (
            <Badge>{info.name} plan</Badge>
          )}
          <span className="text-xs text-muted-foreground">${info.price} · everything, today</span>
        </div>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {info.features.map((f) => (
            <li key={f.key} className="flex items-start gap-2 text-sm">
              <span
                aria-hidden
                className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-foreground/[0.07] dark:bg-foreground/[0.1]"
              >
                <Check className="size-2.5" strokeWidth={2.5} />
              </span>
              <span className="leading-5">{f.label}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Fair-use limits apply · Your data lives in your own database
        </p>
      </div>
    </SettingsGroup>
  );
}

type Identity = { name: string | null; email: string | null; imageUrl: string | null };

/** Signed-in identity is available from the session immediately; the server
 * profile fills gaps while refreshing. Avatar failures fall back to initials. */
function IdentityGroup() {
  const { isLoaded, isSignedIn, user } = useUser();
  const details = useAccountDetails();
  const me = details?.me;
  if (isLoaded && !isSignedIn) return null;

  const name = user?.fullName || me?.name || user?.username || null;
  const email = me?.email ?? user?.primaryEmailAddress?.emailAddress ?? null;
  const imageUrl = user?.hasImage ? user.imageUrl : null;
  const loading = !isLoaded && !name && !email;
  const initials = initialsFor(name, email);

  return (
    <SettingsGroup>
      {details?.errors.me && <p role="alert" className="text-sm text-destructive">Couldn’t refresh account details. Your signed-in profile is shown. <button className="underline" onClick={details.refresh}>Try again</button></p>}
      <div
        data-identity-row={loading ? "loading" : "ready"}
        className="flex items-center gap-3 px-1 py-2"
      >
        {loading ? (
          <>
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3 w-48" />
            </div>
          </>
        ) : (
          <>
            <Avatar className="size-10 border">
              <AvatarImage src={imageUrl ?? undefined} alt="" />
              <AvatarFallback className="text-sm font-semibold text-muted-foreground">{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium" title={name ?? undefined}>
                {name ?? email ?? "Signed in"}
              </p>
              {name && email && (
                <p className="truncate text-xs text-muted-foreground" title={email}>
                  {email}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </SettingsGroup>
  );
}

/** "Tara Gupta" → "TG"; "tara" → "T"; else the email's first letter; else "?". */
function initialsFor(name: string | null, email: string | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  if (parts.length === 1) return parts[0][0].toUpperCase();
  const e = (email ?? "").trim();
  return e ? e[0].toUpperCase() : "?";
}

function UsageGroup() {
  const details = useAccountDetails();
  const usage = details?.settings?.aiUsage;
  return <SettingsGroup title="Included AI" description="Usage refreshes in the background.">{usage ? <AiCreditsMeter usage={usage} /> : <p className="text-sm text-muted-foreground">{details?.errors.settings ? "Usage is temporarily unavailable." : "Checking usage…"}</p>}{details?.errors.settings && <Button variant="outline" size="sm" onClick={details.refresh}>Try again</Button>}</SettingsGroup>;
}
