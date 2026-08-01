-- Addendum #19 — Shinkou: a small personal library of stickers/GIFs, each
-- tagged with the "vibe" it read from it (the sticker's own emoji, and/or
-- a vision read of a static image or a GIF's thumbnail). Lets Shinkou send
-- a fitting sticker/GIF on its own judgement instead of only text.
-- Capped (see AI_MEDIA_LIBRARY_CAP in code) so it never grows unbounded.
--
-- Apply with:
-- wrangler d1 execute sungenko-db --remote --file=./schema_addendum_19.sql

CREATE TABLE IF NOT EXISTS ai_media_library (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_type TEXT NOT NULL, -- 'sticker' | 'gif'
  file_id TEXT NOT NULL,
  vibe_tag TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_media_library_type ON ai_media_library(media_type);
