-- Addendum #4 — the live `archives` table predates delete_after_seconds
-- (CREATE TABLE IF NOT EXISTS in schema.sql is a no-op once the table
-- already exists, so that column never actually landed on production).
-- This adds it directly.
--
-- Apply with:
-- wrangler d1 execute sungenko-db --remote --file=./schema_addendum_4.sql

ALTER TABLE archives ADD COLUMN delete_after_seconds INTEGER;
