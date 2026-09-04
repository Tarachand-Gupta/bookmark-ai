"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2, Pencil, Plus, Trash2, Upload, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createSkill, deleteSkill, listSkills, updateSkill } from "@/lib/api";
import {
  SKILL_FILE_ACCEPT,
  SKILL_IMPORT_COPY,
  draftFromMarkdown,
  skillFileError,
} from "@/lib/skill-markdown";
import {
  EMPTY_SKILL_DRAFT,
  SKILL_LIMITS,
  SKILL_TEMPLATES,
  SKILLS_CHANGED_EVENT,
  type Skill,
  type SkillDraft,
  type SkillDraftErrors,
  type SkillTemplate,
  draftFromSkill,
  draftFromTemplate,
  sortSkills,
  toSkillInput,
  validateSkillDraft,
} from "@/lib/skills";
import { cn } from "@/lib/utils";
import { Switch } from "./devices-settings";
import { SettingsSection } from "./settings-section";

/** The one-line definition, shared by the Settings pane and the chat dialog. */
export const SKILLS_BLURB = "Reusable instructions Ask AI follows when they fit your request.";

/** The glyph for Skills everywhere (settings rail, chat menu, empty state). */
export const SkillsIcon = WandSparkles;

/**
 * Settings → Skills. The manager below is the whole pane; this wrapper only
 * supplies the section chrome so it lines up with the other panes.
 */
export function SkillsSection() {
  return (
    <SettingsSection
      title="Skills"
      icon={SkillsIcon}
      description={`${SKILLS_BLURB} Describe in one line when a skill applies; Ask AI reads that line, picks the skill, and follows its instructions for the rest of the turn.`}
    >
      <SkillsManager />
    </SettingsSection>
  );
}

/**
 * The same manager in a dialog — opened from the Ask AI header's ⋯ menu so a
 * skill can be added mid-conversation without leaving the chat.
 */
export function SkillsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88svh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-6 py-4 text-left">
          <DialogTitle className="flex items-center gap-2 text-base">
            <SkillsIcon className="size-4 text-muted-foreground" aria-hidden />
            Skills
          </DialogTitle>
          <DialogDescription>{SKILLS_BLURB}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <SkillsManager />
        </div>
      </DialogContent>
    </Dialog>
  );
}

type EditorState =
  | {
      mode: "create";
      draft: SkillDraft;
      template?: SkillTemplate;
      importedFrom?: string;
      /** Non-fatal parser adjustments (e.g. a description shortened to fit). */
      importWarnings?: string[];
    }
  | { mode: "edit"; skill: Skill; draft: SkillDraft };

const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

/**
 * List + create/edit/delete for the user's skills. Loads its own data (like
 * every settings pane), edits optimistically where the failure mode is cheap
 * (the enabled switch) and pessimistically where it isn't (delete waits for
 * the server before the row goes). Nothing here knows whether it's inside the
 * Settings dialog or the chat's dialog.
 */
