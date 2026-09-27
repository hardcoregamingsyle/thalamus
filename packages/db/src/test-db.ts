// In-memory Postgres for bun tests: PGlite gives every test its own
// throwaway database with all migrations applied, no external Postgres
// needed.

import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import * as schema from "./schema.js";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../migrations", import.meta.url));

export type TestDb = PgliteDatabase<typeof schema>;

/** Creates a fresh in-memory database with every migration applied. */
export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}
