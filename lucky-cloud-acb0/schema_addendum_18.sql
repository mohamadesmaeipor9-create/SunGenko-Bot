-- Addendum #18 — Shinkou: curated person-memory (who's who), on top of the
-- existing channel-rule memory (ai_memory) and short chat history.
-- Deliberately small and capped per person AND overall, so this behaves
-- like a curated memory (durable facts only) rather than a chat dump —
-- pruned automatically, never grows unbounded.
--
-- Apply with:
-- wrangler d1 execute sungenko-db --remote --file=./schema_addendum_18.sql

CREATE TABLE IF NOT EXISTS ai_person_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_key TEXT NOT NULL,   -- the person's stable Telegram user id, as a string
  display_name TEXT,          -- last known display name (for lookups by name)
  fact_text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_person_memory_person ON ai_person_memory(person_key);
