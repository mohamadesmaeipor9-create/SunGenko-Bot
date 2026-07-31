-- Addendum #14 — AI Assistant feature.
-- Adds: durable memory (rules/structure the admin teaches the AI), a staging
-- area for content the admin hands the AI before it can post anything, the
-- scheduled-post queue (with a short, server-enforced self-edit window),
-- a full activity log, and short-term chat history for context.
--
-- Nothing here touches existing tables except admins.permissions, which
-- already stores a flexible JSON blob — the new "ai" permission key is
-- handled entirely at the application layer, no column change needed.
--
-- Apply with:
-- wrangler d1 execute sungenko-db --remote --file=./schema_addendum_14.sql

-- Rules/structure the admin has taught the AI (e.g. "our posts always look
-- like: title line, blank line, body, then #hashtags"). Always loaded into
-- the AI's system prompt so it never "forgets" the channel's conventions.
CREATE TABLE IF NOT EXISTS ai_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Content staging: files/photos the admin sends to the AI outside of the
-- existing archive-upload flow. Nothing can be scheduled/posted without a
-- session here containing at least one file or an explicit text body.
CREATE TABLE IF NOT EXISTS ai_content_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_telegram_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'collecting', -- collecting | ready | used | cancelled
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_content_session_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  file_id TEXT NOT NULL,
  file_unique_id TEXT,
  file_type TEXT NOT NULL,
  file_name TEXT,
  caption TEXT,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  vision_description TEXT, -- real model-based description of the image, cached so it's only computed once

  FOREIGN KEY (session_id) REFERENCES ai_content_sessions(id) ON DELETE CASCADE
);

-- Scheduled posts. Every row here was explicitly confirmed by the admin
-- before being created (never auto-created silently by the AI).
-- edit_locked_at = the moment the self-edit window closes; once now() is
-- past it, the edit tool refuses regardless of what the AI is asked to do.
CREATE TABLE IF NOT EXISTS ai_scheduled_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL,
  content_session_id INTEGER,
  caption TEXT,
  schedule_type TEXT NOT NULL,   -- 'once' | 'daily' | 'weekly'
  time_of_day TEXT,              -- 'HH:MM' (bot's configured timezone)
  day_of_week INTEGER,           -- 0-6, only for weekly
  next_run_at INTEGER NOT NULL,  -- epoch ms of the next (or only) run
  status TEXT NOT NULL DEFAULT 'awaiting_confirmation', -- awaiting_confirmation | active | cancelled | done
  last_posted_at INTEGER,
  posted_chat_id TEXT,
  posted_message_ids TEXT,       -- JSON array — most recent post's message ids
  edit_locked_at INTEGER,        -- last_posted_at + 2 minutes
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  FOREIGN KEY (content_session_id) REFERENCES ai_content_sessions(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_scheduled_posts_due ON ai_scheduled_posts(status, next_run_at);

-- Short rolling chat history per admin, used only to give the AI
-- conversational context — not a permanent transcript archive.
CREATE TABLE IF NOT EXISTS ai_chat_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL,
  role TEXT NOT NULL,   -- 'user' | 'model' | 'tool'
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_chat_history_user_time ON ai_chat_history(telegram_id, created_at);

-- Full transparency log of everything the AI actually did (not what it
-- merely said) — shown in the new AI Control panel.
CREATE TABLE IF NOT EXISTS ai_activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_type TEXT NOT NULL,  -- 'rule_saved' | 'post_scheduled' | 'post_published' | 'post_edited' | 'schedule_cancelled'
  detail TEXT,
  channel_id INTEGER,
  created_at INTEGER NOT NULL
);

-- Master switches (ai_master_enabled, ai_autopost_enabled) are simple
-- on/off flags and reuse the existing generic `settings` table — no new
-- column needed for those.
