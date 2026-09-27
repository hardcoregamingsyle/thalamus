import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    // Only read by commands that connect to a live database (migrate, push,
    // studio) — `generate` diffs against the local snapshot and needs none.
    url: process.env.DATABASE_URL ?? "postgres://placeholder/placeholder",
  },
});
