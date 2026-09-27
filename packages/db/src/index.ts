import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { sql, type SQL } from "drizzle-orm";
import * as schema from "./schema.js";

export * from "./schema.js";

export type Db = NeonHttpDatabase<typeof schema>;

/**
 * Creates the production database client: Postgres on Neon, reached over
 * HTTP via @neondatabase/serverless (one round trip per query, matching the
 * gateway's hot-path rule — see admitRequest below). Nothing on the
 * gateway's request path needs an interactive transaction; a caller that
 * ever does should reach for drizzle-orm/neon-serverless's pooled driver
 * instead. `postgres` (postgres.js) stays a dependency only for
 * drizzle-kit's migration commands (see drizzle.config.ts), never imported
 * by application code.
 */
export function createNeonDb(connectionString: string): Db {
  return drizzle(neon(connectionString), { schema });
}

/** Structural type covering every drizzle driver's `db.execute()` (postgres-js, PGlite, ...). */
export interface ExecutableDb {
  execute(query: SQL): Promise<unknown>;
}

/** Normalizes the row array out of either driver's `execute()` result shape. */
function unwrapRows(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  if (result && typeof result === "object" && "rows" in result) {
    return (result as { rows: Record<string, unknown>[] }).rows;
  }
  throw new Error("Unexpected query result shape");
}

export type AdmitStatus = "ok" | "rate_limited" | "lease_held";

export interface AdmitRequestParams {
  accountId: string;
  userKey: string;
  requestId: string;
  now?: Date;
}

export interface AdmitRequestResult {
  status: AdmitStatus;
  retryAfterSeconds: number | null;
}

/**
 * Calls the `admit_request` SQL function (packages/db/migrations): one round
 * trip that refills/consumes the account's rate-limit token bucket and takes
 * the per-user write lease. See docs/architecture.md §5 step 3 and §6.
 */
export async function admitRequest(
  db: ExecutableDb,
  params: AdmitRequestParams,
): Promise<AdmitRequestResult> {
  const now = params.now ?? new Date();
  const result = await db.execute(
    sql`SELECT * FROM admit_request(${params.accountId}, ${params.userKey}, ${params.requestId}, ${now.toISOString()})`,
  );
  const [row] = unwrapRows(result);
  if (!row) throw new Error("admit_request returned no row");
  return {
    status: row.status as AdmitStatus,
    retryAfterSeconds:
      row.retry_after_seconds === null || row.retry_after_seconds === undefined
        ? null
        : Number(row.retry_after_seconds),
  };
}

export interface ReleaseLeaseParams {
  userKey: string;
  requestId: string;
}

/** Calls the `release_lease` SQL function. Returns whether it released anything. */
export async function releaseLease(db: ExecutableDb, params: ReleaseLeaseParams): Promise<boolean> {
  const result = await db.execute(
    sql`SELECT release_lease(${params.userKey}, ${params.requestId}) AS released`,
  );
  const [row] = unwrapRows(result);
  if (!row) throw new Error("release_lease returned no row");
  return Boolean(row.released);
}
