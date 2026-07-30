-- Addendum #13 — two independent additions:
--
-- 1) Preserves rich-text formatting (bold/italic/links attached via
--    Telegram's own formatting toolbar) on saved ads, so a link inside
--    an ad's text keeps working when re-sent later.
--
-- 2) Adds a real permission system for admins: a super-admin flag plus
--    a per-admin JSON permissions blob, so the owner can grant a new
--    admin only some sections of the panel.
--
-- IMPORTANT: after running this, every admin currently in the table
-- becomes a super-admin (full access) — since right now that's just
-- you. Any admin added afterward through the new panel starts as a
-- limited admin with default permissions, until you configure them.
--
-- Apply with:
-- wrangler d1 execute sungenko-db --remote --file=./schema_addendum_13.sql

ALTER TABLE ads ADD COLUMN entities TEXT;

ALTER TABLE admins ADD COLUMN is_super INTEGER NOT NULL DEFAULT 0;
ALTER TABLE admins ADD COLUMN permissions TEXT;
UPDATE admins SET is_super = 1;
