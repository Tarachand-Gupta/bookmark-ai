import { z } from "zod";

export const ORGANIZATION_CAPABILITIES = {
  organization: 1,
  undoDays: 7,
  context: 1,
  handoff: 1,
  maxOperationItems: 500,
  maxSelectionItems: 10000,
} as const;
export const MAX_ORGANIZATION_SELECTION = 10_000;
export const organizationNameSchema = z.string().trim().min(1, "Name is required").max(80);
export const tagNameSchema = z.string().trim().min(1, "Tag is required").max(40);
export const operationIdSchema = z.string().min(8).max(128);
const id = z.string().min(1).max(200);
export const fieldVersionsSchema = z.record(z.string());
const changesShape = {
  title: z.string().trim().min(1).max(2_000).optional(),
  categoryId: id.nullable().optional(),
  tags: z.array(tagNameSchema).max(1000).optional(),
};
export const bookmarkChangesSchema = z
  .object(changesShape)
  .strict()
  .refine((v) => Object.keys(v).length > 0, "No changes supplied");
export type BookmarkChanges = z.infer<typeof bookmarkChangesSchema>;
export const updateBookmarkSchema = z
  .object({
    operationId: operationIdSchema,
    changes: bookmarkChangesSchema,
    expected: fieldVersionsSchema.optional(),
  })
  .strict();
export type UpdateBookmarkInput = z.infer<typeof updateBookmarkSchema>;
export const bulkBookmarkChangesSchema = z
  .object({
    categoryId: changesShape.categoryId,
    addTags: z.array(tagNameSchema).max(10).optional(),
    removeTags: z.array(tagNameSchema).max(1000).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "No changes supplied");
export type BulkBookmarkChanges = z.infer<typeof bulkBookmarkChangesSchema>;
const op = { operationId: operationIdSchema };
export const organizationOperationSchema = z.discriminatedUnion("action", [
  z
    .object({
      ...op,
      action: z.literal("bookmarks.update"),
      bookmarkIds: z.array(id).min(1).max(MAX_ORGANIZATION_SELECTION).optional(),
      selectionId: id.optional(),
      changes: bulkBookmarkChangesSchema,
      expected: z.record(fieldVersionsSchema).optional(),
    })
    .strict(),
  z.object({ ...op, action: z.literal("category.create"), name: organizationNameSchema }).strict(),
  z
    .object({ ...op, action: z.literal("category.rename"), id, name: organizationNameSchema })
    .strict(),
  z
    .object({ ...op, action: z.literal("category.remove"), id, replacementId: id.nullable() })
    .strict(),
  z.object({ ...op, action: z.literal("tag.create"), name: tagNameSchema }).strict(),
  z.object({ ...op, action: z.literal("tag.rename"), id, name: tagNameSchema }).strict(),
  z.object({ ...op, action: z.literal("tag.remove"), id }).strict(),
  z.object({ ...op, action: z.literal("tag.merge"), sourceId: id, targetId: id }).strict(),
]);
export type OrganizationOperationInput = z.infer<typeof organizationOperationSchema>;
export interface OrganizationItemError {
  code: string;
  message: string;
  fields?: string[];
  current?: Record<string, unknown>;
}
export interface OrganizationItemResult {
  id: string;
  entityType?: "bookmark" | "category" | "tag";
  label?: string;
  status: "succeeded" | "failed" | "unchanged" | "conflict";
  changedFields?: string[];
  error?: OrganizationItemError;
}
export interface OrganizationOperation {
  id: string;
  action: string;
  description: string;
  createdAt: string;
  undoExpiresAt: string;
  status: "completed" | "partial" | "failed";
  requestedCount: number;
  succeededCount: number;
  failedCount: number;
  results: OrganizationItemResult[];
  undoStatus: "available" | "partial" | "undone" | "expired" | "unavailable";
  entityId?: string;
  undoOf?: string;
  existing?: boolean;
  succeededFieldCount?: number;
  failedFieldCount?: number;
}
export interface OrganizationLabel {
  id: string;
  name: string;
  count: number;
}
export interface OrganizationResponse {
  capabilities: typeof ORGANIZATION_CAPABILITIES;
  categories: OrganizationLabel[];
  tags: OrganizationLabel[];
}
export interface OrganizationSelection {
  id: string;
  bookmarkIds: string[];
  fieldVersions: Record<string, Record<string, string>>;
  count: number;
  createdAt: string;
  expiresAt: string;
  scope: "explicit" | "all_matches" | "ranked";
  limited: boolean;
  limit?: number;
}
export const organizationFiltersSchema = z.object({
  categoryId: id.optional(),
  tagId: id.optional(),
});
export type OrganizationFilters = z.infer<typeof organizationFiltersSchema>;
export const chatContextSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("library") }).strict(),
  z.object({ type: z.literal("bookmarks"), bookmarkIds: z.array(id).min(1).max(1000) }).strict(),
]);
export type ChatContext = z.infer<typeof chatContextSchema>;
export const composerHandoffSchema = z
  .object({
    operationId: operationIdSchema,
    draft: z.object({ text: z.string().max(32000), context: chatContextSchema }).strict(),
  })
  .strict();
export type ComposerHandoffInput = z.infer<typeof composerHandoffSchema>;
export interface ComposerHandoff {
  id: string;
  expiresAt: string;
  claimedAt?: string;
  draft?: ComposerHandoffInput["draft"];
}
