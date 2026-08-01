-- Addendum #17 — Group authorization for Shinkou.
-- Every group the bot is added to gets a row here, defaulting to 'pending'
-- (Shinkou will NOT respond there, no matter who summons it) until the
-- owner explicitly approves it from the new Group Management panel. This
-- is what prevents someone adding the bot to an unrelated group and having
-- Shinkou active there.
--
-- Apply with:
-- wrangler d1 execute sungenko-db --remote --file=./schema_addendum_17.sql

CREATE TABLE IF NOT EXISTS bot_groups (
  chat_id TEXT PRIMARY KEY,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | blocked
  added_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
