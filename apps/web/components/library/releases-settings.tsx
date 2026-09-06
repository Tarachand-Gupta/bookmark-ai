"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Loader2, Pencil, Plus, Rocket, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { deleteAppRelease, getAppReleases, upsertAppRelease } from "@/lib/api";
import {
  APP_PLATFORMS,
  PLATFORM_LABELS,
  type AppPlatform,
  type AppRelease,
  type ReleaseDraft,
  type ReleaseDraftErrors,
  draftFromRelease,
  emptyReleaseDraft,
  formatPublished,
  toUpsertInput,
  validateReleaseDraft,
} from "@/lib/releases";
import { cn } from "@/lib/utils";
import { SettingsSection } from "./settings-section";

/** One line on what these records do — the section description. */
export const RELEASES_BLURB =
  "Native apps check this on launch and show an update banner when their version is older.";

export const ReleasesIcon = Rocket;

type ReleaseMap = Partial<Record<AppPlatform, AppRelease>>;

/**
 * Settings → Releases (ADMIN-ONLY, same gate as Observability; CONTRACT §12).
 * One card per platform: the current record or "Not set", an inline editor
 * (semver + https validated before the PUT), and "Clear" with a confirm step.
 * The web app never shows an update banner itself — this only administers
 * what the native apps read.
 */
export function ReleasesSection() {
  // undefined = loading
  const [releases, setReleases] = useState<ReleaseMap | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getAppReleases(controller.signal)
      .then((res) => setReleases(res.releases ?? {}))
      .catch((e: unknown) => {
        if ((e as Error).name !== "AbortError") setLoadError((e as Error).message);
      });
    return () => controller.abort();
  }, []);

  const replace = (platform: AppPlatform, next: AppRelease | null) =>
    setReleases((prev) => {
      const copy: ReleaseMap = { ...(prev ?? {}) };
      if (next) copy[platform] = next;
      else delete copy[platform];
      return copy;
    });

  return (
    <SettingsSection title="Releases" icon={ReleasesIcon} description={RELEASES_BLURB}>
      {loadError ? (
        <p className="text-sm text-destructive">Couldn’t load releases: {loadError}</p>
      ) : (
        <div className="space-y-3">
          {APP_PLATFORMS.map((platform) => (
            <ReleaseCard
              key={platform}
              platform={platform}
              release={releases === undefined ? undefined : (releases[platform] ?? null)}
              onChange={(next) => replace(platform, next)}
            />
          ))}
        </div>
      )}
    </SettingsSection>
  );
}

function ReleaseCard({
  platform,
  release,
  onChange,
}: {
  platform: AppPlatform;
  /** undefined = loading · null = not set */
  release: AppRelease | null | undefined;
  onChange: (next: AppRelease | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const label = PLATFORM_LABELS[platform];

  const clear = async () => {
    setClearing(true);
    setActionError(null);
    try {
      await deleteAppRelease(platform);
      onChange(null);
      setConfirmClear(false);
    } catch (e: unknown) {
      setActionError((e as Error).message);
    } finally {
      setClearing(false);
    }
  };

  return (
    <section
      data-release-card={platform}
      aria-labelledby={`release-${platform}-title`}
      className="rounded-lg border bg-card"
    >
      <header className="flex flex-wrap items-center gap-2 px-4 py-3">
        <h4 id={`release-${platform}-title`} className="text-sm font-medium">
          {label}
        </h4>
        {release === undefined ? (
          <Skeleton className="h-5 w-16 rounded-full" />
        ) : release ? (
          <span className="rounded-full border px-2 py-px font-mono text-[11px] tabular-nums">
            v{release.version}
            {release.build ? <span className="text-muted-foreground"> ({release.build})</span> : null}
          </span>
        ) : (
          <span className="rounded-full border border-dashed px-2 py-px text-[11px] text-muted-foreground">
            Not set
          </span>
        )}
        {release !== undefined && !editing && (
          <div className="ml-auto flex items-center gap-1">
            {release && !confirmClear && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => {
                  setActionError(null);
                  setConfirmClear(true);
                }}
              >
                <Trash2 aria-hidden />
                Clear…
              </Button>
            )}
            {!confirmClear && (
              <Button
                type="button"
                variant={release ? "ghost" : "outline"}
                size="sm"
                onClick={() => {
                  setActionError(null);
                  setEditing(true);
                }}
              >
                {release ? <Pencil aria-hidden /> : <Plus aria-hidden />}
                {release ? "Edit" : "Set up"}
              </Button>
            )}
          </div>
        )}
      </header>

      {confirmClear && release && (
        <div className="mx-4 mb-3 flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2.5">
          <p className="min-w-0 flex-1 text-xs">
            Clear the {label} record? Apps on any version stop seeing an update banner until you set
            one again.
          </p>
          <Button type="button" variant="destructive" size="sm" onClick={() => void clear()} disabled={clearing}>
            {clearing ? (
              <>
                <Loader2 className="animate-spin" aria-hidden />
                Clearing…
              </>
            ) : (
              "Clear record"
            )}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmClear(false)} disabled={clearing}>
            Cancel
          </Button>
        </div>
      )}

      {editing ? (
        <ReleaseForm
          platform={platform}
          initial={release ? draftFromRelease(release) : emptyReleaseDraft(platform)}
          isNew={!release}
          onCancel={() => setEditing(false)}
          onSaved={(saved) => {
            onChange(saved);
            setEditing(false);
          }}
        />
      ) : release ? (
        <dl className="grid gap-x-6 gap-y-2 border-t px-4 py-3 text-xs sm:grid-cols-2">
          <Row term="Version" value={release.version} mono />
          <Row term="Build" value={release.build ?? "—"} mono />
          <Row term="Min supported" value={release.minSupportedVersion ?? "—"} mono />
          <Row term="Published" value={formatPublished(release.publishedAt)} />
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">Download URL</dt>
            <dd className="mt-0.5 min-w-0">
              <a
                href={release.downloadUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex max-w-full items-center gap-1 font-medium underline-offset-2 hover:underline"
              >
                <span className="truncate">{release.downloadUrl}</span>
                <ExternalLink className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              </a>
            </dd>
          </div>
          {release.releaseNotes && (
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Notes</dt>
              <dd className="mt-0.5 whitespace-pre-wrap leading-relaxed [overflow-wrap:anywhere]">
                {release.releaseNotes}
              </dd>
            </div>
          )}
        </dl>
      ) : release === null ? (
        <p className="border-t px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          No record yet — {label} apps never see a banner until one is set.
        </p>
      ) : (
        <div className="space-y-2 border-t px-4 py-3">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-3 w-64" />
        </div>
      )}

      {actionError && <p className="px-4 pb-3 text-xs text-destructive">{actionError}</p>}
    </section>
  );
}

