/**
 * Sanity check for libSQL native vector support against the real DB file:
 * stores a synthetic 768-dim embedding and runs a cosine-distance search.
 * Run: pnpm tsx scripts/verify-vector.ts
 */
import { createDb, ensureSchema, EMBEDDING_DIM, searchVector, storeEmbedding } from "@bookmark-ai/db";

const db = createDb(process.env.DATABASE_URL ?? "file:./data/bookmarks.db");
await ensureSchema(db);

const rs = await db.execute("SELECT id FROM bookmarks LIMIT 1");
const id = rs.rows[0]?.id as string | undefined;
if (!id) {
  console.log("no bookmarks to test against — save one first");
  process.exit(1);
}

const fake = Array.from({ length: EMBEDDING_DIM }, (_, i) => Math.sin(i) / 10);
await storeEmbedding(db, id, fake);

const hits = await searchVector(db, fake, 5);
const top = hits[0];
if (!top || top.bookmark.id !== id || top.score < 0.999) {
  console.error("FAIL: vector search did not return the stored vector as top hit", top?.score);
  process.exit(1);
}
console.log(`OK: vector store+search works (top score ${top.score.toFixed(4)}, embedded=${top.bookmark.embedded})`);

// Clean up so the embed worker re-embeds with real vectors once a key exists.
await db.execute({ sql: "UPDATE bookmarks SET embedding = NULL WHERE id = ?", args: [id] });
