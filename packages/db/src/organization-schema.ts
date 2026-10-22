/** Additive organization state; original bookmark payload remains readable by older clients. */
export const ORGANIZATION_DDL = `
CREATE TABLE IF NOT EXISTS organization_folders (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, normalized_name TEXT NOT NULL, parent_id TEXT,
 deleted INTEGER NOT NULL DEFAULT 0, versions_json TEXT NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX IF NOT EXISTS organization_folder_names ON organization_folders(COALESCE(parent_id,''),normalized_name) WHERE deleted=0;
CREATE INDEX IF NOT EXISTS organization_folder_parent ON organization_folders(parent_id) WHERE deleted=0;
CREATE TABLE IF NOT EXISTS organization_labels (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('category','tag')), name TEXT NOT NULL,
 normalized_name TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, alias_to TEXT,
 versions_json TEXT NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX IF NOT EXISTS organization_label_names ON organization_labels(kind,normalized_name) WHERE deleted=0;
CREATE TABLE IF NOT EXISTS bookmark_organization (
 bookmark_id TEXT PRIMARY KEY, folder_id TEXT, reading_state TEXT NOT NULL DEFAULT 'not_on_list'
 CHECK(reading_state IN ('not_on_list','unread','read')),
 overrides_json TEXT NOT NULL DEFAULT '{}', versions_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS bookmark_organization_folder ON bookmark_organization(folder_id);
CREATE INDEX IF NOT EXISTS bookmark_organization_reading ON bookmark_organization(reading_state);
CREATE TABLE IF NOT EXISTS organization_operations (
 id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, request_json TEXT, receipt_json TEXT NOT NULL, deltas_json TEXT NOT NULL,
 created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS organization_operation_time ON organization_operations(created_at DESC);
CREATE TABLE IF NOT EXISTS organization_selections (
 id TEXT PRIMARY KEY, selection_json TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS composer_handoffs (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL, operation_id TEXT NOT NULL, request_hash TEXT NOT NULL,
 draft_json TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, claimed_at TEXT,
 UNIQUE(account_id,operation_id)
);
CREATE TABLE IF NOT EXISTS bookmark_import_batches (
 request_id TEXT PRIMARY KEY,input_hash TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_turn_contexts (
 conversation_id TEXT NOT NULL, message_id TEXT NOT NULL, context_json TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(conversation_id,message_id)
);
INSERT OR IGNORE INTO bookmark_organization(bookmark_id,reading_state)
 SELECT id, CASE WHEN EXISTS(SELECT 1 FROM json_each(bookmarks.tags_json) WHERE lower(value) IN ('reading','article')) THEN 'unread' ELSE 'not_on_list' END FROM bookmarks;
INSERT OR IGNORE INTO organization_labels(id,kind,name,normalized_name)
 SELECT 'legacy-category:'||lower(trim(category)),'category',MIN(trim(category)),lower(trim(category))
 FROM bookmarks WHERE lower(trim(category)) NOT IN ('','uncategorized') GROUP BY lower(trim(category));
INSERT OR IGNORE INTO organization_labels(id,kind,name,normalized_name)
 SELECT 'legacy-tag:'||lower(trim(value)),'tag',MIN(trim(value)),lower(trim(value))
 FROM bookmarks,json_each(bookmarks.tags_json) WHERE trim(value)<>'' GROUP BY lower(trim(value));
`;
