import { z } from "zod";

/**
 * Chat persistence + free-tier metering API contract.
 *
 * A stored message is UIMessage-compatible: `{ id, role, parts }`, where `parts`
 * is the AI SDK's opaque `UIMessagePart[]` (text, tool calls, tool results,
 * reasoning). We do NOT re-validate the internal part shapes here — they are
 * produced and consumed by the AI SDK and stored verbatim — so `parts` is
 * `z.array(z.unknown())`.
 */

export const chatConversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ChatConversation = z.infer<typeof chatConversationSchema>;

export const storedChatMessageSchema = z.object({
  id: z.string(),
  role: z.string(),
  parts: z.array(z.unknown()),
});
export type StoredChatMessage = z.infer<typeof storedChatMessageSchema>;

/** GET /api/chat/conversations */
export const chatConversationsResponseSchema = z.object({
  conversations: z.array(chatConversationSchema),
});
export type ChatConversationsResponse = z.infer<typeof chatConversationsResponseSchema>;

/** GET /api/chat/conversations/[id] */
export const chatConversationDetailResponseSchema = z.object({
  conversation: chatConversationSchema,
  messages: z.array(storedChatMessageSchema),
});
export type ChatConversationDetailResponse = z.infer<typeof chatConversationDetailResponseSchema>;

/** The 402 body returned when the free-tier weekly token budget is exhausted. */
export const freeLimitExceededSchema = z.object({
  error: z.literal("free-limit-exceeded"),
  usedTokens: z.number(),
  limitTokens: z.number(),
});
export type FreeLimitExceeded = z.infer<typeof freeLimitExceededSchema>;

/** GET/PATCH /api/admin/ai-limit body + response. */
export const aiLimitResponseSchema = z.object({ limitTokens: z.number() });
export type AiLimitResponse = z.infer<typeof aiLimitResponseSchema>;

export const updateAiLimitSchema = z.object({
  limitTokens: z.number().int().positive().max(1_000_000_000_000),
});
export type UpdateAiLimit = z.infer<typeof updateAiLimitSchema>;
