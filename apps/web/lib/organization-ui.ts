import type { Bookmark, BookmarkChanges, OrganizationFolder, OrganizationItemResult, OrganizationOperation } from "@bookmark-ai/types";
export function changedBookmarkFields(bookmark: Bookmark, next: { title: string; folderId: string | null; categoryId: string | null; tags: string[]; readingState: "not_on_list" | "unread" | "read" }): BookmarkChanges | null {
  const changes: Record<string, unknown> = {};
  if (next.title.trim() !== bookmark.title) changes.title = next.title.trim();
  if (next.folderId !== (bookmark.folderId ?? null)) changes.folderId = next.folderId;
  if (next.categoryId !== (bookmark.categoryId ?? null)) changes.categoryId = next.categoryId;
  if (next.readingState !== (bookmark.readingState ?? "not_on_list")) changes.readingState = next.readingState;
  if (JSON.stringify([...next.tags].sort()) !== JSON.stringify([...bookmark.tags].sort())) changes.tags = next.tags;
  return Object.keys(changes).length ? changes as BookmarkChanges : null;
}
export function invalidFolderDestinations(folders: OrganizationFolder[], movingId?: string): Set<string> {
  const result = new Set<string>(); if (!movingId) return result;
  result.add(movingId);
  for (let count = -1; count !== result.size;) { count = result.size; for (const folder of folders) if (folder.parentId && result.has(folder.parentId)) result.add(folder.id); }
  return result;
}
const fieldNames: Record<string, string> = { title: "title", folder: "folder", folderId: "folder", category: "topic", categoryId: "topic", tags: "tags", readingState: "reading state" };
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
    ? fields.has("folderId") ? `Moved ${count}` : fields.has("categoryId") ? `Changed topic on ${count}` : fields.has("tags") ? `Changed tags on ${count}` : fields.has("readingState") ? `Changed reading status on ${count}` : fields.has("title") ? `Changed title on ${count}` : null
    : null;
  if (detail) return `${detail}${unchanged ? `, ${unchanged} unchanged` : ""}${operation.failedCount ? `, ${operation.failedCount} need review` : ""}`;
  const action = operation.undoOf ? `${changedFields} fields restored across ${changedItems} items` : `${changedItems} changed`;
  return `${operation.description}: ${action}${unchanged ? `, ${unchanged} unchanged` : ""}${operation.failedCount ? `, ${operation.failedCount} need review` : ""}`;
}
export function expectedBookmarkVersions(bookmark: Bookmark): Record<string, string> {
  return Object.fromEntries(["title", "folderId", "categoryId", "tags", "readingState"].map(field => [field, bookmark.fieldVersions?.[field] ?? "0"]));
}
export function operationActionLabel(action: string): string {
  const labels: Record<string,string> = { "bookmarks.update": "Update bookmarks", "bookmark.update": "Edit bookmark", "folder.create": "Create folder", "folder.update": "Edit folder", "folder.remove": "Remove folder", "category.create": "Create topic", "category.rename": "Rename topic", "category.remove": "Remove topic", "tag.create": "Create tag", "tag.rename": "Rename tag", "tag.remove": "Delete tag everywhere", "tag.merge": "Merge tags", undo: "Undo changes", retry: "Retry items" };
  return labels[action] ?? "Organization change";
}
export function readableCurrentValues(current: Record<string,unknown>, data?: { folders: {id:string;path:string}[]; categories:{id:string;name:string}[] } | null): { label: string; value: string }[] {
  return Object.entries(current).filter(([field]) => ["title","folderId","categoryId","category","tags","readingState","name","parentId"].includes(field)).map(([field,raw]) => {
    const value = raw && typeof raw === "object" && "value" in raw ? (raw as {value:unknown}).value : raw;
    const label = ({title:"Title",folderId:"Folder",categoryId:"Topic",category:"Topic",tags:"Tags",readingState:"Reading status",name:"Name",parentId:"Parent folder"} as Record<string,string>)[field];
    let text: string;
    if (field === "folderId" || field === "parentId") text = value == null ? field === "parentId" ? "Top level" : "Unsorted" : data?.folders.find(folder => folder.id === value)?.path ?? "A folder that is no longer available";
    else if (field === "categoryId") text = value == null || value === "" ? "No topic" : data?.categories.find(category => category.id === value)?.name ?? String(value);
    else if (field === "readingState") text = ({not_on_list:"Not on reading list",unread:"Unread",read:"Read"} as Record<string,string>)[String(value)] ?? "Not on reading list";
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

/** Stable parent-first navigation even when the server sorts paths globally. */
export function folderTreeRows(folders: OrganizationFolder[]) {
  const children = new Map<string | null, OrganizationFolder[]>();
  const ids = new Set(folders.map(folder => folder.id));
  for (const folder of folders) {const parent = folder.parentId && ids.has(folder.parentId) ? folder.parentId : null;const rows=children.get(parent) ?? [];rows.push(folder);children.set(parent,rows);}
  for (const rows of children.values()) rows.sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:"base"}));
  const result: {folder:OrganizationFolder;depth:number;ancestors:string[];hasChildren:boolean}[]=[];
  const seen=new Set<string>();
  const walk=(folder:OrganizationFolder,ancestors:string[])=>{if(seen.has(folder.id))return;seen.add(folder.id);result.push({folder,depth:ancestors.length,ancestors,hasChildren:!!children.get(folder.id)?.length});for(const child of children.get(folder.id)??[])walk(child,[...ancestors,folder.id]);};
  for(const folder of children.get(null)??[])walk(folder,[]);
  for(const folder of folders)if(!seen.has(folder.id))walk(folder,[]);
  return result;
}

/** Search crosses collapsed branches and retains full paths; normal browsing respects disclosure. */
export function visibleFolderRows(folders: OrganizationFolder[], collapsed: ReadonlySet<string>, query = "") {
  const needle = query.trim().toLowerCase();
  return folderTreeRows(folders).filter(row => needle
    ? row.folder.path.toLowerCase().includes(needle) || row.folder.name.toLowerCase().includes(needle)
    : !row.ancestors.some(id => collapsed.has(id)));
}