export function SkillsManager({ className }: { className?: string }) {
  // null = loading; [] = loaded, empty.
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const { skills: list } = await listSkills();
      setSkills(sortSkills(list));
      setLoadError(null);
    } catch (e: unknown) {
      setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    listSkills()
      .then(({ skills: list }) => {
        if (!cancelled) setSkills(sortSkills(list));
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError((e as Error).message);
      });
    // Ask AI's createSkill / installSkill add rows behind our back.
    const onChanged = () => {
      if (!cancelled) void load();
    };
    window.addEventListener(SKILLS_CHANGED_EVENT, onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(SKILLS_CHANGED_EVENT, onChanged);
    };
  }, [load]);

  // ── Import a SKILL.md / .txt (CONTRACT §3b): parse client-side, then open
  // the editor PREFILLED so the user reviews before anything is saved.
  const importFile = async (file: File) => {
    setImportError(null);
    setActionError(null);
    const gate = skillFileError(file);
    if (gate) {
      setImportError(`“${file.name}”: ${gate}`);
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      setImportError(SKILL_IMPORT_COPY.unreadable);
      return;
    }
    const result = draftFromMarkdown(text);
    if ("error" in result) {
      setImportError(`“${file.name}”: ${result.error}`);
      return;
    }
    setEditor({
      mode: "create",
      draft: result.draft,
      importedFrom: file.name,
      importWarnings: result.warnings,
    });
  };

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void importFile(file);
  };

  // Drag-and-drop onto the list. The depth counter keeps the highlight steady
  // while the pointer crosses child elements.
  const onDragEnter = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };
  const onDrop = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void importFile(file);
  };

  const upsert = (skill: Skill) => {
    setSkills((prev) => sortSkills([skill, ...(prev ?? []).filter((s) => s.id !== skill.id)]));
  };

  const toggleEnabled = async (skill: Skill, enabled: boolean) => {
    setActionError(null);
    // Optimistic: flip locally, revert if the PUT fails.
    setSkills((prev) => (prev ?? []).map((s) => (s.id === skill.id ? { ...s, enabled } : s)));
    setBusyId(skill.id);
    try {
      const { skill: updated } = await updateSkill(skill.id, { enabled });
      upsert(updated);
    } catch (e: unknown) {
      setActionError((e as Error).message);
      setSkills((prev) =>
        (prev ?? []).map((s) => (s.id === skill.id ? { ...s, enabled: skill.enabled } : s)),
      );
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (skill: Skill) => {
    setActionError(null);
    setBusyId(skill.id);
    try {
      await deleteSkill(skill.id);
      setSkills((prev) => (prev ?? []).filter((s) => s.id !== skill.id));
    } catch (e: unknown) {
      setActionError((e as Error).message);
    } finally {
      setBusyId(null);
      setConfirmDeleteId(null);
    }
  };

  const startCreate = (template?: SkillTemplate) =>
    setEditor({
      mode: "create",
      draft: template ? draftFromTemplate(template) : EMPTY_SKILL_DRAFT,
      template,
    });

  const enabledCount = skills?.filter((s) => s.enabled).length ?? 0;

  return (
    <div className={cn("space-y-3", className)}>
      {/* Toolbar: count on the left, the two ways to add on the right. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {skills === null
            ? "Loading…"
            : skills.length === 0
              ? "No skills yet"
              : `${skills.length} skill${skills.length === 1 ? "" : "s"} · ${enabledCount} enabled`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept={SKILL_FILE_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-label="Import a skill file"
            onChange={onPickFile}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            title="Import a SKILL.md or .txt file"
            onClick={() => fileInput.current?.click()}
          >
            <Upload aria-hidden />
            Import file…
          </Button>
          <TemplateMenu onPick={startCreate} />
          <Button type="button" size="sm" onClick={() => startCreate()}>
            <Plus aria-hidden />
            New skill
          </Button>
        </div>
      </div>

      <div
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        data-dragging={dragging || undefined}
        className={cn(
          "relative rounded-lg transition-shadow",
          dragging && "ring-2 ring-ring ring-offset-2 ring-offset-background",
        )}
      >
      {loadError ? (
        <p className="text-sm text-destructive">Couldn’t load skills: {loadError}</p>
      ) : skills === null ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Loading…
        </div>
      ) : skills.length === 0 ? (
        <EmptyState onPick={startCreate} onImport={() => fileInput.current?.click()} />
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border">
          {skills.map((skill) => {
            const busy = busyId === skill.id;
            const confirming = confirmDeleteId === skill.id;
            const switchId = `skill-enabled-${skill.id}`;
            return (
              <li
                key={skill.id}
                className={cn(
                  "flex items-start gap-3 px-3 py-3 transition-colors hover:bg-muted/40",
                  !skill.enabled && "bg-muted/20",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <label
                      htmlFor={switchId}
                      className={cn(
                        "cursor-pointer truncate text-sm font-medium",
                        !skill.enabled && "text-muted-foreground",
                      )}
                    >
                      {skill.name}
                    </label>
                    {!skill.enabled && (
                      <span className="shrink-0 rounded-full border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        off
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                    {skill.description}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1 pt-0.5">
                  {confirming ? (
                    <>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => void remove(skill)}
                        disabled={busy}
                      >
                        {busy ? (
                          <>
                            <Loader2 className="animate-spin" aria-hidden />
                            Deleting…
                          </>
                        ) : (
                          "Delete"
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmDeleteId(null)}
                        disabled={busy}
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <Switch
                        id={switchId}
                        checked={skill.enabled}
                        disabled={busy}
                        onChange={(next) => void toggleEnabled(skill, next)}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Edit ${skill.name}`}
                        title="Edit"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => setEditor({ mode: "edit", skill, draft: draftFromSkill(skill) })}
                      >
                        <Pencil aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete ${skill.name}`}
                        title="Delete"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          setActionError(null);
                          setConfirmDeleteId(skill.id);
                        }}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {dragging && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 rounded-lg bg-background/85 text-sm font-medium backdrop-blur-[1px]">
          <Upload className="size-4" aria-hidden />
          Drop a SKILL.md to import
        </div>
      )}
      </div>

      {importError && (
        <p role="alert" className="text-sm text-destructive [overflow-wrap:anywhere]">
          {importError}
        </p>
      )}
      {actionError && <p className="text-sm text-destructive">{actionError}</p>}

      <p className="text-xs text-muted-foreground">
        Tip: you can also ask Ask AI to create or install a skill for you.
      </p>

      {editor && (
        <SkillEditorDialog
          state={editor}
          onClose={() => setEditor(null)}
          onSaved={(skill) => {
            upsert(skill);
            setEditor(null);
          }}
        />
      )}
    </div>
  );
}

/** "Start from a template ▾" — the three starters, client-side only. */
function TemplateMenu({ onPick }: { onPick: (template: SkillTemplate) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          Start from a template
          <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Edit anything before saving
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {SKILL_TEMPLATES.map((t) => (
          <DropdownMenuItem
            key={t.id}
            onSelect={() => onPick(t)}
            className="flex-col items-start gap-0.5 py-2"
          >
            <span className="text-sm font-medium">{t.name}</span>
            <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {t.description}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** First-run state: what a skill is, and the three starters as one-click chips. */
function EmptyState({
  onPick,
  onImport,
}: {
  onPick: (template?: SkillTemplate) => void;
  onImport: () => void;
}) {
  return (
    <div className="rounded-lg border border-dashed px-6 py-8 text-center">
      <span className="mx-auto flex size-10 items-center justify-center rounded-full bg-muted">
        <SkillsIcon className="size-5 text-muted-foreground" aria-hidden />
      </span>
      <p className="mt-3 text-sm font-medium">No skills yet</p>
      <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
        Save the instructions you keep repeating — how you want a weekly digest written, what a
        research brief should contain — and Ask AI applies them whenever a request fits.
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {SKILL_TEMPLATES.map((t) => (
          <Button key={t.id} type="button" variant="outline" size="sm" onClick={() => onPick(t)}>
            {t.name}
          </Button>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Pick a starter to edit,{" "}
        <button
          type="button"
          onClick={() => onPick()}
          className="cursor-pointer font-medium text-foreground underline-offset-2 hover:underline"
        >
          write one from scratch
        </button>
        , or{" "}
        <button
          type="button"
          onClick={onImport}
          className="cursor-pointer font-medium text-foreground underline-offset-2 hover:underline"
        >
          import a SKILL.md
        </button>
        .
      </p>
    </div>
  );
}

/**
 * Create / edit dialog. Validates locally with the same rules the server
 * enforces (so the user sees the problem next to the field), and shows a
 * server rejection — the 409 duplicate-name case — inline under the form.
 */
function SkillEditorDialog({
  state,
  onClose,
  onSaved,
}: {
  state: EditorState;
  onClose: () => void;
  onSaved: (skill: Skill) => void;
}) {
  const [draft, setDraft] = useState<SkillDraft>(state.draft);
  const [errors, setErrors] = useState<SkillDraftErrors>({});
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const isEdit = state.mode === "edit";
  const set = <K extends keyof SkillDraft>(key: K, value: SkillDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setServerError(null);
    if (errors[key as keyof SkillDraftErrors]) {
      setErrors((e) => ({ ...e, [key]: undefined }));
    }
  };

  const submit = async () => {
    const found = validateSkillDraft(draft);
    setErrors(found);
    if (Object.values(found).some(Boolean)) return;
    setSaving(true);
    setServerError(null);
    try {
      const input = toSkillInput(draft);
      const { skill } =
        state.mode === "edit"
          ? await updateSkill(state.skill.id, input)
          : await createSkill(input);
      onSaved(skill);
    } catch (e: unknown) {
      setServerError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const instructionsLength = draft.instructions.length;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90svh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="border-b px-6 py-4 text-left">
          <DialogTitle className="text-base">{isEdit ? "Edit skill" : "New skill"}</DialogTitle>
          <DialogDescription>
            {state.mode === "create" && state.importedFrom
              ? `Imported from “${state.importedFrom}” — review the fields, then save.`
              : state.mode === "create" && state.template
                ? `Starting from the “${state.template.name}” template — edit anything before saving.`
                : "Ask AI reads the description to decide when this skill fits, then follows the instructions."}
          </DialogDescription>
        </DialogHeader>

        <form
          className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {state.mode === "create" && state.importWarnings?.length ? (
            <ul
              role="status"
              className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed"
            >
              {state.importWarnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
          <Field label="Name" htmlFor="skill-name" error={errors.name}>
            <Input
              id="skill-name"
              value={draft.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Weekly reading digest"
              maxLength={SKILL_LIMITS.name.max}
              aria-invalid={!!errors.name}
              autoFocus={!isEdit}
            />
          </Field>

          <Field
            label="Description"
            htmlFor="skill-description"
            hint="One line — this is how Ask AI decides when to use it."
            error={errors.description}
          >
            <Input
              id="skill-description"
              value={draft.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Summarise what I saved this week into a short digest."
              maxLength={SKILL_LIMITS.description.max}
              aria-invalid={!!errors.description}
            />
          </Field>

          <Field
            label="Instructions"
            htmlFor="skill-instructions"
            hint="What Ask AI should do once this skill applies. Markdown is fine."
            error={errors.instructions}
            trailing={
              <span
                className={cn(
                  "tabular-nums text-[11px] text-muted-foreground",
                  instructionsLength > SKILL_LIMITS.instructions.max && "text-destructive",
                )}
              >
                {instructionsLength.toLocaleString("en-US")} /{" "}
                {SKILL_LIMITS.instructions.max.toLocaleString("en-US")}
              </span>
            }
          >
            <Textarea
              id="skill-instructions"
              value={draft.instructions}
              onChange={(e) => set("instructions", e.target.value)}
              placeholder={"1. Pull this week's bookmarks with queryDatabase.\n2. Group them into themes…"}
              className="min-h-[12rem] max-h-[40svh] resize-y text-sm leading-relaxed"
              aria-invalid={!!errors.instructions}
            />
          </Field>

          <div className="flex items-start justify-between gap-4 rounded-lg border px-3 py-2.5">
            <label htmlFor="skill-enabled" className="min-w-0">
              <span className="block text-sm font-medium leading-6">Enabled</span>
              <span className="block text-xs leading-relaxed text-muted-foreground">
                Off keeps the skill saved but Ask AI won&apos;t use it.
              </span>
            </label>
            <div className="shrink-0 pt-1">
              <Switch
                id="skill-enabled"
                checked={draft.enabled}
                onChange={(next) => set("enabled", next)}
              />
            </div>
          </div>

          {serverError && <p className="text-sm text-destructive">{serverError}</p>}
        </form>

        <DialogFooter className="border-t px-6 py-3">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={() => void submit()} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="animate-spin" aria-hidden />
                Saving…
              </>
            ) : isEdit ? (
              "Save changes"
            ) : (
              "Create skill"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  error,
  trailing,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="text-xs font-medium">
          {label}
        </label>
        {trailing}
      </div>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
