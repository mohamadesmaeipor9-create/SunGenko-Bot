-- Addendum #12 — also store last_name, so the viewer-stats screen can
-- show a fuller display name ("first_name last_name") for users who
-- have no @username.
--
-- Apply with:
-- wrangler d1 execute sungenko-db --remote --file=./schema_addendum_12.sql

ALTER TABLE users ADD COLUMN last_name TEXT;
