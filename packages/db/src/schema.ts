// Drizzle schema for every table in docs/architecture.md §7, plus the
// additions called for in this rebuild's brief (sessions.last_turn_hash,
// sessions.source, and the seeded `free-beta` plan — see migrations/).

import {
  bigint,
  date,
  doublePrecision,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const accountStatusEnum = pgEnum("account_status", [
  "waitlisted",
  "invited",
  "active",
  "suspended",
]);

export const sessionSourceEnum = pgEnum("session_source", ["api", "chat"]);

export const chatRoleEnum = pgEnum("chat_role", ["system", "user", "assistant"]);

/** Thalamus state for a shared (AgentOverflow) account. */
export const accounts = pgTable("accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  convexUserId: text("convex_user_id").notNull(),
  status: accountStatusEnum("status").notNull().default("waitlisted"),
  /** References plans.id. Not a DB foreign key so a plan can be retired
   * without touching every account row that referenced it historically. */
  plan: text("plan").notNull().default("free-beta"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Pre-launch queue (docs/architecture.md §9). */
export const waitlist = pgTable(
  "waitlist",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    convexUserId: text("convex_user_id"),
    position: integer("position").notNull(),
    invitedAt: timestamp("invited_at", { withTimezone: true }),
    source: text("source"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("waitlist_email_idx").on(table.email)],
);

/** Programmatic access. The raw key is shown once; only its hash is stored. */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    hash: text("hash").notNull(),
    last4: text("last4").notNull(),
    name: text("name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("api_keys_hash_idx").on(table.hash)],
);

/** Maps an API customer's OpenAI `user` field to a pseudonymous key. */
export const endUsers = pgTable(
  "end_users",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    externalId: text("external_id").notNull(),
    userKey: text("user_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.externalId] }),
    uniqueIndex("end_users_user_key_idx").on(table.userKey),
  ],
);

/** Session resolution for the hashing scheme in docs/architecture.md §6. */
export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id),
  userKey: text("user_key").notNull(),
  model: text("model").notNull(),
  /** Rolling hash after the latest committed turn ("match on the latest hash"). */
  headHash: text("head_hash").notNull(),
  /** Rolling hash before the latest committed turn ("match on the previous
   * hash with no new user message" — a regenerate of the last reply). */
  prevHash: text("prev_hash"),
  /** Rolling hash of the single most recent turn in isolation, reserved for
   * the gateway's turn-level idempotency (distinct from the head/prev pair
   * above, which match transcript prefixes rather than one turn). */
  lastTurnHash: text("last_turn_hash"),
  source: sessionSourceEnum("source").notNull(),
  turns: integer("turns").notNull().default(0),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Single-writer lease per user_key (docs/architecture.md §6). */
export const userLeases = pgTable("user_leases", {
  userKey: text("user_key").primaryKey(),
  requestId: text("request_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/** Token bucket, refilled and consumed by admit_request(). */
export const rateBuckets = pgTable("rate_buckets", {
  accountId: uuid("account_id")
    .primaryKey()
    .references(() => accounts.id),
  tokens: doublePrecision("tokens").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Chat-app transcript only; API traffic stores hashes and counts, never content. */
export const conversations = pgTable("conversations", {
  id: uuid("id").defaultRandom().primaryKey(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id),
  title: text("title"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id),
  role: chatRoleEnum("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Append-only billing ledger; request_id is unique so delivery can retry. */
export const usageEvents = pgTable("usage_events", {
  requestId: text("request_id").primaryKey(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id),
  model: text("model").notNull(),
  charsIn: integer("chars_in").notNull(),
  charsOut: integer("chars_out").notNull(),
  durationMs: integer("duration_ms").notNull(),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Nightly rollup of usage_events for console charts and future invoices. */
export const usageDaily = pgTable(
  "usage_daily",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    day: date("day").notNull(),
    model: text("model").notNull(),
    requests: integer("requests").notNull().default(0),
    charsIn: bigint("chars_in", { mode: "number" }).notNull().default(0),
    charsOut: bigint("chars_out", { mode: "number" }).notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.accountId, table.day, table.model] })],
);

/** Rate/quota configuration; future price fields are additive columns. */
export const plans = pgTable("plans", {
  id: text("id").primaryKey(),
  requestsPerMinute: integer("requests_per_minute").notNull(),
  burst: integer("burst").notNull(),
  priceCentsPer1kCharsIn: integer("price_cents_per_1k_chars_in"),
  priceCentsPer1kCharsOut: integer("price_cents_per_1k_chars_out"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
