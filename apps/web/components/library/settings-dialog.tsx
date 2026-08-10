"use client";

import { useEffect, useRef, useState } from "react";
import { useClerk } from "@clerk/nextjs";
import {
  AlertTriangle,
  Database,
  Download,
  Loader2,
  Plug,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { deleteAccount, exportData, importData } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AiSetupCard } from "./ai-setup-card";
import { DevicesSection } from "./devices-settings";
import { FEATURE_ICONS } from "./feature-icons";
import { McpSection } from "./mcp-settings";
import { SettingsGroup, SettingsSection } from "./settings-section";
import { SyncSection } from "./sync-settings";

export interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Section to open on. Defaults to "ai"; the Ongoing empty state opens "devices". */
  initialSection?: SectionId;
}

/** Sections in the settings modal, in rail order. */
const SECTIONS = [
  { id: "ai", label: "AI", icon: Sparkles },
  { id: "data", label: "Data", icon: Database },
  { id: "sync", label: "Sync", icon: FEATURE_ICONS.bookmarks },
  { id: "devices", label: "Live sessions", icon: FEATURE_ICONS.live },
  { id: "mcp", label: "MCP", icon: Plug },
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
  const [section, setSection] = useState<SectionId>("ai");
  // Read at open time only, so re-renders that change the prop don't yank the
  // user off the section they navigated to.
  const initialSectionRef = useRef(initialSection);
  initialSectionRef.current = initialSection;
  const railRef = useRef<HTMLUListElement>(null);

  // Open-time reset: land on the requested section (each pane fetches its own
  // data when it mounts, so there's nothing else to (re)load here).
  useEffect(() => {
    if (!open) return;
    setSection(initialSectionRef.current ?? "ai");
  }, [open]);

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
      <DialogContent className="flex max-h-[92svh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
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
        <div className="flex min-h-0 min-w-0 flex-1 flex-col sm:flex-row [@media(min-width:640px)_and_(min-height:40rem)]:min-h-[27rem]">
          <nav
            aria-label="Settings sections"
            className="shrink-0 border-b bg-muted/30 p-3 sm:w-48 sm:border-r sm:border-b-0"
          >
            <DialogHeader className="px-2 pb-3 text-left">
              <DialogTitle className="text-base">Settings</DialogTitle>
            </DialogHeader>
            {/* Mobile: one scrollable strip of section chips (six full-width
                buttons stacked would eat the whole screen, and letting them
                shrink truncated every label). contain:inline-size keeps the
                strip's summed width from becoming the dialog's min-content
                width — see the min-w-0 note above. */}
            <ul
              ref={railRef}
              className="-mb-2 flex scroll-smooth gap-1 overflow-x-auto pb-2 [contain:inline-size] sm:mb-0 sm:flex-col sm:overflow-x-visible sm:pb-0 sm:[contain:none]"
            >
              {SECTIONS.map((s) => {
                const Icon = s.icon;
                return (
                  <li key={s.id} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => setSection(s.id)}
                      aria-current={section === s.id ? "page" : undefined}
                      className={cn(
                        "flex w-full items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-sm transition-colors",
                        section === s.id
                          ? "bg-accent font-medium text-accent-foreground"
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

          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">
            {/* The AI pane IS the shared card (free-credits callout, optional
                bring-your-own-provider form, test-&-list-models) — this pane used
                to duplicate the whole form inline, so a fix in one place silently
                left the other stale. */}
            {section === "ai" && (
              <SettingsSection
                title="AI"
                icon={Sparkles}
                description="Chat and search-by-meaning run on included free credits. Bring your own provider key to run chat unmetered on the model you pick."
              >
                {/* The card draws its own border/padding — it's the pane's single
                    block, so it doesn't need a SettingsGroup around it. */}
                <AiSetupCard />
              </SettingsSection>
            )}

            {section === "data" && <DataSection />}

            {section === "sync" && <SyncSection />}

            {section === "devices" && <DevicesSection />}

            {section === "mcp" && <McpSection />}

            {section === "account" && (
              <AccountSection onRequestClose={() => onOpenChange(false)} />
            )}
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
        {exportMsg && (
          <p className="text-sm text-emerald-600 dark:text-emerald-500">{exportMsg}</p>
        )}
        {exportError && <p className="text-sm text-destructive">{exportError}</p>}
      </SettingsGroup>

      <SettingsGroup
        divided
        title="Import"
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
              Import data
            </>
          )}
        </Button>
        {importMsg && (
          <p className="text-sm text-emerald-600 dark:text-emerald-500">{importMsg}</p>
        )}
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
  const { signOut, openUserProfile } = useClerk();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await deleteAccount();
      // Clear the Clerk session and land on the public home page.
      await signOut({ redirectUrl: "/" });
    } catch (e: unknown) {
      setError((e as Error).message);
      setDeleting(false);
    }
  };

  return (
    <SettingsSection
      title="Account"
      icon={UserRound}
      description="Manage your Bookmark AI account."
    >
      {/* Clerk's account manager, opened as ITS OWN modal rather than embedded in
          this pane. MEASURED (2026-08-11, dev Chrome, 1440x940):
          <UserProfile routing="hash"> inline renders a FIXED 880px card (228px
          internal nav rail + 661px content, 704px tall) that ignores
          `elements.cardBox: "w-full"` — Clerk's generated styles win — so in the
          ~574px pane it was clipped mid-word ("Add email a…") under a second nav
          rail and a second "Account" heading inside ours; fitting it needs a
          ~1120px dialog that still clips on any narrower window. Rendering the
          modal INSIDE the pane (Clerk's `getContainer`) is interactive but hits
          the same 880px-vs-574px clip, because DialogContent is
          `overflow-hidden`. So this hands the screen over instead: close Settings,
          then let Clerk's modal own the viewport — where it is neither clipped nor
          made inert by Radix's focus trap. */}
      <SettingsGroup
        title="Profile & security"
        description="Your name and avatar, email addresses, connected accounts, password, two-factor authentication and active devices — all managed by Clerk, themed to match the app."
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            onRequestClose();
            openUserProfile();
          }}
        >
          <UserRound aria-hidden />
          Manage profile &amp; security
        </Button>
      </SettingsGroup>

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
