-- Addendum to schema.sql — adds ONE new table needed for the group-chat
-- "please join" prompt debounce (replaces the old temp-file/KV approach).
-- Safe to run after your existing schema.sql; does not modify anything
-- that's already there.
--
-- Apply with:
--   wrangler d1 execute sungenko-db --file=./schema_addendum.sql --remote

CREATE TABLE IF NOT EXISTS group_join_prompts (
  chat_id TEXT PRIMARY KEY,
  message_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
