import { eq } from "drizzle-orm";
import { accounts, waitlist } from "@thalamus/db";
import type { AppDb } from "../db-types.js";

export type AccountRow = typeof accounts.$inferSelect;

export function canUseProduct(account: Pick<AccountRow, "status">): boolean {
  return account.status === "invited" || account.status === "active";
}

export async function findAccountByConvexUserId(
  db: AppDb,
  convexUserId: string,
): Promise<AccountRow | null> {
  const [row] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.convexUserId, convexUserId))
    .limit(1);
  return row ?? null;
}

export async function getWaitlistPosition(db: AppDb, convexUserId: string): Promise<number | null> {
  const [row] = await db
    .select({ position: waitlist.position })
    .from(waitlist)
    .where(eq(waitlist.convexUserId, convexUserId))
    .limit(1);
  return row?.position ?? null;
}

async function nextWaitlistPosition(db: AppDb): Promise<number> {
  const all = await db.select({ position: waitlist.position }).from(waitlist);
  return all.reduce((max, row) => Math.max(max, row.position), 0) + 1;
}

/** Joins the waitlist: creates the account (if missing) and a waitlist row, idempotently. */
export async function joinWaitlist(
  db: AppDb,
  params: { convexUserId: string; email: string | null; source: string | null },
): Promise<{ account: AccountRow; waitlistPosition: number | null }> {
  const existing = await findAccountByConvexUserId(db, params.convexUserId);
  if (existing) {
    return {
      account: existing,
      waitlistPosition: await getWaitlistPosition(db, params.convexUserId),
    };
  }

  const [account] = await db
    .insert(accounts)
    .values({ convexUserId: params.convexUserId, status: "waitlisted" })
    .returning();
  if (!account) throw new Error("failed to create account");

  const [inserted] = await db
    .insert(waitlist)
    .values({
      email: params.email ?? `${params.convexUserId}@unknown.invalid`,
      convexUserId: params.convexUserId,
      position: await nextWaitlistPosition(db),
      source: params.source,
    })
    .onConflictDoNothing({ target: waitlist.email })
    .returning({ position: waitlist.position });

  const waitlistPosition =
    inserted?.position ?? (await getWaitlistPosition(db, params.convexUserId));
  return { account, waitlistPosition };
}
