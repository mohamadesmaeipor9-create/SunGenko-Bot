-- Addendum #8 — the live `files` table is still missing file_name,
-- caption, and order_index (same recurring root cause as the previous
-- addenda: this table predates the current schema.sql definition).
-- Based on a full sqlite_master dump, this is the last gap — every
-- other live table already matches what index.ts expects.
--
-- Apply with:
-- wrangler d1 execute sungenko-db --remote --file=./schema_addendum_8.sql

ALTER TABLE files ADD COLUMN file_name TEXT;
ALTER TABLE files ADD COLUMN caption TEXT;
ALTER TABLE files ADD COLUMN order_index INTEGER NOT NULL DEFAULT 0;
