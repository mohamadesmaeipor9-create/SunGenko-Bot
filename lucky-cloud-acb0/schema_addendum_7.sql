-- Addendum #7 — the live `files` table predates file_unique_id.
--
-- Apply with:
-- wrangler d1 execute sungenko-db --remote --file=./schema_addendum_7.sql

ALTER TABLE files ADD COLUMN file_unique_id TEXT;
