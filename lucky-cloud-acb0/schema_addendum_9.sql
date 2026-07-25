-- Addendum #9 — adds the `ads` table used by the new Ads Management
-- panel (one row per language: fa / en — photo file_id + caption).
--
-- Apply with:
-- wrangler d1 execute sungenko-db --remote --file=./schema_addendum_9.sql

CREATE TABLE IF NOT EXISTS ads (
  lang TEXT PRIMARY KEY,     -- 'fa' | 'en'
  file_id TEXT,
  file_type TEXT,
  caption TEXT,
  updated_at INTEGER
);
