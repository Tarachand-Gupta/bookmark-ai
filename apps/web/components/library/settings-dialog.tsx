"use client";
import { useAccountDetails, useSettingsResource } from "./account-details-provider";
import { preloadAccountSecurity } from "@/lib/account-security-cache";
import { preloadSettingsResources, settingsResourceCache } from "@/lib/settings-resource-cache";
import { ImportBookmarksDialog } from "./import-bookmarks-dialog";

import { useEffect, useRef, useState } from "react";
import { useUser, getBrowserSupabase } from "@/lib/auth";
import { AccountSecurity } from "@/components/auth/account-security";
import {
  Activity,
  AlertTriangle,
  Check,
  Database,
  Download,
  Loader2,
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
import { DevicesSection } from "./devices-settings";
import { FEATURE_ICONS } from "./feature-icons";
import { McpSection } from "./mcp-settings";
import { ObservabilitySection } from "./observability-settings";
import { ReleasesIcon, ReleasesSection } from "./releases-settings";
import { SettingsGroup, SettingsSection } from "./settings-section";
import { SkillsIcon, SkillsSection } from "./skills-settings";
import { SyncSection } from "./sync-settings";
import { ThemeChoices } from "@/components/theme-picker";

export interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Section to open on. Defaults to "ai"; the Ongoing empty state opens "devices". */
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
  const railRef = useRef<HTMLUListElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (paneRef.current) paneRef.current.scrollTop = 0; }, [section]);

  // Every open rechecks the server permission. A cached admin payload alone
  // never grants access, and another identity cannot inherit the admin rail.
  const [adminGrant, setAdminGrant] = useState<{ accountId: string; data: ObservabilityResponse } | null>(null);
  const observability = open && admin.active && adminGrant?.accountId === accountId ? adminGrant.data : null;
  useEffect(() => {
    setAdminGrant(null);
    if (!open || !accountId || !admin.active) return;
    setSection(initialSectionRef.current ?? "ai");
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

  // MOBILE: keep the ACTIVE section chip on screen. The rail is one horizontally
  // scrollable strip on narrow screens, and every deep link that opens the dialog
  // straight onto a later section (?settings=mcp, the sidebar's MCP row, the MCP
  // promo CTA) left the strip parked at scrollLeft 0 — so the selected chip sat
  // off-screen to the right and the visible chips all looked unselected, reading
  // as "nothing is selected" on top of a section the user didn't ask for.
  // Runs on open AND on every section change (including clicks, which is how a
  // chip half-off the right edge finishes scrolling itself into view).
  // `block: "nearest"` keeps this from scrolling the dialog vertically; the strip
  // is the only scrollable ancestor on the inline axis, so nothing else moves.
  useEffect(() => {
    if (!open) return;
    railRef.current
      ?.querySelector<HTMLElement>('[aria-current="page"]')
      ?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [open, section]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* max-h + a scrollable pane (below) instead of a taller-than-viewport
          dialog: at 390px the MCP and Live-sessions sections are far longer than
          the screen.
          `flex flex-col` is load-bearing and overrides DialogContent's own
          `grid`: a grid container's auto row is sized from its item's
          min-content HEIGHT and never shrinks to a max-height, so the row grew
          to the full ~900px of the MCP section, `overflow-hidden` clipped it,
          and the pane below never had a reason to scroll — the Tokens and
          Client-setup blocks were simply unreachable. As a flex column the
          single row IS the constrained box (`flex-1 min-h-0`), so the pane's
          own overflow-y takes over. */}
      {/* sm:max-w-3xl (was 2xl): 672px minus the 12rem rail and the pane padding
          left only ~430px of content, which is where the AI card's rows, the MCP
          setup commands and the device list were all wrapping. 768px gives the
          pane ~574px — measured — and stays well inside a 1024px laptop. */}
      <DialogContent className="flex h-[calc(100dvh-32px)] max-h-[calc(100dvh-32px)] flex-col gap-0 overflow-hidden p-0 sm:h-[min(720px,calc(100dvh-64px))] sm:max-w-3xl">
        <DialogDescription className="sr-only">
          Configure Bookmark AI, including the AI provider and default model.
        </DialogDescription>
        {/* min-w-0 is load-bearing: DialogContent is a GRID container, and a grid
            item's automatic minimum size is its min-content width — so without
            it the widest thing in any section (a 259-char token, a
            claude-mcp-add command) sets the dialog's width and pushes its own
            buttons outside the clipped 672px box. Every child of this row needs
            the same reset, or the min-content width just propagates one level
            down. */}
        {/* flex-1 + min-h-0: this row is the dialog's only flex child, so it
            takes the clamped height and lets its scroll pane (not the page)
            absorb a long section. The 27rem floor — which keeps the desktop
            dialog from resizing every time you switch sections — is gated on
            the viewport being TALL enough to spare it, because a min-height
            beats a max-height in CSS and would re-break scrolling on a short
            landscape window. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col sm:flex-row">
          <nav
            aria-label="Settings sections"
            className="flex min-h-0 shrink-0 flex-col border-b bg-muted/30 p-3 sm:w-48 sm:border-r sm:border-b-0"
          >
            <DialogHeader className="shrink-0 px-2 pb-3 text-left">
              <DialogTitle className="text-base">Settings</DialogTitle>
            </DialogHeader>
            {/* Mobile: one scrollable strip of section chips (six full-width
                buttons stacked would eat the whole screen, and letting them
                shrink truncated every label). contain:inline-size keeps the
                strip's summed width from becoming the dialog's min-content
                width — see the min-w-0 note above. */}
            <ul
              ref={railRef}
              className="-mb-2 flex min-h-0 scroll-smooth gap-1 overflow-x-auto pb-2 [contain:inline-size] sm:mb-0 sm:flex-col sm:overflow-x-hidden sm:overflow-y-auto sm:pb-0 sm:[contain:none]"
            >
              {SECTIONS.filter(
                (s) => (s.id !== "observability" && s.id !== "releases") || observability !== null,
              ).map((s) => {
                const Icon = s.icon;
                return (
                  <li key={s.id} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => setSection(s.id)}
                      aria-current={section === s.id ? "page" : undefined}
                      className={cn(
                        "cursor-pointer flex w-full items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-sm transition-colors",
                        // ACTIVE = the app's standard selected-chip treatment
                        // (`bg-primary`/`text-primary-foreground`, same as the tag
                        // rail, the mobile filter chips and the date-range presets).
                        // It was `bg-accent`, which in dark mode is
                        // oklch(0.269 0 0) — a ~2% lift off the dialog's own
                        // surface, so on a phone the selected chip was
                        // indistinguishable from the unselected ones. `primary`
                        // flips per theme (near-white on dark, near-black on
                        // light), so this reads as the white accent in dark mode
                        // without hardcoding a color.
                        section === s.id
                          ? "bg-primary font-medium text-primary-foreground"
                          : "text-muted-foreground hover:bg-accent/50",
                      )}
                    >
                      <Icon className="size-4" aria-hidden />
                      {s.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div key={`${accountId ?? "signed-out"}:${admin.active}`} ref={paneRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
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
            {section === "account" && <AccountSection onRequestClose={() => onOpenChange(false)} />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
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
  const [linksImportOpen, setLinksImportOpen] = useState(false);
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
        title="Import existing links"
        description="Preview links from browser exports, reading lists or notes files before importing."
      >
        <Button variant="outline" size="sm" onClick={() => setLinksImportOpen(true)}>Import existing links</Button>
        <ImportBookmarksDialog open={linksImportOpen} onOpenChange={setLinksImportOpen} onImported={() => window.dispatchEvent(new Event("bookmark-library-changed"))} />
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

/**
 * Account section: ONE account surface. Everything account-shaped is reachable
 * from here — Clerk's account manager (profile, email addresses, connected
 * accounts, password, 2FA, active devices) behind one button, then our own
 * permanent account-deletion flow, which is required by the app stores and is the
 * one thing Clerk's UI can't do because it also has to wipe this account's
 * bookmarks/sessions DB. A two-step confirm guards it; on success it signs the
 * user out and sends them to the marketing home.
 *
 * The header avatar's "Manage account" lands HERE (see LibraryHeader's
 * `userProfileMode="navigation"`) instead of opening Clerk's modal on its own, so
 * the avatar menu and the Settings dialog agree on where "account" lives.
 */
function AccountSection({ onRequestClose }: { onRequestClose: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await deleteAccount();
      // Clear the Clerk session and land on the public home page.
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
      description="Your profile, sign-in methods, and account security."
    >
      <IdentityGroup />

      <AccountSecurity />

      <SettingsGroup
        divided
        title="Delete account"
        description="This permanently deletes your account and all of your bookmarks and sessions. This cannot be undone."
      >
        {/* The group's title + description above ARE the old in-box heading and
            warning copy, so the box itself now carries only the glyph and the
            action — same words, one heading level less. */}
        <div className="flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
          <AlertTriangle className="mt-1 size-4 shrink-0 text-destructive" aria-hidden />
          <div className="min-w-0 flex-1 space-y-2">
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
                <div className="flex items-center gap-2">
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
        </div>
      </SettingsGroup>
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
    <SettingsGroup title="Signed in as" description="The account this library belongs to.">
      {details?.errors.me && <p role="alert" className="text-sm text-destructive">Couldn’t refresh account details. Your signed-in profile is shown. <button className="underline" onClick={details.refresh}>Try again</button></p>}
      <div
        data-identity-row={loading ? "loading" : "ready"}
        className="flex items-center gap-3 rounded-lg border bg-card p-3"
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
