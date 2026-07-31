-- Addendum #16 — Shinkou passive group-message awareness.
-- Every message sent in a group (by anyone, admin or not) is logged here so
-- Shinkou can be asked to "catch up" on a group's conversation on demand.
-- This is read-only context for the assistant — it is NEVER used to
-- moderate, reply to, or otherwise act on regular users' messages; the
-- force-join gate and everything else about regular users is unaffected.
-- Pruned automatically to the most recent rows per chat to keep it small
-- and keep Shinkou's on-demand reads cheap (see GROUP_LOG_KEEP_PER_CHAT).
--
-- Apply with:
-- wrangler d1 execute sungenko-db --remote --file=./schema_addendum_16.sql

CREATE TABLE IF NOT EXISTS group_message_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  sender_id TEXT,
  sender_name TEXT,
  text TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_group_message_log_chat_time ON group_message_log(chat_id, id);
