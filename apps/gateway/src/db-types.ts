// A drizzle db type that both the production driver (Neon over HTTP, via
// @thalamus/db's createNeonDb) and the test driver (PGlite, via createTestDb)
// satisfy, so createApp(deps) can accept either without depending on either
// driver package directly (that would pull @electric-sql/pglite into a
// production import). The schema type parameter is inferred from @thalamus/db's
// own exported `Db` type rather than imported directly, since the package
// only publishes "." and "./test-db" — there is no subpath for the schema
// module alone.
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { Db } from "@thalamus/db";

type SchemaOf<T> = T extends PgDatabase<infer _Query, infer Schema, infer _Tables> ? Schema : never;

export type AppDb = PgDatabase<PgQueryResultHKT, SchemaOf<Db>>;
