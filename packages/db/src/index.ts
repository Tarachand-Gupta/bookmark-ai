export { createDb, type Db } from "./client";
export { ensureSchema, EMBEDDING_DIM } from "./schema";
export { runMigrations, TENANT_MIGRATIONS, type Migration } from "./migrations";
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
  mergeHybrid,
  searchFullText,
  searchVector,
  storeEmbedding,
  listUnembedded,
  type Scored,
} from "./queries/search";
export {
  createSession,
  listSessions,
  getSession,
  deleteSession,
  searchSessions,
  type InsertSession,
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
  listMessages,
  getWeeklyTokens,
  addWeeklyTokens,
  type ChatConversationRow,
  type ChatMessageRow,
  type InsertConversation,
  type InsertChatMessage,
} from "./queries/chat";
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
