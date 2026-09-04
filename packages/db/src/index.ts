export { createDb, type Db } from "./client";
export { ensureSchema, EMBEDDING_DIM } from "./schema";
export { runMigrations, TENANT_MIGRATIONS, type Migration } from "./migrations";
export { savedAtLowerBound, savedAtUpperBoundExclusive } from "./date-bounds";
export {
  ensureMasterSchema,
  MASTER_MIGRATIONS,
  getTenant,
  insertTenant,
  deleteTenant,
  listActiveTenants,
  bumpUsage,
  getPlatformConfig,
  setPlatformConfig,
  type Tenant,
  type UsageField,
} from "./master";
export {
  TursoPlatform,
  TursoPlatformError,
  type PlatformConfig,
  type PlatformDatabase,
  type CreateTokenOptions,
} from "./platform";
export { LocalFilePlatform } from "./local-platform";
export {
  insertBookmark,
  updateBookmarkContent,
  getBookmark,
  getBookmarkByUrl,
  deleteBookmark,
  listBookmarks,
  getMeta,
  listTagCounts,
  type InsertBookmark,
  type BookmarkContent,
} from "./queries/bookmarks";
export {
  countBookmarks,
  countSessions,
  listBookmarksByAnyTag,
  listBookmarksNotFromDevice,
  listRecentSessionSummaries,
  getLatestSessionTabs,
  getActivityCounts,
  type ActivityCounts,
} from "./queries/dashboard";
export {
  mergeHybrid,
  searchFullText,
  searchVector,
  storeEmbedding,
  listUnembedded,
  MIN_VECTOR_SIMILARITY,
  type Scored,
} from "./queries/search";
export {
  createSession,
  listSessions,
  getSession,
  renameSession,
  applySessionSummary,
  deleteSession,
  searchSessions,
  searchSessionsVector,
  storeSessionEmbedding,
  listUnembeddedSessions,
  SESSION_SCORE_SELF,
  SESSION_SCORE_TABS,
  type InsertSession,
  type ScoredSession,
} from "./queries/sessions";
export {
  getUserSettings,
  upsertUserSettings,
  type UserSettingsRow,
  type UserSettingsPatch,
} from "./queries/settings";
export {
  insertConversation,
  getConversation,
  listConversations,
  touchConversation,
  deleteConversation,
  insertMessage,
  getMessageConversationId,
  listMessages,
  getWeeklyTokens,
  addWeeklyTokens,
  type ChatConversationRow,
  type ChatMessageRow,
  type InsertConversation,
  type InsertChatMessage,
} from "./queries/chat";
export {
  insertMcpToken,
  getMcpToken,
  listMcpTokens,
  revokeMcpToken,
  touchMcpToken,
  bumpMcpUsage,
  type McpTokenRow,
} from "./queries/mcp";
export {
  insertSkill,
  getSkill,
  getSkillByName,
  listSkills,
  listEnabledSkills,
  updateSkill,
  deleteSkill,
  type SkillRow,
  type InsertSkill,
  type SkillPatch,
} from "./queries/skills";
export {
  upsertDeviceSnapshot,
  listDevices,
  getDevice,
  deleteDevice,
  deleteAllDevices,
  reapExpiredDevices,
  getLiveSettings,
  setLiveSettings,
  type UpsertDeviceSnapshot,
  type LiveDeviceRow,
} from "./queries/live";
