import { z } from "zod";
import { browserSchema, deviceTypeSchema, httpUrlSchema } from "./bookmark";

export const BOOKMARK_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const BOOKMARK_IMPORT_MAX_ITEMS = 5_000;
export const BOOKMARK_IMPORT_BATCH_SIZE = 100;
export const BOOKMARK_IMPORT_MAX_DEPTH = 20;

export const bookmarkImportItemSchema = z.object({
  key: z.string().min(1).max(80),
  url: httpUrlSchema.refine((value) => value.length <= 8_192, "URL is too long"),
  title: z.string().max(1_000),
  folderPath: z.array(z.string().trim().min(1).max(80)).max(BOOKMARK_IMPORT_MAX_DEPTH).default([]),
  savedAt: z.string().datetime({ offset: true }).optional(),
});
export type BookmarkImportItem = z.infer<typeof bookmarkImportItemSchema>;

export const bookmarkImportPreviewRequestSchema = z.object({
  action: z.literal("preview"),
  source: z.enum(["html", "markdown", "text", "browser"]),
  content: z.string().max(BOOKMARK_IMPORT_MAX_BYTES).optional(),
  items: z
    .array(
      z.object({
        url: z.string().max(8_192),
        title: z.string().max(1_000).optional(),
        folderPath: z.array(z.string().max(80)).max(BOOKMARK_IMPORT_MAX_DEPTH).optional(),
        savedAt: z.string().optional(),
      }),
    )
    .max(BOOKMARK_IMPORT_MAX_ITEMS)
    .optional(),
});
export type BookmarkImportPreviewRequest = z.infer<typeof bookmarkImportPreviewRequestSchema>;
export const bookmarkImportApplyRequestSchema = z.object({
  action: z.literal("apply"),
  requestId: z.string().uuid(),
  items: z.array(bookmarkImportItemSchema).min(1).max(BOOKMARK_IMPORT_BATCH_SIZE),
  browser: browserSchema.default("other"),
  device: deviceTypeSchema.default("other"),
  preserveFolders: z.boolean().default(true),
});
export type BookmarkImportApplyRequest = z.infer<typeof bookmarkImportApplyRequestSchema>;
export const bookmarkImportRequestSchema = z.discriminatedUnion("action", [
  bookmarkImportPreviewRequestSchema,
  bookmarkImportApplyRequestSchema,
]);

export interface BookmarkImportPreview {
  items: Array<BookmarkImportItem & { status: "ready" | "existing" }>;
  totalCount: number;
  invalidCount: number;
  duplicateCount: number;
  existingCount: number;
  warnings: string[];
}
export interface BookmarkImportOutcome {
  key: string;
  url: string;
  status: "imported" | "existing" | "failed";
  bookmarkId?: string;
  error?: string;
}
export interface BookmarkImportResult {
  requestId: string;
  items: BookmarkImportOutcome[];
  imported: number;
  existing: number;
  failed: number;
}

interface RawCandidate {
  url: string;
  title?: string;
  folderPath?: string[];
  savedAt?: string;
}

