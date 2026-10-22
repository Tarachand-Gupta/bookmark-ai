import type { OrganizationFolder } from "@bookmark-ai/types";

export const FOLDERS_PATH = "/app/folders";

/** Folders are a library filter; the old /app/folders route stays compatible. */
export function folderHref(id?: string | null, ai = false): string {
  const params = new URLSearchParams();
  if (id) { params.set("folderId", id); params.set("includeSubfolders", "false"); }
  if (ai) params.set("ai", "1");
  return `/app/library${params.size ? `?${params}` : ""}`;
}

export function folderAncestors(folders: OrganizationFolder[], id: string): OrganizationFolder[] {
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  const chain: OrganizationFolder[] = [];
  const seen = new Set<string>();
  let current = byId.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id); chain.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return chain;
}

export function childFolders(folders: OrganizationFolder[], parentId: string | null): OrganizationFolder[] {
  return folders.filter(folder => folder.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
}
