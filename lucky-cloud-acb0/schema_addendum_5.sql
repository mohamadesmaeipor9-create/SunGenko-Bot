-- Addendum #5 — makes the "which channels are required" step of the
-- upload flow self-contained on the upload_sessions row itself, instead
-- of depending on admin_state staying in sync across every tap. This is
-- what fixes the "I tap a channel and nothing happens" bug.
--
-- Apply with:
-- wrangler d1 execute sungenko-db --remote --file=./schema_addendum_5.sql

ALTER TABLE upload_sessions ADD COLUMN pending_title TEXT;
ALTER TABLE upload_sessions ADD COLUMN pending_description TEXT;
ALTER TABLE upload_sessions ADD COLUMN selected_channels TEXT;
