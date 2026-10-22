import type { Bookmark, BookmarkChanges, OrganizationItemResult, OrganizationOperation } from "@bookmark-ai/types";
export function changedBookmarkFields(bookmark: Bookmark, next: { title: string; categoryId: string | null; tags: string[] }): BookmarkChanges | null {
  const changes: Record<string, unknown> = {};
  if (next.title.trim() !== bookmark.title) changes.title = next.title.trim();
  if (next.categoryId !== (bookmark.categoryId ?? null)) changes.categoryId = next.categoryId;
  if (JSON.stringify([...next.tags].sort()) !== JSON.stringify([...bookmark.tags].sort())) changes.tags = next.tags;
  return Object.keys(changes).length ? changes as BookmarkChanges : null;
}
const fieldNames: Record<string, string> = { title: "title", category: "category", categoryId: "category", tags: "tags" };
export function itemResultSummary(result: OrganizationItemResult, undo = false) {
  const changed = result.changedFields?.map(field => fieldNames[field] ?? field).join(", ");
  const kept = result.error?.fields?.map(field => fieldNames[field] ?? field).join(", ");
  return [changed ? `${undo ? "Restored" : "Changed"}: ${changed}` : result.status === "unchanged" ? "Already up to date" : result.status === "succeeded" ? "Completed" : "Needs review", kept ? `Kept newer values: ${kept}` : undefined].filter(Boolean).join(". ");
}
export function operationSummary(operation: OrganizationOperation) {
  const unchanged = operation.results.filter(result => result.status === "unchanged").length;
  const changedItems = operation.results.filter(result => (result.changedFields?.length ?? 0) > 0 || result.status === "succeeded").length;
  const changedFields = operation.succeededFieldCount ?? operation.results.reduce((n, result) => n + (result.changedFields?.length ?? 0), 0);
  const fields = new Set(operation.results.flatMap(result => result.changedFields ?? []));
  const count = `${changedItems} bookmark${changedItems === 1 ? "" : "s"}`;
  const detail = !operation.undoOf && ["bookmarks.update", "bookmark.update"].includes(operation.action) && fields.size === 1
    ? fields.has("categoryId") ? `Changed category on ${count}` : fields.has("tags") ? `Changed tags on ${count}` : fields.has("title") ? `Changed title on ${count}` : null
    : null;
  if (detail) return `${detail}${unchanged ? `, ${unchanged} unchanged` : ""}${operation.failedCount ? `, ${operation.failedCount} need review` : ""}`;
  const action = operation.undoOf ? `${changedFields} fields restored across ${changedItems} items` : `${changedItems} changed`;
  return `${operation.description}: ${action}${unchanged ? `, ${unchanged} unchanged` : ""}${operation.failedCount ? `, ${operation.failedCount} need review` : ""}`;
}
export function expectedBookmarkVersions(bookmark: Bookmark): Record<string, string> {
  return Object.fromEntries(["title", "categoryId", "tags"].map(field => [field, bookmark.fieldVersions?.[field] ?? "0"]));
}
export function operationActionLabel(action: string): string {
  const labels: Record<string,string> = { "bookmarks.update": "Update bookmarks", "bookmark.update": "Edit bookmark", "category.create": "Create category", "category.rename": "Rename category", "category.remove": "Remove category", "tag.create": "Create tag", "tag.rename": "Rename tag", "tag.remove": "Delete tag everywhere", "tag.merge": "Merge tags", undo: "Undo changes", retry: "Retry items" };
  return labels[action] ?? "Organization change";
}
export function readableCurrentValues(current: Record<string,unknown>, data?: { categories:{id:string;name:string}[] } | null): { label: string; value: string }[] {
  return Object.entries(current).filter(([field]) => ["title","categoryId","category","tags","name"].includes(field)).map(([field,raw]) => {
    const value = raw && typeof raw === "object" && "value" in raw ? (raw as {value:unknown}).value : raw;
    const label = ({title:"Title",categoryId:"Category",category:"Category",tags:"Tags",name:"Name"} as Record<string,string>)[field];
    let text: string;
    if (field === "categoryId") text = value == null || value === "" ? "No category" : data?.categories.find(category => category.id === value)?.name ?? String(value);
    else if (Array.isArray(value)) text = value.map(String).join(", ") || "None";
    else text = value == null || value === "" ? "None" : typeof value === "object" ? "Changed since this form opened" : String(value);
    return {label,value:text};
  });
}
export function mixedTags(bookmarks: Bookmark[]) {
  const counts = new Map<string, number>();
  for (const bookmark of bookmarks) for (const tag of new Set(bookmark.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts.entries()].map(([name, count]) => ({ name, state: count === bookmarks.length ? "common" as const : "partial" as const, count }));
}
