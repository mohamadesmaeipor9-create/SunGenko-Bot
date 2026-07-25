-- Addendum #11 — stores Telegram username + first name per user, so the
-- new "Viewer Stats" screen (per archive) can show who viewed it, not
-- just a raw telegram_id.
--
-- Apply with:
-- wrangler d1 execute sungenko-db --remote --file=./schema_addendum_11.sql

ALTER TABLE users ADD COLUMN username TEXT;
ALTER TABLE users ADD COLUMN first_name TEXT;
