export { createDb, type Db } from "./client";
export { ensureSchema, EMBEDDING_DIM } from "./schema";
export {
  insertBookmark,
  getBookmark,
  getBookmarkByUrl,
  deleteBookmark,
  listBookmarks,
  getMeta,
  listTagCounts,
  type InsertBookmark,
} from "./queries/bookmarks";
export {
  searchFullText,
  searchVector,
  storeEmbedding,
  listUnembedded,
  type Scored,
} from "./queries/search";
