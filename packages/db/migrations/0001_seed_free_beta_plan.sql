-- The only plan during the free beta (docs/architecture.md §1, §9):
-- 20 requests/min, burst 20.
INSERT INTO "plans" ("id", "requests_per_minute", "burst")
VALUES ('free-beta', 20, 20)
ON CONFLICT ("id") DO NOTHING;