function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
    (whole, entity: string) => {
      if (entity[0] !== "#") return named[entity.toLowerCase()] ?? whole;
      const code =
        entity[1]?.toLowerCase() === "x"
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : "";
    },
  );
}
function plainTitle(value: string): string {
  return decodeHtml(value).replace(/\s+/g, " ").trim().slice(0, 1_000);
}
function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of tag.matchAll(re))
    out[match[1]!.toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? "");
  return out;
}
function timestamp(raw?: string): string | undefined {
  if (!raw) return undefined;
  const seconds = Number(raw);
  const date = Number.isFinite(seconds) ? new Date(seconds * 1_000) : new Date(raw);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

/** Parses exported HTML as inert text. It never creates DOM nodes or loads resources. */
function htmlCandidates(content: string): RawCandidate[] {
  const candidates: RawCandidate[] = [];
  const path: string[] = [];
  const lists: boolean[] = [];
  let pendingFolder: string | null = null;
  let heading: string | null = null;
  let anchor: { attrs: Record<string, string>; text: string } | null = null;
  const clean = content
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  const tokens = /<[^>]*>|[^<]+/g;
  for (const match of clean.matchAll(tokens)) {
    const token = match[0];
    if (token[0] !== "<") {
      if (heading !== null) heading += token;
      if (anchor) anchor.text += token;
      continue;
    }
    if (/^<h3\b/i.test(token)) heading = "";
    else if (/^<\/h3\s*>/i.test(token) && heading !== null) {
      pendingFolder = plainTitle(heading);
      if (pendingFolder.length > 80)
        throw new Error("A folder name is longer than 80 characters. Rename it before importing.");
      heading = null;
    } else if (/^<dl\b/i.test(token)) {
      const addsFolder = !!pendingFolder;
      lists.push(addsFolder);
      if (addsFolder) path.push(pendingFolder!);
      pendingFolder = null;
      if (path.length > BOOKMARK_IMPORT_MAX_DEPTH)
        throw new Error("Folder nesting is too deep (maximum 20 levels).");
    } else if (/^<\/dl\s*>/i.test(token)) {
      if (lists.pop()) path.pop();
    } else if (/^<a\b/i.test(token)) anchor = { attrs: attributes(token), text: "" };
    else if (/^<\/a\s*>/i.test(token) && anchor) {
      candidates.push({
        url: anchor.attrs.href ?? "",
        title: plainTitle(anchor.text),
        folderPath: [...path],
        savedAt: timestamp(anchor.attrs.add_date),
      });
      anchor = null;
      if (candidates.length > BOOKMARK_IMPORT_MAX_ITEMS)
        throw new Error(
          "Import up to 5,000 links at a time. Split this export into smaller files.",
        );
    }
  }
  return candidates;
}

function textCandidates(content: string, markdown: boolean): RawCandidate[] {
  const candidates: Array<RawCandidate & { at: number }> = [];
  const covered: Array<[number, number]> = [];
  if (markdown) {
    const links = /\[([^\]\n]*)\]\(\s*(<?)(https?:\/\/)/gi;
    for (const match of content.matchAll(links)) {
      const start = match.index! + match[0].length - match[3]!.length;
      const angled = match[2] === "<";
      let end = start;
      let depth = 0;
      while (end < content.length) {
        const character = content[end]!;
        if (/\s/.test(character) || character === ">") break;
        if (!angled) {
          if (character === "(") depth++;
          if (character === ")") {
            if (depth === 0) break;
            depth--;
          }
        }
        end++;
      }
      const closing = content
        .slice(end)
        .match(angled ? /^>\s*(?:"[^"\n]*"\s*)?\)/ : /^\s*(?:"[^"\n]*"\s*)?\)/);
      if (!closing || depth !== 0) continue;
      candidates.push({ url: content.slice(start, end), title: match[1], at: match.index! });
      covered.push([match.index!, end + closing[0].length]);
      if (candidates.length > BOOKMARK_IMPORT_MAX_ITEMS)
        throw new Error("Import up to 5,000 links at a time. Split this text into smaller parts.");
    }
  }
  const urls = /https?:\/\/[^\s<>"'`]+/gi;
  for (const match of content.matchAll(urls)) {
    if (covered.some(([start, end]) => match.index! >= start && match.index! < end)) continue;
    let url = match[0].replace(/[.,;:!?]+$/, "");
    while (url.endsWith(")") && (url.match(/\)/g)?.length ?? 0) > (url.match(/\(/g)?.length ?? 0))
      url = url.slice(0, -1);
    url = url.replace(/[\]}]+$/, "");
    candidates.push({ url, at: match.index! });
    if (candidates.length > BOOKMARK_IMPORT_MAX_ITEMS)
      throw new Error("Import up to 5,000 links at a time. Split this text into smaller parts.");
  }
  return candidates.sort((a, b) => a.at - b.at);
}

