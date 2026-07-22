-- ============================================
-- SunGenkoBot — Final Unified Schema
-- Replaces all previous schema.sql and migrations
-- ============================================

CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT UNIQUE NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT UNIQUE NOT NULL,
    username TEXT,
    title TEXT,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS archives (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    delete_after_seconds INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Links each archive to its OWN dedicated channel(s) for force-join
CREATE TABLE IF NOT EXISTS archive_channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    archive_id INTEGER NOT NULL,
    channel_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,

    FOREIGN KEY (archive_id) REFERENCES archives(id) ON DELETE CASCADE,
    FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
    UNIQUE (archive_id, channel_id)
);

-- Finalized files, permanently linked to a completed archive
CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    archive_id INTEGER NOT NULL,
    file_id TEXT NOT NULL,
    file_unique_id TEXT,
    file_type TEXT NOT NULL,
    file_name TEXT,
    caption TEXT,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,

    FOREIGN KEY (archive_id) REFERENCES archives(id) ON DELETE CASCADE
);

-- Temporary upload session, active while admin is uploading files
-- before an archive is created
CREATE TABLE IF NOT EXISTS upload_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_telegram_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'collecting', -- collecting | awaiting_title | awaiting_description | finished | cancelled
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Files temporarily held inside an active upload session
CREATE TABLE IF NOT EXISTS upload_session_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    file_id TEXT NOT NULL,
    file_unique_id TEXT,
    file_type TEXT NOT NULL,
    file_name TEXT,
    caption TEXT,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,

    FOREIGN KEY (session_id) REFERENCES upload_sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT UNIQUE NOT NULL,
    first_seen_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
);

-- Tracks messages the bot sent to end users, so auto-delete only
-- ever touches bot-sent messages — never the archive/files themselves
CREATE TABLE IF NOT EXISTS sent_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_telegram_id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    message_id INTEGER NOT NULL,
    archive_id INTEGER,
    delete_at INTEGER,
    deleted INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,

    FOREIGN KEY (archive_id) REFERENCES archives(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);