import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";
import type { PostgresDatabase } from "./postgres-database.js";

export interface AppliedMigration {
  name: string;
  checksum: string;
}

const MIGRATION_LOCK_ID = 7_425_050_500;
const DEFAULT_MIGRATIONS_DIRECTORY = fileURLToPath(
  new URL("../../../../database/migrations/", import.meta.url),
);

export async function runPostgresMigrations(
  database: PostgresDatabase,
  directory = DEFAULT_MIGRATIONS_DIRECTORY,
): Promise<AppliedMigration[]> {
  return database.withDedicatedClient(async (client) => {
    await ensureMigrationTable(client);
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    try {
      return await applyPendingMigrations(client, directory);
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]);
    }
  });
}

async function ensureMigrationTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS fleet_schema_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function applyPendingMigrations(
  client: PoolClient,
  directory: string,
): Promise<AppliedMigration[]> {
  const names = (await readdir(directory))
    .filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name))
    .sort((left, right) => left.localeCompare(right));
  const existingResult = await client.query<{ name: string; checksum: string }>(
    "SELECT name, checksum FROM fleet_schema_migrations ORDER BY name",
  );
  const existing = new Map(existingResult.rows.map((row) => [row.name, row.checksum]));
  const applied: AppliedMigration[] = [];

  for (const name of names) {
    const sql = await readFile(join(directory, name), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const previousChecksum = existing.get(name);
    if (previousChecksum && previousChecksum !== checksum) {
      throw new Error(`Applied migration ${name} has been modified.`);
    }
    if (previousChecksum) continue;

    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(
        "INSERT INTO fleet_schema_migrations (name, checksum) VALUES ($1, $2)",
        [name, checksum],
      );
      await client.query("COMMIT");
      applied.push({ name, checksum });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }

  return applied;
}
