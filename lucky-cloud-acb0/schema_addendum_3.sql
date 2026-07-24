-- Addendum #3 to schema.sql — adds a lightweight event log used by the
-- new Stats panel (bot starts, archive deliveries, channel add/remove,
-- group force-join blocks). Safe to run after everything else; only
-- adds a new table + index, nothing existing is touched.
--
-- Apply with:
-- wrangler d1 execute sungenko-db --remote --file=./schema_addendum_3.sql

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,            -- 'start' | 'archive_delivered' | 'channel_added' | 'channel_removed' | 'group_block'
  telegram_id TEXT,
  ref_id TEXT,                   -- archive code / channel id, depending on type
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_type_time ON events(type, created_at);
