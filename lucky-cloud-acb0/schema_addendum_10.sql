-- Addendum #10 — bilingual archive descriptions.
-- `archives.description` continues to hold the Persian description;
-- this adds the English counterpart, plus the matching in-flight
-- column on upload_sessions used while an archive is being created.
--
-- Apply with:
-- wrangler d1 execute sungenko-db --remote --file=./schema_addendum_10.sql

ALTER TABLE archives ADD COLUMN description_en TEXT;
ALTER TABLE upload_sessions ADD COLUMN pending_description_en TEXT;
