-- Addendum #2 to schema.sql — adds support for:
--   1) per-user saved language (English / Persian), used by /language and /start
--   2) a view counter per archive, shown in the admin panel
--
-- Both are plain ADD COLUMN statements: they only add a new, initially
-- empty/zero column. Nothing existing is read, modified, or deleted.
--
-- Apply with:
--   wrangler d1 execute sungenko-db --remote --command="ALTER TABLE users ADD COLUMN lang TEXT;"
--   wrangler d1 execute sungenko-db --remote --command="ALTER TABLE archives ADD COLUMN views INTEGER NOT NULL DEFAULT 0;"

ALTER TABLE users ADD COLUMN lang TEXT;
ALTER TABLE archives ADD COLUMN views INTEGER NOT NULL DEFAULT 0;
