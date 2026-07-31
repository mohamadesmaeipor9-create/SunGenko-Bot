-- Addendum #15 — Shinkou (AI) group awareness + reactions.
-- Stores aggregated reaction counts per message (via Telegram's
-- message_reaction_count updates — anonymous counts only, no per-user
-- reaction identity is stored), so the assistant can be asked "how did
-- people react to this post?" and answer accurately instead of guessing.
--
-- Apply with:
-- wrangler d1 execute sungenko-db --remote --file=./schema_addendum_15.sql

CREATE TABLE IF NOT EXISTS ai_message_reactions (
  chat_id TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  reactions_json TEXT NOT NULL, -- JSON array like [{"emoji":"👍","count":3}, ...]
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (chat_id, message_id)
);