function Row({ term, value, mono }: { term: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className={cn("mt-0.5 truncate", mono && "font-mono tabular-nums")}>{value}</dd>
    </div>
  );
}

function ReleaseForm({
  platform,
  initial,
  isNew,
  onCancel,
  onSaved,
}: {
  platform: AppPlatform;
  initial: ReleaseDraft;
  isNew: boolean;
  onCancel: () => void;
  onSaved: (release: AppRelease) => void;
}) {
  const [draft, setDraft] = useState<ReleaseDraft>(initial);
  const [errors, setErrors] = useState<ReleaseDraftErrors>({});
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const id = (field: keyof ReleaseDraft) => `release-${platform}-${field}`;

  const set = <K extends keyof ReleaseDraft>(key: K, value: ReleaseDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setServerError(null);
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const submit = async () => {
    const found = validateReleaseDraft(draft);
    setErrors(found);
    if (Object.values(found).some(Boolean)) return;
    setSaving(true);
    setServerError(null);
    try {
      const { release } = await upsertAppRelease(platform, toUpsertInput(draft));
      onSaved(release);
    } catch (e: unknown) {
      setServerError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="space-y-3 border-t px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Version" htmlFor={id("version")} error={errors.version} hint="semver, e.g. 1.2.3">
          <Input
            id={id("version")}
            value={draft.version}
            onChange={(e) => set("version", e.target.value)}
            placeholder="1.2.3"
            inputMode="decimal"
            className="font-mono"
            aria-invalid={!!errors.version}
            autoFocus
          />
        </Field>
        <Field label="Build" htmlFor={id("build")} hint="optional tie-break">
          <Input
            id={id("build")}
            value={draft.build}
            onChange={(e) => set("build", e.target.value)}
            placeholder="2"
            className="font-mono"
          />
        </Field>
        <Field
          label="Min supported"
          htmlFor={id("minSupportedVersion")}
          error={errors.minSupportedVersion}
          hint="older builds see a blocking banner"
        >
          <Input
            id={id("minSupportedVersion")}
            value={draft.minSupportedVersion}
            onChange={(e) => set("minSupportedVersion", e.target.value)}
            placeholder="1.0.0"
            className="font-mono"
            aria-invalid={!!errors.minSupportedVersion}
          />
        </Field>
      </div>
      <Field label="Download URL" htmlFor={id("downloadUrl")} error={errors.downloadUrl} hint="https only">
        <Input
          id={id("downloadUrl")}
          value={draft.downloadUrl}
          onChange={(e) => set("downloadUrl", e.target.value)}
          placeholder="https://…"
          inputMode="url"
          aria-invalid={!!errors.downloadUrl}
        />
      </Field>
      <Field label="Release notes" htmlFor={id("releaseNotes")} hint="one or two lines — shown in the banner">
        <Textarea
          id={id("releaseNotes")}
          value={draft.releaseNotes}
          onChange={(e) => set("releaseNotes", e.target.value)}
          placeholder="Sidebar update banner, skills import."
          className="min-h-[4.5rem] resize-y text-sm"
        />
      </Field>

      {serverError && <p className="text-xs text-destructive">{serverError}</p>}

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="animate-spin" aria-hidden />
              Saving…
            </>
          ) : isNew ? (
            "Publish record"
          ) : (
            "Save changes"
          )}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="text-xs font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
