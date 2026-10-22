import type {
  Bookmark,
  OrganizationOperationInput,
  OrganizationResponse,
} from "@bookmark-ai/types";
import {
  editChanges,
  rebaseEdit,
  type EditDraft,
  type EditValues,
  type ReleaseJob,
} from "@/lib/release-state";
import { Button } from "./ui/button";
import { OrganizationPicker, fieldClass } from "./OrganizationPicker";

export function QuickEditor({
  draft,
  organization,
  recentFolders,
  busy,
  job,
  onChange,
  onSave,
  onCancel,
  onKeep,
  onCreate,
  onOpen,
  onRefresh,
  currentBookmark,
}: {
  draft: EditDraft;
  organization: OrganizationResponse;
  recentFolders: string[];
  busy: boolean;
  job?: ReleaseJob;
  onChange(draft: EditDraft): void;
  onSave(): void;
  onCancel(): void;
  onKeep(): void;
  onCreate(input: OrganizationOperationInput): void;
  onOpen(): void;
  onRefresh(): void;
  currentBookmark?: Bookmark;
}) {
  const create = draft.creating?.kind ?? null;
  const name = draft.creating?.name ?? "";
  const parent = draft.creating?.parentId ?? "";
  const setCreating = (kind: "folder" | "category" | "tag" | null) =>
    onChange({
      ...draft,
      creating: kind ? { kind, name: "", parentId: draft.values.folderId } : undefined,
    });
  const setName = (name: string) => onChange({ ...draft, creating: { ...draft.creating!, name } });
  const setParent = (parentId: string) =>
    onChange({ ...draft, creating: { ...draft.creating!, parentId: parentId || null } });
  const update = (changes: Partial<EditValues>) =>
    onChange({ ...draft, values: { ...draft.values, ...changes } });
  const folders = [...organization.folders].sort((a, b) => {
    const ai = recentFolders.indexOf(a.id),
      bi = recentFolders.indexOf(b.id);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.path.localeCompare(b.path);
  });
  const folderOptions = [
    { value: "", label: "Unsorted" },
    ...folders.map((folder) => ({ value: folder.id, label: folder.path })),
  ];
  const conflict =
    job?.status === "failed"
      ? job.result?.operation?.results.find((result) => result.status === "conflict")
      : undefined;
  return (
    <section className="space-y-3" aria-label="Edit bookmark details">
      <h2 className="text-sm font-semibold">Edit details</h2>
      <p className="text-xs text-muted-foreground">
        Your link is saved. Changes here apply only when you save them.
      </p>
      <label className="block space-y-1 text-xs">
        URL
        <input readOnly className={fieldClass} value={draft.base.url} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="ghost" onClick={() => void navigator.clipboard.writeText(draft.base.url)}>
          Copy URL
        </Button>
        <a
          className="rounded-md p-2 text-center text-xs underline focus-visible:ring-2 focus-visible:ring-ring"
          href={draft.base.url}
          target="_blank"
          rel="noreferrer"
        >
          Open URL
        </a>
      </div>
      <fieldset disabled={busy} className="min-w-0 space-y-3">
        <label className="block space-y-1 text-xs">
          Title
          <input
            className={fieldClass}
            maxLength={2000}
            value={draft.values.title}
            onChange={(event) => update({ title: event.target.value })}
          />
        </label>
        <OrganizationPicker
          label="Folder"
          value={draft.values.folderId ?? ""}
          options={folderOptions}
          onChange={(value) => update({ folderId: value || null })}
        />
        {recentFolders.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            Recent destinations appear first; full paths identify nested folders.
          </p>
        )}
        <OrganizationPicker
          label="Topics"
          value={draft.values.categoryId ?? ""}
          options={[
            { value: "", label: "Uncategorized" },
            ...organization.categories.map((category) => ({
              value: category.id,
              label: category.name,
            })),
          ]}
          onChange={(value) => update({ categoryId: value || null })}
        />
        <div className="flex flex-wrap gap-1" aria-label="Selected tags">
          {draft.values.tags.map((tag) => (
            <button
              type="button"
              key={tag}
              className="max-w-full break-words rounded-md border border-border px-2 py-1 text-xs focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Remove tag ${tag}`}
              onClick={() => update({ tags: draft.values.tags.filter((value) => value !== tag) })}
            >
              {tag} ×
            </button>
          ))}
        </div>
        <OrganizationPicker
          label={`Tags (${draft.values.tags.length}/10)`}
          value=""
          disabled={draft.values.tags.length >= 10}
          options={organization.tags
            .filter((tag) => !draft.values.tags.includes(tag.name))
            .map((tag) => ({ value: tag.name, label: tag.name }))}
          onChange={(tag) => update({ tags: [...draft.values.tags, tag] })}
        />
        {draft.values.tags.length > 10 && (
          <p className="text-xs text-muted-foreground">
            Existing tags are kept. Remove tags to reach ten before adding another.
          </p>
        )}
        <OrganizationPicker
          label="Reading list"
          value={draft.values.readingState}
          options={[
            { value: "not_on_list", label: "Not on list" },
            { value: "unread", label: "Unread" },
            { value: "read", label: "Read" },
          ]}
          onChange={(value) => update({ readingState: value as EditValues["readingState"] })}
        />
        <div className="grid grid-cols-3 gap-1">
          {(["folder", "category", "tag"] as const).map((kind) => (
            <Button
              variant="ghost"
              key={kind}
              onClick={() => {
                setCreating(create === kind ? null : kind);
              }}
            >
              New {kind === "category" ? "topic" : kind}
            </Button>
          ))}
        </div>
        {create && (
          <div className="space-y-2 rounded-md border border-border p-2">
            <label className="block space-y-1 text-xs">
              {create === "category" ? "Topic" : create === "folder" ? "Folder" : "Tag"} name
              <input
                className={fieldClass}
                value={name}
                maxLength={create === "tag" ? 40 : 80}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            {create === "folder" && (
              <OrganizationPicker
                label="Parent folder"
                value={parent}
                options={[{ value: "", label: "Top level" }, ...folderOptions.slice(1)]}
                onChange={setParent}
              />
            )}
            <Button
              variant="outline"
              disabled={!name.trim()}
              onClick={() => {
                const match =
                  create === "folder"
                    ? organization.folders.find(
                        (folder) =>
                          folder.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase() &&
                          folder.parentId === (parent || null),
                      )
                    : (create === "category" ? organization.categories : organization.tags).find(
                        (label) =>
                          label.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase(),
                      );
                if (match) {
                  update(
                    create === "folder"
                      ? { folderId: match.id }
                      : create === "category"
                        ? { categoryId: match.id }
                        : {
                            tags: draft.values.tags.includes(match.name)
                              ? draft.values.tags
                              : [...draft.values.tags, match.name],
                          },
                  );
                } else
                  onCreate({
                    operationId: crypto.randomUUID(),
                    action: `${create}.create`,
                    name: name.trim(),
                    ...(create === "folder" ? { parentId: parent || null } : {}),
                  } as OrganizationOperationInput);
              }}
            >
              Create or use existing
            </Button>
            <p className="text-[11px] text-muted-foreground">
              Creation is separate from assignment. Save changes to assign it.
            </p>
          </div>
        )}
      </fieldset>
      {conflict?.error?.current && (
        <div className="space-y-1 text-xs" role="alert">
          <p>Another edit changed this bookmark. Your proposed values are kept.</p>
          {Object.entries(conflict.error.current).map(([field, value]) => (
            <p className="break-words" key={field}>
              {field}: current {JSON.stringify(value)}; proposed{" "}
              {JSON.stringify(draft.values[field as keyof EditValues])}
            </p>
          ))}
        </div>
      )}
      <Button
        disabled={busy || !draft.values.title.trim() || !Object.keys(editChanges(draft)).length}
        onClick={onSave}
      >
        Save changes
      </Button>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="ghost" disabled={busy} onClick={onKeep}>
          Keep draft
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onCancel}>
          Discard changes
        </Button>
      </div>
      <Button variant="ghost" disabled={busy} onClick={onRefresh}>
        Refresh choices and current bookmark
      </Button>
      {conflict &&
        currentBookmark &&
        JSON.stringify(currentBookmark.fieldVersions) !==
          JSON.stringify(draft.base.fieldVersions) && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => onChange(rebaseEdit(draft, currentBookmark))}
          >
            Use current version and keep proposed edits
          </Button>
        )}
      <Button variant="outline" onClick={onOpen}>
        Open full editor
      </Button>
    </section>
  );
}