/** Pure source extraction and dedupe; database duplicate detection happens at preview/apply. */
export function parseBookmarkImportText(
  input: BookmarkImportPreviewRequest,
): BookmarkImportPreview {
  let raw: RawCandidate[];
  if (input.source === "browser") {
    if (!input.items) throw new Error("No browser bookmarks were supplied.");
    raw = input.items;
  } else {
    if (!input.content?.trim()) throw new Error("Choose a file or paste some links first.");
    let byteLength = 0;
    for (const character of input.content) {
      const code = character.codePointAt(0)!;
      byteLength += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    }
    if (byteLength > BOOKMARK_IMPORT_MAX_BYTES)
      throw new Error("Import files must be 5 MB or smaller.");
    if (input.content.startsWith("PK\u0003\u0004"))
      throw new Error(
        "Extract the ZIP on your device, then select its bookmarks HTML file. In Safari, export Bookmarks only.",
      );
    if (/^\s*\{/.test(input.content))
      throw new Error("For a Bookmark AI JSON backup, use Settings → Data → Restore backup.");
    raw =
      input.source === "html"
        ? htmlCandidates(input.content)
        : textCandidates(input.content, input.source === "markdown");
  }
  if (raw.length > BOOKMARK_IMPORT_MAX_ITEMS)
    throw new Error("Import up to 5,000 links at a time.");
  const seen = new Set<string>();
  const items: BookmarkImportPreview["items"] = [];
  let invalidCount = 0;
  let duplicateCount = 0;
  for (const [index, candidate] of raw.entries()) {
    const url = candidate.url.trim();
    const parsed = bookmarkImportItemSchema.safeParse({
      key: String(index),
      url,
      title: candidate.title?.trim() || url,
      folderPath: candidate.folderPath?.filter(Boolean) ?? [],
      savedAt: candidate.savedAt,
    });
    if (!parsed.success) {
      invalidCount++;
      continue;
    }
    if (seen.has(url)) {
      duplicateCount++;
      continue;
    }
    seen.add(url);
    items.push({ ...parsed.data, status: "ready" });
  }
  return {
    items,
    totalCount: raw.length,
    invalidCount,
    duplicateCount,
    existingCount: 0,
    warnings:
      input.source === "markdown" || input.source === "text"
        ? [
            "Only web links are imported. Note text, attachments and future changes stay in the original app.",
          ]
        : [],
  };
}

export interface BrowserBookmarkNode {
  title?: string;
  url?: string;
  dateAdded?: number;
  children?: BrowserBookmarkNode[];
}
/** A browser snapshot is read only; source roots become ordinary import folders. */
export function flattenBrowserBookmarks(nodes: BrowserBookmarkNode[]): RawCandidate[] {
  const out: RawCandidate[] = [];
  const visit = (node: BrowserBookmarkNode, path: string[]) => {
    if (path.length > BOOKMARK_IMPORT_MAX_DEPTH)
      throw new Error("Folder nesting is too deep (maximum 20 levels).");
    if (node.url) {
      out.push({
        url: node.url,
        title: node.title,
        folderPath: path,
        savedAt:
          node.dateAdded && Number.isFinite(new Date(node.dateAdded).getTime())
            ? new Date(node.dateAdded).toISOString()
            : undefined,
      });
      if (out.length > BOOKMARK_IMPORT_MAX_ITEMS)
        throw new Error(
          "Import up to 5,000 links at a time. Use an exported folder file for a larger library.",
        );
    }
    if (!node.url && (node.title?.trim().length ?? 0) > 80)
      throw new Error("A folder name is longer than 80 characters. Rename it before importing.");
    const next = node.title?.trim() && !node.url ? [...path, node.title.trim()] : path;
    for (const child of node.children ?? []) visit(child, next);
  };
  for (const node of nodes) visit(node, []);
  return out;
}
