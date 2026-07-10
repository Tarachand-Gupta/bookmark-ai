export { createDb, type Db } from "./client";
export { ensureSchema, EMBEDDING_DIM } from "./schema";
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
