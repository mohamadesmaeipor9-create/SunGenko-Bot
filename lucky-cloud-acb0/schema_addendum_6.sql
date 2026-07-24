-- Addendum #6 — the live `archives` table is also missing `updated_at`
-- (same root cause as addendum #4: CREATE TABLE IF NOT EXISTS never
-- retrofits columns onto an already-existing table).
--
-- Apply with:
-- wrangler d1 execute sungenko-db --remote --file=./schema_addendum_6.sql

ALTER TABLE archives ADD COLUMN updated_at INTEGER;
