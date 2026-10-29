import "dotenv/config";
import { Client } from "pg";
import { readdir, readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
// Apply checked-in SQL migrations transactionally. Metadata matches Prisma Migrate.
// No native engine is required; Prisma's migrate deploy can read the same history.
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query("SELECT pg_advisory_lock(746381923)");
  await db.query(
    `CREATE TABLE IF NOT EXISTS "_prisma_migrations" (id VARCHAR(36) PRIMARY KEY, checksum VARCHAR(64) NOT NULL, finished_at TIMESTAMPTZ, migration_name VARCHAR(255) NOT NULL, logs TEXT, rolled_back_at TIMESTAMPTZ, started_at TIMESTAMPTZ NOT NULL DEFAULT now(), applied_steps_count INTEGER NOT NULL DEFAULT 0)`,
  );
  const entries = (await readdir("prisma/migrations", { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const sql = await readFile(
      "prisma/migrations/" + entry.name + "/migration.sql",
      "utf8",
    );
    const checksum = createHash("sha256").update(sql).digest("hex");
    const existing = await db.query(
      'SELECT checksum,finished_at FROM "_prisma_migrations" WHERE migration_name=$1 AND rolled_back_at IS NULL',
      [entry.name],
    );
    if (existing.rows.length) {
      if (
        existing.rows[0].checksum !== checksum ||
        !existing.rows[0].finished_at
      )
        throw new Error("Migration history mismatch: " + entry.name);
      continue;
    }
    await db.query("BEGIN");
    try {
      await db.query(sql);
      await db.query(
        'INSERT INTO "_prisma_migrations" (id,checksum,migration_name,finished_at,applied_steps_count) VALUES ($1,$2,$3,now(),1)',
        [randomUUID(), checksum, entry.name],
      );
      await db.query("COMMIT");
      console.log("Applied " + entry.name);
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    }
  }
} finally {
  await db.query("SELECT pg_advisory_unlock(746381923)");
  await db.end();
}
