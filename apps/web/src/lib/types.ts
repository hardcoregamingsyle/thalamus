// Same-origin account and waitlist responses backed by Convex.

export interface MeUser {
  id: string;
  email: string;
}

export type AccountStatus = "waitlisted" | "invited";

export interface MeAccount {
  id: string;
  status: AccountStatus;
  plan: string;
}

export interface MeResponse {
  user: MeUser | null;
  account: MeAccount | null;
  /** Sibling to `account`, not nested in it — matches the Convex `/me` response. */
  waitlistPosition: number | null;
  isAdmin: boolean;
}

/** One row of `GET /api/admin/waitlist` (admin-only, session-cookie auth). */
export interface AdminWaitlistRow {
  accountId: string;
  email: string;
  position: number;
  createdAt: string;
  notificationStatus: "pending" | "sent" | "failed" | null;
}
