/**
 * SunGenko Force-Join + Archive (file-store) Bot
 * Built with grammy, running on Cloudflare Workers + D1.
 *
 * v2: adds
 *  - Bilingual support (English / Persian) with per-user saved language,
 *    changeable any time via /language.
 *  - A full admin panel (/panel) where every section (Channels, Archives,
 *    Settings, Stats, Language) opens its own inline-keyboard "screen"
 *    with Back/Close buttons, instead of one giant dump of text.
 *  - Archive management: rename, edit description, view/delete individual
 *    files, add more files to an already-finished archive, delete the
 *    whole archive, and see a view counter per archive.
 *  - The panel and every admin-only screen is gated behind isAdmin(). A
 *    normal user only ever sees the force-join flow, exactly as before.
 *
 * Requires two extra columns beyond the original schema.sql (see the
 * migration notes shared alongside this file):
 *   ALTER TABLE users ADD COLUMN lang TEXT;
 *   ALTER TABLE archives ADD COLUMN views INTEGER NOT NULL DEFAULT 0;
 */

import { Bot, InlineKeyboard, Context, webhookCallback } from "grammy";

export interface Env {
  BOT_TOKEN: string;
  BOT_USERNAME: string;
  ENVIRONMENT: string;
  DB: D1Database;
}

const GROUP_PROMPT_DEBOUNCE_SECONDS = 20;
const DEFAULT_AUTO_DELETE_SECONDS = 40;

type Lang = "en" | "fa";
const DEFAULT_LANG: Lang = "en";

type FileRow = {
  file_id: string;
  file_unique_id: string | null;
  file_type: string;
  file_name: string | null;
  caption: string | null;
  order_index: number;
};
type FileRowWithId = FileRow & { id: number };

type ChannelRow = { id: number; channel_id: string; username: string | null; title: string | null };

// =====================================================================
// i18n
// =====================================================================

const STR: Record<Lang, Record<string, string>> = {
  en: {
    choose_lang: "🌐 Please choose your language:\nلطفاً زبان خود را انتخاب کنید:",
    lang_set: "✅ Language set to English.",
    start_hello: "Hello! Send a message to use the bot.",
    join_intro_dm: "Hi there! To use this bot, please join our official channel(s) first:",
    join_intro_archive: "To get these files, please join the required channel(s) first:",
    join_intro_group: ",\nTo use this group, please join our official channel(s) first:\nOnce you've joined, come back to this group.",
    join_button: "🔑 Join {title}",
    check_button: "✅ I've joined",
    verify_error: "An error occurred while checking your membership. Please try again later.",
    verify_missing: "You haven't joined everything yet.",
    verify_success: "Verified! Sending your files...",
    link_invalid_long: "This link is invalid or no longer active.",
    link_invalid: "This link is invalid.",
    link_no_files: "This link has no files.",
    testbit: "Bot is active ✔️",
    creator: "This bot was built with a custom grammy + Cloudflare Workers setup.",

    panel_home_title: "🛠 <b>Admin Panel</b>\nChoose a section:",
    btn_channels: "📢 Channels",
    btn_archives: "📁 Archives",
    btn_settings: "⚙️ Settings",
    btn_stats: "📊 Stats",
    btn_language: "🌐 Language",
    btn_back: "🔙 Back",
    btn_close: "❌ Close",
    panel_closed: "Panel closed.",

    channels_title: "📢 <b>Channels</b> ({count})",
    channels_none: "No channels registered yet.",
    btn_add_channel: "➕ Add channel",
    channel_add_prompt: "Send the channel username, e.g. @mychannel",
    channel_add_usage: "That doesn't look like a username. Send it like: @mychannel",
    channel_added: "✅ Channel {name} added. Make sure the bot is an admin there.",
    channel_add_failed: "Couldn't find {name}. Make sure the bot is already added to that channel (even as a member) and the username is correct.",
    channel_removed: "🗑 Channel removed.",

    archives_title: "📁 <b>Archives</b> ({count})",
    archives_none: "No archives yet. Use /upload to create one.",
    archive_item: "📁 {title} — {count} files, {views} views",
    archive_detail_title:
      "📁 <b>{title}</b>\n\nDescription: {desc}\nLink: {link}\nFiles: {count}\nViews: {views}\nAuto-delete: {delsec}s\nRequired channels: {channels}",
    no_description: "—",
    none_channels: "—",
    btn_rename: "✏️ Rename",
    btn_description: "📝 Description",
    btn_files: "📄 Files ({count})",
    btn_add_files: "➕ Add files",
    btn_delete_archive: "🗑 Delete",
    rename_prompt: "Send the new title for this archive.",
    rename_done: "✅ Title updated.",
    desc_prompt: "Send the new description (or /skip for empty).",
    desc_done: "✅ Description updated.",
    files_title: "📄 <b>Files in \"{title}\"</b> ({count})",
    files_none: "No files in this archive.",
    file_item: "{index}. {type}{name}",
    file_deleted: "🗑 File deleted.",
    addfiles_prompt: "Send the files you want to add to this archive. Press Done when finished.",
    btn_done_back: "✅ Done / Back to archive",
    addfiles_added: "File #{position} added to the archive.",
    delete_confirm_title: 'Are you sure you want to delete "{title}"? This cannot be undone.',
    btn_confirm_delete: "✅ Yes, delete",
    archive_deleted: "🗑 Archive deleted.",

    settings_title: "⚙️ <b>Settings</b>",
    btn_autodelete: "⏱ Auto-delete: {sec}s",
    btn_admins: "👤 Admins ({count})",
    autodelete_prompt: "Send the new auto-delete delay in seconds (applies to newly created links).",
    autodelete_invalid: "Please send a positive number.",
    autodelete_done: "✅ Auto-delete delay set to {sec}s for new links.",
    admins_title: "👤 <b>Admins</b> ({count})",
    btn_add_admin: "➕ Add admin",
    admin_add_prompt: "Send the numeric Telegram ID of the new admin.",
    admin_add_invalid: "Please send a numeric Telegram ID.",
    admin_added: "✅ User {id} is now an admin.",

    stats_title: "📊 <b>Stats</b>\nUsers: {users}\nChannels: {channels}\nArchives: {archives}\nFiles stored: {files}",

    upload_start: "Upload mode started (session #{id}). Send the files you want in this link, one by one. When done, send /done. To cancel, send /cancel.",
    upload_cancelled: "Cancelled.",
    upload_no_active: "No active upload session. Send /upload first, then send files.",
    upload_no_files: "You haven't sent any files yet. Send some files, or /cancel.",
    upload_got_files: "Got {count} file(s). Now send a title for this link.",
    upload_got_title: "Got it. Now send a description, or /skip to leave it empty.",
    upload_no_channels: "No channels are registered yet — add one with /addchannel or the panel before creating a link.",
    upload_pick_channels: "Which channel(s) should be required for this link? Tap to toggle, then Confirm.",
    upload_select_atleast: "Select at least one channel.",
    btn_confirm: "Confirm ✅",
    upload_link_created_toast: "Link created!",
    upload_link_created_text: "✅ Link created:\n{link}",
    file_added_session: "File #{position} added. Send more, or /done to finish.",
  },
  fa: {
    choose_lang: "🌐 لطفاً زبان خود را انتخاب کنید:\nPlease choose your language:",
    lang_set: "✅ زبان به فارسی تغییر کرد.",
    start_hello: "سلام! برای استفاده از ربات یه پیام بفرست.",
    join_intro_dm: "سلام! برای استفاده از این ربات، لطفاً اول عضو کانال(های) رسمی ما بشو:",
    join_intro_archive: "برای دریافت فایل‌ها، لطفاً اول عضو کانال(های) مورد نیاز بشو:",
    join_intro_group: ",\nبرای استفاده از این گروه، لطفاً اول عضو کانال(های) رسمی ما بشو:\nبعد از عضویت، به این گروه برگرد.",
    join_button: "🔑 عضویت در {title}",
    check_button: "✅ عضو شدم",
    verify_error: "خطایی در بررسی عضویت رخ داد. لطفاً بعداً دوباره تلاش کن.",
    verify_missing: "هنوز همه‌ی موارد رو جوین نکردی.",
    verify_success: "تأیید شد! در حال ارسال فایل‌ها...",
    link_invalid_long: "این لینک نامعتبره یا دیگه فعال نیست.",
    link_invalid: "این لینک نامعتبره.",
    link_no_files: "این لینک هیچ فایلی نداره.",
    testbit: "ربات فعاله ✔️",
    creator: "این ربات با ساختار اختصاصی grammy + Cloudflare Workers ساخته شده.",

    panel_home_title: "🛠 <b>پنل مدیریت</b>\nیه بخش رو انتخاب کن:",
    btn_channels: "📢 کانال‌ها",
    btn_archives: "📁 آرشیوها",
    btn_settings: "⚙️ تنظیمات",
    btn_stats: "📊 آمار",
    btn_language: "🌐 زبان",
    btn_back: "🔙 برگشت",
    btn_close: "❌ بستن",
    panel_closed: "پنل بسته شد.",

    channels_title: "📢 <b>کانال‌ها</b> ({count})",
    channels_none: "هنوز کانالی ثبت نشده.",
    btn_add_channel: "➕ افزودن کانال",
    channel_add_prompt: "یوزرنیم کانال رو بفرست، مثلاً @mychannel",
    channel_add_usage: "این شبیه یوزرنیم نیست. این‌طوری بفرست: @mychannel",
    channel_added: "✅ کانال {name} اضافه شد. مطمئن شو ربات اونجا ادمینه.",
    channel_add_failed: "کانال {name} پیدا نشد. مطمئن شو ربات از قبل به اون کانال اضافه شده (حتی به‌عنوان عضو) و یوزرنیم درسته.",
    channel_removed: "🗑 کانال حذف شد.",

    archives_title: "📁 <b>آرشیوها</b> ({count})",
    archives_none: "هنوز آرشیوی نیست. از /upload برای ساختن یکی استفاده کن.",
    archive_item: "📁 {title} — {count} فایل، {views} بازدید",
    archive_detail_title:
      "📁 <b>{title}</b>\n\nتوضیحات: {desc}\nلینک: {link}\nفایل‌ها: {count}\nبازدیدها: {views}\nحذف خودکار: {delsec} ثانیه\nکانال‌های لازم: {channels}",
    no_description: "—",
    none_channels: "—",
    btn_rename: "✏️ تغییر نام",
    btn_description: "📝 توضیحات",
    btn_files: "📄 فایل‌ها ({count})",
    btn_add_files: "➕ افزودن فایل",
    btn_delete_archive: "🗑 حذف",
    rename_prompt: "عنوان جدید این آرشیو رو بفرست.",
    rename_done: "✅ عنوان بروزرسانی شد.",
    desc_prompt: "توضیحات جدید رو بفرست (یا /skip برای خالی گذاشتن).",
    desc_done: "✅ توضیحات بروزرسانی شد.",
    files_title: "📄 <b>فایل‌های «{title}»</b> ({count})",
    files_none: "این آرشیو فایلی نداره.",
    file_item: "{index}. {type}{name}",
    file_deleted: "🗑 فایل حذف شد.",
    addfiles_prompt: "فایل‌هایی که می‌خوای به این آرشیو اضافه بشه رو بفرست. وقتی تموم شد، دکمه‌ی «تمام» رو بزن.",
    btn_done_back: "✅ تمام / برگشت به آرشیو",
    addfiles_added: "فایل #{position} به آرشیو اضافه شد.",
    delete_confirm_title: 'مطمئنی می‌خوای «{title}» رو حذف کنی؟ این کار برگشت‌ناپذیره.',
    btn_confirm_delete: "✅ بله، حذف کن",
    archive_deleted: "🗑 آرشیو حذف شد.",

    settings_title: "⚙️ <b>تنظیمات</b>",
    btn_autodelete: "⏱ حذف خودکار: {sec} ثانیه",
    btn_admins: "👤 ادمین‌ها ({count})",
    autodelete_prompt: "زمان حذف خودکار جدید رو به ثانیه بفرست (فقط روی لینک‌های جدید اعمال میشه).",
    autodelete_invalid: "لطفاً یه عدد مثبت بفرست.",
    autodelete_done: "✅ زمان حذف خودکار برای لینک‌های جدید روی {sec} ثانیه تنظیم شد.",
    admins_title: "👤 <b>ادمین‌ها</b> ({count})",
    btn_add_admin: "➕ افزودن ادمین",
    admin_add_prompt: "آیدی عددی تلگرام ادمین جدید رو بفرست.",
    admin_add_invalid: "لطفاً یه آیدی عددی تلگرام بفرست.",
    admin_added: "✅ کاربر {id} حالا ادمینه.",

    stats_title: "📊 <b>آمار</b>\nکاربران: {users}\nکانال‌ها: {channels}\nآرشیوها: {archives}\nفایل‌های ذخیره‌شده: {files}",

    upload_start: "حالت آپلود شروع شد (سشن #{id}). فایل‌هایی که می‌خوای توی این لینک باشه رو یکی‌یکی بفرست. وقتی تموم شد /done بفرست. برای لغو /cancel بفرست.",
    upload_cancelled: "لغو شد.",
    upload_no_active: "سشن آپلود فعالی نیست. اول /upload بفرست، بعد فایل‌ها رو ارسال کن.",
    upload_no_files: "هنوز هیچ فایلی نفرستادی. یه فایل بفرست یا /cancel بزن.",
    upload_got_files: "{count} فایل دریافت شد. حالا یه عنوان برای این لینک بفرست.",
    upload_got_title: "گرفتم. حالا یه توضیح بفرست، یا /skip برای خالی گذاشتنش.",
    upload_no_channels: "هنوز کانالی ثبت نشده — قبل از ساخت لینک، از /addchannel یا پنل یه کانال اضافه کن.",
    upload_pick_channels: "کدوم کانال(ها) برای این لینک لازمه؟ بزن روشون تا انتخاب بشن، بعد «تأیید».",
    upload_select_atleast: "حداقل یه کانال انتخاب کن.",
    btn_confirm: "تأیید ✅",
    upload_link_created_toast: "لینک ساخته شد!",
    upload_link_created_text: "✅ لینک ساخته شد:\n{link}",
    file_added_session: "فایل #{position} اضافه شد. بیشتر بفرست، یا /done بزن.",
  },
};

function t(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  let s = STR[lang]?.[key] ?? STR[DEFAULT_LANG][key] ?? key;
  if (vars) {
    for (const k of Object.keys(vars)) {
      s = s.split(`{${k}}`).join(String(vars[k]));
    }
  }
  return s;
}

// =====================================================================
// small helpers
// =====================================================================

function now() {
  return Date.now();
}

function escapeHtml(input: string): string {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function generateCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
}

function detectFile(message: any): Omit<FileRow, "order_index"> | null {
  if (message.photo && message.photo.length > 0) {
    const p = message.photo[message.photo.length - 1];
    return { file_id: p.file_id, file_unique_id: p.file_unique_id ?? null, file_type: "photo", file_name: null, caption: message.caption ?? null };
  }
  if (message.video) {
    return { file_id: message.video.file_id, file_unique_id: message.video.file_unique_id ?? null, file_type: "video", file_name: message.video.file_name ?? null, caption: message.caption ?? null };
  }
  if (message.document) {
    return { file_id: message.document.file_id, file_unique_id: message.document.file_unique_id ?? null, file_type: "document", file_name: message.document.file_name ?? null, caption: message.caption ?? null };
  }
  if (message.audio) {
    return { file_id: message.audio.file_id, file_unique_id: message.audio.file_unique_id ?? null, file_type: "audio", file_name: message.audio.file_name ?? null, caption: message.caption ?? null };
  }
  if (message.voice) {
    return { file_id: message.voice.file_id, file_unique_id: message.voice.file_unique_id ?? null, file_type: "voice", file_name: null, caption: message.caption ?? null };
  }
  if (message.animation) {
    return { file_id: message.animation.file_id, file_unique_id: message.animation.file_unique_id ?? null, file_type: "animation", file_name: message.animation.file_name ?? null, caption: message.caption ?? null };
  }
  return null;
}

const SEND_METHOD: Record<string, string> = {
  photo: "sendPhoto",
  video: "sendVideo",
  document: "sendDocument",
  audio: "sendAudio",
  voice: "sendVoice",
  animation: "sendAnimation",
};

const FILE_ICON: Record<string, string> = {
  photo: "🖼",
  video: "🎬",
  document: "📄",
  audio: "🎵",
  voice: "🎙",
  animation: "🎞",
};

async function sendStoredFile(ctx: Context, chatId: number, f: FileRow) {
  const method = SEND_METHOD[f.file_type];
  if (!method) return null;
  // @ts-ignore - dynamic method dispatch on the Bot API
  return await ctx.api[method](chatId, f.file_id, f.caption ? { caption: f.caption } : undefined);
}

// =====================================================================
// D1 data access
// =====================================================================

async function isAdmin(env: Env, telegramId: number): Promise<boolean> {
  const row = await env.DB.prepare("SELECT 1 FROM admins WHERE telegram_id = ?").bind(String(telegramId)).first();
  return !!row;
}

async function adminCount(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) as c FROM admins").first<{ c: number }>();
  return row?.c ?? 0;
}

async function listAdmins(env: Env): Promise<string[]> {
  const res = await env.DB.prepare("SELECT telegram_id FROM admins ORDER BY id ASC").all<{ telegram_id: string }>();
  return (res.results ?? []).map((r) => r.telegram_id);
}

async function addAdmin(env: Env, telegramId: string) {
  await env.DB.prepare("INSERT OR IGNORE INTO admins (telegram_id, created_at) VALUES (?, ?)").bind(telegramId, now()).run();
}

async function upsertUser(env: Env, telegramId: number) {
  const tnow = now();
  await env.DB.prepare(
    `INSERT INTO users (telegram_id, first_seen_at, last_seen_at) VALUES (?, ?, ?)
     ON CONFLICT(telegram_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`
  ).bind(String(telegramId), tnow, tnow).run();
}

async function getUserLang(env: Env, telegramId: number): Promise<Lang | null> {
  const row = await env.DB.prepare("SELECT lang FROM users WHERE telegram_id = ?").bind(String(telegramId)).first<{ lang: string | null }>();
  if (!row || !row.lang) return null;
  return row.lang === "fa" ? "fa" : "en";
}

async function setUserLang(env: Env, telegramId: number, lang: Lang) {
  const tnow = now();
  await env.DB.prepare(
    `INSERT INTO users (telegram_id, first_seen_at, last_seen_at, lang) VALUES (?, ?, ?, ?)
     ON CONFLICT(telegram_id) DO UPDATE SET lang = excluded.lang`
  ).bind(String(telegramId), tnow, tnow, lang).run();
}

async function getLangOrDefault(env: Env, telegramId: number): Promise<Lang> {
  return (await getUserLang(env, telegramId)) ?? DEFAULT_LANG;
}

async function getSetting(env: Env, key: string, fallback: string): Promise<string> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? fallback;
}

async function setSetting(env: Env, key: string, value: string) {
  await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).bind(key, value).run();
}

async function getAllChannels(env: Env): Promise<ChannelRow[]> {
  const res = await env.DB.prepare("SELECT id, channel_id, username, title FROM channels ORDER BY id ASC").all<ChannelRow>();
  return res.results ?? [];
}

async function getArchiveChannels(env: Env, archiveId: number): Promise<ChannelRow[]> {
  const res = await env.DB.prepare(
    `SELECT c.id, c.channel_id, c.username, c.title FROM channels c
     JOIN archive_channels ac ON ac.channel_id = c.id
     WHERE ac.archive_id = ?`
  ).bind(archiveId).all<ChannelRow>();
  return res.results ?? [];
}

async function checkMembership(
  ctx: Context,
  channels: ChannelRow[],
  userId: number
): Promise<{ ok: true; missing: ChannelRow[] } | { ok: false }> {
  const missing: ChannelRow[] = [];
  for (const ch of channels) {
    try {
      const member = await ctx.api.getChatMember(ch.channel_id, userId);
      const isMember = !["left", "kicked"].includes(member.status);
      if (!isMember) missing.push(ch);
    } catch {
      return { ok: false };
    }
  }
  return { ok: true, missing };
}

function joinKeyboard(missing: ChannelRow[], lang: Lang, checkCallbackData?: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const ch of missing) {
    const handle = ch.username ? ch.username.replace("@", "") : null;
    if (handle) {
      kb.url(t(lang, "join_button", { title: ch.title ?? ch.username ?? "" }), `https://t.me/${handle}`).row();
    }
  }
  if (checkCallbackData) {
    kb.text(t(lang, "check_button"), checkCallbackData);
  }
  return kb;
}

// ---------- admin_state (conversation / panel state) ----------

type AdminState = { state: string; context: Record<string, unknown> };

async function getAdminState(env: Env, telegramId: number): Promise<AdminState | null> {
  const row = await env.DB.prepare("SELECT state, context_data FROM admin_state WHERE telegram_id = ?")
    .bind(String(telegramId)).first<{ state: string; context_data: string | null }>();
  if (!row) return null;
  return { state: row.state, context: row.context_data ? JSON.parse(row.context_data) : {} };
}

async function setAdminState(env: Env, telegramId: number, state: string, context: Record<string, unknown>) {
  await env.DB.prepare(
    `INSERT INTO admin_state (telegram_id, state, context_data, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(telegram_id) DO UPDATE SET state = excluded.state, context_data = excluded.context_data, updated_at = excluded.updated_at`
  ).bind(String(telegramId), state, JSON.stringify(context), now()).run();
}

async function clearAdminState(env: Env, telegramId: number) {
  await env.DB.prepare("DELETE FROM admin_state WHERE telegram_id = ?").bind(String(telegramId)).run();
}

// ---------- upload sessions (new-archive creation flow) ----------

async function getActiveSession(env: Env, adminId: number): Promise<{ id: number } | null> {
  const row = await env.DB.prepare(
    "SELECT id FROM upload_sessions WHERE admin_telegram_id = ? AND status = 'collecting' ORDER BY id DESC LIMIT 1"
  ).bind(String(adminId)).first<{ id: number }>();
  return row ?? null;
}

async function startSession(env: Env, adminId: number): Promise<number> {
  const t0 = now();
  const res = await env.DB.prepare(
    "INSERT INTO upload_sessions (admin_telegram_id, status, created_at, updated_at) VALUES (?, 'collecting', ?, ?)"
  ).bind(String(adminId), t0, t0).run();
  return res.meta.last_row_id as number;
}

async function addFileToSession(env: Env, sessionId: number, f: Omit<FileRow, "order_index">) {
  const countRow = await env.DB.prepare("SELECT COUNT(*) as c FROM upload_session_files WHERE session_id = ?")
    .bind(sessionId).first<{ c: number }>();
  const position = (countRow?.c ?? 0) + 1;
  await env.DB.prepare(
    `INSERT INTO upload_session_files (session_id, file_id, file_unique_id, file_type, file_name, caption, order_index, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(sessionId, f.file_id, f.file_unique_id, f.file_type, f.file_name, f.caption, position, now()).run();
  return position;
}

async function getSessionFiles(env: Env, sessionId: number): Promise<FileRow[]> {
  const res = await env.DB.prepare(
    "SELECT file_id, file_unique_id, file_type, file_name, caption, order_index FROM upload_session_files WHERE session_id = ? ORDER BY order_index ASC"
  ).bind(sessionId).all<FileRow>();
  return res.results ?? [];
}

// ---------- finalize archive (new archive) ----------

async function finalizeArchive(
  env: Env,
  sessionId: number,
  title: string,
  description: string | null,
  channelIds: number[]
): Promise<string> {
  const files = await getSessionFiles(env, sessionId);
  const code = generateCode();
  const t0 = now();
  const defaultDelete = parseInt(await getSetting(env, "auto_delete_seconds", String(DEFAULT_AUTO_DELETE_SECONDS)), 10);

  const archiveRes = await env.DB.prepare(
    `INSERT INTO archives (code, title, description, delete_after_seconds, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)`
  ).bind(code, title, description, defaultDelete, t0, t0).run();
  const archiveId = archiveRes.meta.last_row_id as number;

  const statements = [
    ...channelIds.map((cid) =>
      env.DB.prepare("INSERT INTO archive_channels (archive_id, channel_id, created_at) VALUES (?, ?, ?)").bind(archiveId, cid, t0)
    ),
    ...files.map((f) =>
      env.DB.prepare(
        `INSERT INTO files (archive_id, file_id, file_unique_id, file_type, file_name, caption, order_index, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(archiveId, f.file_id, f.file_unique_id, f.file_type, f.file_name, f.caption, f.order_index, t0)
    ),
    env.DB.prepare("DELETE FROM upload_session_files WHERE session_id = ?").bind(sessionId),
    env.DB.prepare("UPDATE upload_sessions SET status = 'finished', updated_at = ? WHERE id = ?").bind(t0, sessionId),
  ];
  if (statements.length > 0) await env.DB.batch(statements);
  return code;
}

async function getArchiveByCode(env: Env, code: string) {
  return env.DB.prepare("SELECT id, title, is_active, delete_after_seconds FROM archives WHERE code = ?")
    .bind(code).first<{ id: number; title: string; is_active: number; delete_after_seconds: number | null }>();
}

async function getArchiveDetail(env: Env, archiveId: number) {
  return env.DB.prepare(
    `SELECT a.id, a.code, a.title, a.description, a.is_active, a.delete_after_seconds, a.views,
            (SELECT COUNT(*) FROM files f WHERE f.archive_id = a.id) as file_count
     FROM archives a WHERE a.id = ?`
  ).bind(archiveId).first<{
    id: number; code: string; title: string; description: string | null;
    is_active: number; delete_after_seconds: number | null; views: number; file_count: number;
  }>();
}

async function listArchivesSummary(env: Env) {
  const res = await env.DB.prepare(
    `SELECT a.id, a.title, a.views, (SELECT COUNT(*) FROM files f WHERE f.archive_id = a.id) as file_count
     FROM archives a ORDER BY a.id DESC LIMIT 40`
  ).all<{ id: number; title: string; views: number; file_count: number }>();
  return res.results ?? [];
}

async function getArchiveFiles(env: Env, archiveId: number): Promise<FileRowWithId[]> {
  const res = await env.DB.prepare(
    "SELECT id, file_id, file_unique_id, file_type, file_name, caption, order_index FROM files WHERE archive_id = ? ORDER BY order_index ASC"
  ).bind(archiveId).all<FileRowWithId>();
  return res.results ?? [];
}

async function addFileToArchiveDirect(env: Env, archiveId: number, f: Omit<FileRow, "order_index">): Promise<number> {
  const maxRow = await env.DB.prepare("SELECT COALESCE(MAX(order_index), 0) as m FROM files WHERE archive_id = ?")
    .bind(archiveId).first<{ m: number }>();
  const position = (maxRow?.m ?? 0) + 1;
  await env.DB.prepare(
    `INSERT INTO files (archive_id, file_id, file_unique_id, file_type, file_name, caption, order_index, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(archiveId, f.file_id, f.file_unique_id, f.file_type, f.file_name, f.caption, position, now()).run();
  return position;
}

async function deleteFileById(env: Env, archiveId: number, fileId: number) {
  await env.DB.prepare("DELETE FROM files WHERE id = ? AND archive_id = ?").bind(fileId, archiveId).run();
}

async function renameArchive(env: Env, archiveId: number, title: string) {
  await env.DB.prepare("UPDATE archives SET title = ?, updated_at = ? WHERE id = ?").bind(title, now(), archiveId).run();
}

async function setArchiveDescription(env: Env, archiveId: number, description: string | null) {
  await env.DB.prepare("UPDATE archives SET description = ?, updated_at = ? WHERE id = ?").bind(description, now(), archiveId).run();
}

async function deleteArchive(env: Env, archiveId: number) {
  // archive_channels and files both cascade-delete via FK ON DELETE CASCADE in schema.sql
  await env.DB.prepare("DELETE FROM archives WHERE id = ?").bind(archiveId).run();
}

async function incrementArchiveViews(env: Env, archiveId: number) {
  await env.DB.prepare("UPDATE archives SET views = views + 1 WHERE id = ?").bind(archiveId).run();
}

// ---------- auto-delete tracking ----------

async function trackSentMessage(
  env: Env,
  userId: number,
  chatId: number,
  messageId: number,
  archiveId: number | null,
  deleteAfterSeconds: number | null
) {
  const deleteAt = deleteAfterSeconds ? now() + deleteAfterSeconds * 1000 : null;
  await env.DB.prepare(
    `INSERT INTO sent_messages (user_telegram_id, chat_id, message_id, archive_id, delete_at, deleted, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`
  ).bind(String(userId), String(chatId), messageId, archiveId, deleteAt, now()).run();
}

async function runDueDeletions(env: Env, bot: Bot): Promise<void> {
  const due = await env.DB.prepare(
    "SELECT id, chat_id, message_id FROM sent_messages WHERE deleted = 0 AND delete_at IS NOT NULL AND delete_at <= ? LIMIT 200"
  ).bind(now()).all<{ id: number; chat_id: string; message_id: number }>();

  for (const row of due.results ?? []) {
    try {
      await bot.api.deleteMessage(row.chat_id, row.message_id);
    } catch {
      // message may already be gone — ignore
    }
    await env.DB.prepare("UPDATE sent_messages SET deleted = 1 WHERE id = ?").bind(row.id).run();
  }
}

// ---------- group-chat join prompt debounce (schema_addendum.sql) ----------

async function getGroupPrompt(env: Env, chatId: number) {
  return env.DB.prepare("SELECT message_id, created_at FROM group_join_prompts WHERE chat_id = ?")
    .bind(String(chatId)).first<{ message_id: number; created_at: number }>();
}

async function setGroupPrompt(env: Env, chatId: number, messageId: number) {
  await env.DB.prepare(
    `INSERT INTO group_join_prompts (chat_id, message_id, created_at) VALUES (?, ?, ?)
     ON CONFLICT(chat_id) DO UPDATE SET message_id = excluded.message_id, created_at = excluded.created_at`
  ).bind(String(chatId), messageId, now()).run();
}

async function clearGroupPrompt(env: Env, chatId: number) {
  await env.DB.prepare("DELETE FROM group_join_prompts WHERE chat_id = ?").bind(String(chatId)).run();
}

// =====================================================================
// Panel screens (each returns text + keyboard; admin-only, gated by caller)
// =====================================================================

type Screen = { text: string; keyboard: InlineKeyboard };

function panelHomeScreen(lang: Lang): Screen {
  const kb = new InlineKeyboard()
    .text(t(lang, "btn_channels"), "p:ch").text(t(lang, "btn_archives"), "p:ar").row()
    .text(t(lang, "btn_settings"), "p:set").text(t(lang, "btn_stats"), "p:stats").row()
    .text(t(lang, "btn_language"), "p:lg").row()
    .text(t(lang, "btn_close"), "p:close");
  return { text: t(lang, "panel_home_title"), keyboard: kb };
}

async function channelsScreen(env: Env, lang: Lang): Promise<Screen> {
  const channels = await getAllChannels(env);
  const kb = new InlineKeyboard();
  for (const ch of channels) {
    const label = ch.title ?? ch.username ?? ch.channel_id;
    kb.text(escapeHtml(label).slice(0, 40), "noop").text("🗑", `p:ch:rm:${ch.id}`).row();
  }
  kb.text(t(lang, "btn_add_channel"), "p:ch:add").row();
  kb.text(t(lang, "btn_back"), "p:home").text(t(lang, "btn_close"), "p:close");
  const text =
    channels.length === 0
      ? `${t(lang, "channels_title", { count: 0 })}\n\n${t(lang, "channels_none")}`
      : t(lang, "channels_title", { count: channels.length });
  return { text, keyboard: kb };
}

async function archivesScreen(env: Env, lang: Lang): Promise<Screen> {
  const archives = await listArchivesSummary(env);
  const kb = new InlineKeyboard();
  for (const a of archives) {
    kb.text(t(lang, "archive_item", { title: escapeHtml(a.title).slice(0, 40), count: a.file_count, views: a.views }), `p:ar:${a.id}`).row();
  }
  kb.text(t(lang, "btn_back"), "p:home").text(t(lang, "btn_close"), "p:close");
  const text =
    archives.length === 0
      ? `${t(lang, "archives_title", { count: 0 })}\n\n${t(lang, "archives_none")}`
      : t(lang, "archives_title", { count: archives.length });
  return { text, keyboard: kb };
}

async function archiveDetailScreen(env: Env, lang: Lang, archiveId: number): Promise<Screen | null> {
  const a = await getArchiveDetail(env, archiveId);
  if (!a) return null;
  const channels = await getArchiveChannels(env, archiveId);
  const channelsText = channels.length
    ? channels.map((c) => escapeHtml(c.title ?? c.username ?? c.channel_id)).join(", ")
    : t(lang, "none_channels");
  const link = `https://t.me/${"{BOT_USERNAME}"}?start=${a.code}`;
  const text = t(lang, "archive_detail_title", {
    title: escapeHtml(a.title),
    desc: a.description ? escapeHtml(a.description) : t(lang, "no_description"),
    link,
    count: a.file_count,
    views: a.views,
    delsec: a.delete_after_seconds ?? "-",
    channels: channelsText,
  });
  const kb = new InlineKeyboard()
    .text(t(lang, "btn_rename"), `p:ar:${archiveId}:rn`).text(t(lang, "btn_description"), `p:ar:${archiveId}:ds`).row()
    .text(t(lang, "btn_files", { count: a.file_count }), `p:ar:${archiveId}:fl`).row()
    .text(t(lang, "btn_add_files"), `p:ar:${archiveId}:af`).row()
    .text(t(lang, "btn_delete_archive"), `p:ar:${archiveId}:dc`).row()
    .text(t(lang, "btn_back"), "p:ar").text(t(lang, "btn_close"), "p:close");
  return { text, keyboard: kb };
}

function fillBotUsername(text: string, botUsername: string): string {
  return text.split("{BOT_USERNAME}").join(botUsername);
}

async function archiveFilesScreen(env: Env, lang: Lang, archiveId: number): Promise<Screen | null> {
  const a = await getArchiveDetail(env, archiveId);
  if (!a) return null;
  const files = await getArchiveFiles(env, archiveId);
  const kb = new InlineKeyboard();
  files.forEach((f, i) => {
    const icon = FILE_ICON[f.file_type] ?? "📎";
    const name = f.file_name ? ` ${escapeHtml(f.file_name)}` : "";
    kb.text(t(lang, "file_item", { index: i + 1, type: icon, name }).slice(0, 60), "noop").text("🗑", `p:fd:${archiveId}:${f.id}`).row();
  });
  kb.text(t(lang, "btn_back"), `p:ar:${archiveId}`).text(t(lang, "btn_close"), "p:close");
  const text =
    files.length === 0
      ? `${t(lang, "files_title", { title: escapeHtml(a.title), count: 0 })}\n\n${t(lang, "files_none")}`
      : t(lang, "files_title", { title: escapeHtml(a.title), count: files.length });
  return { text, keyboard: kb };
}

async function settingsScreen(env: Env, lang: Lang): Promise<Screen> {
  const sec = await getSetting(env, "auto_delete_seconds", String(DEFAULT_AUTO_DELETE_SECONDS));
  const admins = await adminCount(env);
  const kb = new InlineKeyboard()
    .text(t(lang, "btn_autodelete", { sec }), "p:set:ad").row()
    .text(t(lang, "btn_admins", { count: admins }), "p:set:am").row()
    .text(t(lang, "btn_back"), "p:home").text(t(lang, "btn_close"), "p:close");
  return { text: t(lang, "settings_title"), keyboard: kb };
}

async function adminsScreen(env: Env, lang: Lang): Promise<Screen> {
  const admins = await listAdmins(env);
  const list = admins.map((id) => `• <code>${id}</code>`).join("\n");
  const kb = new InlineKeyboard()
    .text(t(lang, "btn_add_admin"), "p:set:am:add").row()
    .text(t(lang, "btn_back"), "p:set").text(t(lang, "btn_close"), "p:close");
  const text = `${t(lang, "admins_title", { count: admins.length })}\n\n${list}`;
  return { text, keyboard: kb };
}

async function statsScreen(env: Env, lang: Lang): Promise<Screen> {
  const [users, archives, files, channels] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) as c FROM users").first<{ c: number }>(),
    env.DB.prepare("SELECT COUNT(*) as c FROM archives").first<{ c: number }>(),
    env.DB.prepare("SELECT COUNT(*) as c FROM files").first<{ c: number }>(),
    env.DB.prepare("SELECT COUNT(*) as c FROM channels").first<{ c: number }>(),
  ]);
  const kb = new InlineKeyboard().text(t(lang, "btn_back"), "p:home").text(t(lang, "btn_close"), "p:close");
  const text = t(lang, "stats_title", {
    users: users?.c ?? 0,
    channels: channels?.c ?? 0,
    archives: archives?.c ?? 0,
    files: files?.c ?? 0,
  });
  return { text, keyboard: kb };
}

function languagePickerScreen(lang: Lang, fromPanel: boolean): Screen {
  const kb = new InlineKeyboard().text("🇬🇧 English", "lang:en").text("🇮🇷 فارسی", "lang:fa");
  if (fromPanel) kb.row().text(t(lang, "btn_back"), "p:home");
  return { text: t(lang, "choose_lang"), keyboard: kb };
}

async function showScreen(ctx: Context, botUsername: string, screen: Screen, viaCallback: boolean) {
  const text = fillBotUsername(screen.text, botUsername);
  if (viaCallback) {
    try {
      await ctx.editMessageText(text, { reply_markup: screen.keyboard, parse_mode: "HTML" });
      return;
    } catch {
      // fall through to sending a fresh message
    }
  }
  await ctx.reply(text, { reply_markup: screen.keyboard, parse_mode: "HTML" });
}

// =====================================================================
// bot construction
// =====================================================================

function buildBot(env: Env): Bot {
  const bot = new Bot(env.BOT_TOKEN);

  // ----- /start (deep link or plain) -----
  bot.command("start", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    await upsertUser(env, userId);

    const payload = ctx.match?.toString().trim();
    const lang = await getUserLang(env, userId);

    if (!lang) {
      if (payload) await setAdminState(env, userId, "pending_start_payload", { payload });
      await ctx.reply(t(DEFAULT_LANG, "choose_lang"), { reply_markup: languagePickerScreen(DEFAULT_LANG, false).keyboard });
      return;
    }

    if (payload) {
      await deliverArchive(ctx, env, userId, payload, lang);
      return;
    }

    await ctx.reply(t(lang, "start_hello"));
  });

  // ----- /language (available to everyone) -----
  bot.command("language", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    const lang = await getLangOrDefault(env, userId);
    const screen = languagePickerScreen(lang, false);
    await ctx.reply(screen.text, { reply_markup: screen.keyboard });
  });

  // ----- /panel (admin only — the new advanced panel) -----
  bot.command("panel", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId || !(await isAdmin(env, userId))) return;
    const lang = await getLangOrDefault(env, userId);
    await clearAdminState(env, userId);
    const screen = panelHomeScreen(lang);
    await showScreen(ctx, env.BOT_USERNAME, screen, false);
  });

  // ----- admin: upload flow (creating a brand-new archive) -----
  bot.command("upload", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId || !(await isAdmin(env, userId))) return;
    const lang = await getLangOrDefault(env, userId);
    const sessionId = await startSession(env, userId);
    await clearAdminState(env, userId);
    await ctx.reply(t(lang, "upload_start", { id: sessionId }));
  });

  bot.command("cancel", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId || !(await isAdmin(env, userId))) return;
    const lang = await getLangOrDefault(env, userId);
    const session = await getActiveSession(env, userId);
    if (session) {
      await env.DB.prepare("UPDATE upload_sessions SET status = 'cancelled', updated_at = ? WHERE id = ?").bind(now(), session.id).run();
      await env.DB.prepare("DELETE FROM upload_session_files WHERE session_id = ?").bind(session.id).run();
    }
    await clearAdminState(env, userId);
    await ctx.reply(t(lang, "upload_cancelled"));
  });

  bot.command("done", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId || !(await isAdmin(env, userId))) return;
    const lang = await getLangOrDefault(env, userId);
    const session = await getActiveSession(env, userId);
    if (!session) {
      await ctx.reply(t(lang, "upload_no_active"));
      return;
    }
    const files = await getSessionFiles(env, session.id);
    if (files.length === 0) {
      await ctx.reply(t(lang, "upload_no_files"));
      return;
    }
    await setAdminState(env, userId, "awaiting_title", { sessionId: session.id });
    await ctx.reply(t(lang, "upload_got_files", { count: files.length }));
  });

  bot.command("skip", async (ctx) => {
    // handled inline where relevant (description steps) — see message handler.
  });

  // ----- callback queries -----
  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    const userId = ctx.from.id;
    const lang = await getLangOrDefault(env, userId);

    if (data === "noop") {
      await ctx.answerCallbackQuery();
      return;
    }

    // ---- language selection (everyone) ----
    if (data.startsWith("lang:")) {
      const newLang: Lang = data.split(":")[1] === "fa" ? "fa" : "en";
      await setUserLang(env, userId, newLang);
      await ctx.answerCallbackQuery({ text: t(newLang, "lang_set") });

      const state = await getAdminState(env, userId);
      if (state && state.state === "pending_start_payload") {
        await clearAdminState(env, userId);
        const payload = state.context.payload as string;
        try {
          await ctx.editMessageText(t(newLang, "lang_set"));
        } catch {
          /* ignore */
        }
        await deliverArchive(ctx, env, userId, payload, newLang);
        return;
      }

      if (await isAdmin(env, userId)) {
        await showScreen(ctx, env.BOT_USERNAME, panelHomeScreen(newLang), true);
      } else {
        try {
          await ctx.editMessageText(t(newLang, "start_hello"));
        } catch {
          await ctx.reply(t(newLang, "start_hello"));
        }
      }
      return;
    }

    // ---- everything below this point is admin-only ----
    if (data.startsWith("p:")) {
      if (!(await isAdmin(env, userId))) {
        await ctx.answerCallbackQuery();
        return;
      }
      const parts = data.split(":"); // p, section, ...rest

      if (data === "p:home") {
        await clearAdminState(env, userId);
        await showScreen(ctx, env.BOT_USERNAME, panelHomeScreen(lang), true);
        await ctx.answerCallbackQuery();
        return;
      }
      if (data === "p:close") {
        await clearAdminState(env, userId);
        try {
          await ctx.editMessageText(t(lang, "panel_closed"));
        } catch {
          /* ignore */
        }
        await ctx.answerCallbackQuery();
        return;
      }
      if (data === "p:lg") {
        await showScreen(ctx, env.BOT_USERNAME, languagePickerScreen(lang, true), true);
        await ctx.answerCallbackQuery();
        return;
      }
      if (data === "p:stats") {
        await showScreen(ctx, env.BOT_USERNAME, await statsScreen(env, lang), true);
        await ctx.answerCallbackQuery();
        return;
      }

      // ---- channels ----
      if (data === "p:ch") {
        await showScreen(ctx, env.BOT_USERNAME, await channelsScreen(env, lang), true);
        await ctx.answerCallbackQuery();
        return;
      }
      if (data === "p:ch:add") {
        await setAdminState(env, userId, "await_ch_add", {});
        await ctx.answerCallbackQuery();
        await ctx.reply(t(lang, "channel_add_prompt"));
        return;
      }
      if (parts[1] === "ch" && parts[2] === "rm") {
        const chId = parseInt(parts[3], 10);
        await env.DB.prepare("DELETE FROM channels WHERE id = ?").bind(chId).run();
        await ctx.answerCallbackQuery({ text: t(lang, "channel_removed") });
        await showScreen(ctx, env.BOT_USERNAME, await channelsScreen(env, lang), true);
        return;
      }

      // ---- archives list / detail ----
      if (data === "p:ar") {
        await showScreen(ctx, env.BOT_USERNAME, await archivesScreen(env, lang), true);
        await ctx.answerCallbackQuery();
        return;
      }
      if (parts[1] === "ar" && parts.length === 3 && !isNaN(parseInt(parts[2], 10))) {
        const archiveId = parseInt(parts[2], 10);
        const screen = await archiveDetailScreen(env, lang, archiveId);
        if (!screen) {
          await ctx.answerCallbackQuery();
          return;
        }
        await showScreen(ctx, env.BOT_USERNAME, screen, true);
        await ctx.answerCallbackQuery();
        return;
      }
      if (parts[1] === "ar" && parts[3] === "rn") {
        const archiveId = parseInt(parts[2], 10);
        await setAdminState(env, userId, "await_ar_rename", { archiveId });
        await ctx.answerCallbackQuery();
        await ctx.reply(t(lang, "rename_prompt"));
        return;
      }
      if (parts[1] === "ar" && parts[3] === "ds") {
        const archiveId = parseInt(parts[2], 10);
        await setAdminState(env, userId, "await_ar_desc", { archiveId });
        await ctx.answerCallbackQuery();
        await ctx.reply(t(lang, "desc_prompt"));
        return;
      }
      if (parts[1] === "ar" && parts[3] === "fl") {
        const archiveId = parseInt(parts[2], 10);
        const screen = await archiveFilesScreen(env, lang, archiveId);
        if (screen) await showScreen(ctx, env.BOT_USERNAME, screen, true);
        await ctx.answerCallbackQuery();
        return;
      }
      if (parts[1] === "ar" && parts[3] === "af") {
        const archiveId = parseInt(parts[2], 10);
        await setAdminState(env, userId, "await_ar_addfiles", { archiveId });
        await ctx.answerCallbackQuery();
        const kb = new InlineKeyboard().text(t(lang, "btn_done_back"), `p:ar:${archiveId}:afdone`);
        await ctx.reply(t(lang, "addfiles_prompt"), { reply_markup: kb });
        return;
      }
      if (parts[1] === "ar" && parts[3] === "afdone") {
        const archiveId = parseInt(parts[2], 10);
        await clearAdminState(env, userId);
        const screen = await archiveDetailScreen(env, lang, archiveId);
        await ctx.answerCallbackQuery();
        if (screen) await showScreen(ctx, env.BOT_USERNAME, screen, true);
        return;
      }
      if (parts[1] === "ar" && parts[3] === "dc") {
        const archiveId = parseInt(parts[2], 10);
        const a = await getArchiveDetail(env, archiveId);
        if (!a) {
          await ctx.answerCallbackQuery();
          return;
        }
        const kb = new InlineKeyboard()
          .text(t(lang, "btn_confirm_delete"), `p:ar:${archiveId}:dd`).row()
          .text(t(lang, "btn_back"), `p:ar:${archiveId}`);
        await ctx.editMessageText(t(lang, "delete_confirm_title", { title: escapeHtml(a.title) }), { reply_markup: kb, parse_mode: "HTML" });
        await ctx.answerCallbackQuery();
        return;
      }
      if (parts[1] === "ar" && parts[3] === "dd") {
        const archiveId = parseInt(parts[2], 10);
        await deleteArchive(env, archiveId);
        await ctx.answerCallbackQuery({ text: t(lang, "archive_deleted") });
        await showScreen(ctx, env.BOT_USERNAME, await archivesScreen(env, lang), true);
        return;
      }

      // ---- file delete inside an archive ----
      if (parts[1] === "fd") {
        const archiveId = parseInt(parts[2], 10);
        const fileId = parseInt(parts[3], 10);
        await deleteFileById(env, archiveId, fileId);
        await ctx.answerCallbackQuery({ text: t(lang, "file_deleted") });
        const screen = await archiveFilesScreen(env, lang, archiveId);
        if (screen) await showScreen(ctx, env.BOT_USERNAME, screen, true);
        return;
      }

      // ---- settings ----
      if (data === "p:set") {
        await showScreen(ctx, env.BOT_USERNAME, await settingsScreen(env, lang), true);
        await ctx.answerCallbackQuery();
        return;
      }
      if (data === "p:set:ad") {
        await setAdminState(env, userId, "await_autodelete", {});
        await ctx.answerCallbackQuery();
        await ctx.reply(t(lang, "autodelete_prompt"));
        return;
      }
      if (data === "p:set:am") {
        await showScreen(ctx, env.BOT_USERNAME, await adminsScreen(env, lang), true);
        await ctx.answerCallbackQuery();
        return;
      }
      if (data === "p:set:am:add") {
        await setAdminState(env, userId, "await_admin_add", {});
        await ctx.answerCallbackQuery();
        await ctx.reply(t(lang, "admin_add_prompt"));
        return;
      }

      await ctx.answerCallbackQuery();
      return;
    }

    // ---- existing new-archive creation callbacks (channel picker) ----
    if (data.startsWith("chsel:")) {
      if (!(await isAdmin(env, userId))) return ctx.answerCallbackQuery();
      const [, sessionIdStr, channelIdStr] = data.split(":");
      const state = await getAdminState(env, userId);
      if (!state || state.state !== "awaiting_channels") return ctx.answerCallbackQuery();
      const selected: number[] = (state.context.selected as number[]) ?? [];
      const channelId = parseInt(channelIdStr, 10);
      const idx = selected.indexOf(channelId);
      if (idx >= 0) selected.splice(idx, 1);
      else selected.push(channelId);
      await setAdminState(env, userId, "awaiting_channels", { ...state.context, selected });
      const channels = await getAllChannels(env);
      await ctx.editMessageReplyMarkup({ reply_markup: buildChannelPickerKeyboard(channels, selected, sessionIdStr, lang) });
      await ctx.answerCallbackQuery();
      return;
    }

    if (data.startsWith("chconfirm:")) {
      if (!(await isAdmin(env, userId))) return ctx.answerCallbackQuery();
      const sessionId = parseInt(data.split(":")[1], 10);
      const state = await getAdminState(env, userId);
      if (!state || state.state !== "awaiting_channels") return ctx.answerCallbackQuery();
      const selected: number[] = (state.context.selected as number[]) ?? [];
      if (selected.length === 0) {
        await ctx.answerCallbackQuery({ text: t(lang, "upload_select_atleast") });
        return;
      }
      const title = state.context.title as string;
      const description = (state.context.description as string | null) ?? null;
      const code = await finalizeArchive(env, sessionId, title, description, selected);
      await clearAdminState(env, userId);
      await ctx.answerCallbackQuery({ text: t(lang, "upload_link_created_toast") });
      await ctx.editMessageText(t(lang, "upload_link_created_text", { link: `https://t.me/${env.BOT_USERNAME}?start=${code}` }));
      return;
    }

    // ---- force-join re-check ----
    if (data.startsWith("check:")) {
      const code = data.slice("check:".length);
      const archive = await getArchiveByCode(env, code);
      if (!archive) {
        await ctx.answerCallbackQuery({ text: t(lang, "link_invalid") });
        return;
      }
      const channels = await getArchiveChannels(env, archive.id);
      const membership = await checkMembership(ctx, channels, userId);
      if (!membership.ok) {
        await ctx.answerCallbackQuery({ text: t(lang, "verify_error") });
        return;
      }
      if (membership.missing.length > 0) {
        await ctx.answerCallbackQuery({ text: t(lang, "verify_missing") });
        await ctx.editMessageReplyMarkup({ reply_markup: joinKeyboard(membership.missing, lang, `check:${code}`) });
        return;
      }
      await ctx.answerCallbackQuery({ text: t(lang, "verify_success") });
      try {
        await ctx.deleteMessage();
      } catch {
        /* ignore */
      }
      await sendArchiveFiles(ctx, env, userId, archive);
      return;
    }

    await ctx.answerCallbackQuery();
  });

  // ----- plain messages: file uploads, admin conversation steps, testbit/creator, force-join gate -----
  bot.on("message", async (ctx) => {
    const userId = ctx.from?.id;
    const chatType = ctx.chat.type;
    if (!userId) return;

    if (chatType === "group" || chatType === "supergroup") {
      await handleGroupMessage(ctx, env);
      return;
    }
    if (chatType !== "private") return;

    await upsertUser(env, userId);
    const lang = await getLangOrDefault(env, userId);
    const admin = await isAdmin(env, userId);

    if (admin) {
      const state = await getAdminState(env, userId);

      // Adding files to an existing (already-finalized) archive
      if (state && state.state === "await_ar_addfiles") {
        const archiveId = state.context.archiveId as number;
        const file = detectFile(ctx.message);
        if (file) {
          const position = await addFileToArchiveDirect(env, archiveId, file);
          const kb = new InlineKeyboard().text(t(lang, "btn_done_back"), `p:ar:${archiveId}:afdone`);
          await ctx.reply(t(lang, "addfiles_added", { position }), { reply_markup: kb });
          return;
        }
      }

      // Receiving files for an active "create new archive" upload session
      const session = await getActiveSession(env, userId);
      if (session && (!state || state.state !== "await_ar_addfiles")) {
        const file = detectFile(ctx.message);
        if (file) {
          const position = await addFileToSession(env, session.id, file);
          await ctx.reply(t(lang, "file_added_session", { position }));
          return;
        }
      }

      // Panel text-input steps
      if (state && ctx.message.text) {
        const text = ctx.message.text.trim();

        if (state.state === "await_ch_add") {
          await clearAdminState(env, userId);
          if (!text.startsWith("@")) {
            await ctx.reply(t(lang, "channel_add_usage"));
          } else {
            try {
              const chat = await ctx.api.getChat(text);
              const title = "title" in chat ? chat.title ?? null : null;
              await env.DB.prepare(
                `INSERT INTO channels (channel_id, username, title, created_at) VALUES (?, ?, ?, ?)
                 ON CONFLICT(channel_id) DO UPDATE SET username = excluded.username, title = excluded.title`
              ).bind(String(chat.id), text, title, now()).run();
              await ctx.reply(t(lang, "channel_added", { name: text }));
            } catch {
              await ctx.reply(t(lang, "channel_add_failed", { name: text }));
            }
          }
          await showScreen(ctx, env.BOT_USERNAME, await channelsScreen(env, lang), false);
          return;
        }

        if (state.state === "await_ar_rename") {
          const archiveId = state.context.archiveId as number;
          await clearAdminState(env, userId);
          await renameArchive(env, archiveId, text);
          await ctx.reply(t(lang, "rename_done"));
          const screen = await archiveDetailScreen(env, lang, archiveId);
          if (screen) await showScreen(ctx, env.BOT_USERNAME, screen, false);
          return;
        }

        if (state.state === "await_ar_desc") {
          const archiveId = state.context.archiveId as number;
          await clearAdminState(env, userId);
          const desc = text === "/skip" ? null : text;
          await setArchiveDescription(env, archiveId, desc);
          await ctx.reply(t(lang, "desc_done"));
          const screen = await archiveDetailScreen(env, lang, archiveId);
          if (screen) await showScreen(ctx, env.BOT_USERNAME, screen, false);
          return;
        }

        if (state.state === "await_autodelete") {
          const seconds = parseInt(text, 10);
          if (!Number.isFinite(seconds) || seconds <= 0) {
            await ctx.reply(t(lang, "autodelete_invalid"));
            return;
          }
          await clearAdminState(env, userId);
          await setSetting(env, "auto_delete_seconds", String(seconds));
          await ctx.reply(t(lang, "autodelete_done", { sec: seconds }));
          await showScreen(ctx, env.BOT_USERNAME, await settingsScreen(env, lang), false);
          return;
        }

        if (state.state === "await_admin_add") {
          if (!/^\d+$/.test(text)) {
            await ctx.reply(t(lang, "admin_add_invalid"));
            return;
          }
          await clearAdminState(env, userId);
          await addAdmin(env, text);
          await ctx.reply(t(lang, "admin_added", { id: text }));
          await showScreen(ctx, env.BOT_USERNAME, await adminsScreen(env, lang), false);
          return;
        }

        // ----- original new-archive creation conversation -----
        if (state.state === "awaiting_title") {
          await setAdminState(env, userId, "awaiting_description", { ...state.context, title: text });
          await ctx.reply(t(lang, "upload_got_title"));
          return;
        }

        if (state.state === "awaiting_description") {
          const description = text === "/skip" ? null : text;
          const channels = await getAllChannels(env);
          if (channels.length === 0) {
            await ctx.reply(t(lang, "upload_no_channels"));
            await clearAdminState(env, userId);
            return;
          }
          await setAdminState(env, userId, "awaiting_channels", { ...state.context, description, selected: [] });
          await ctx.reply(t(lang, "upload_pick_channels"), {
            reply_markup: buildChannelPickerKeyboard(channels, [], String(state.context.sessionId), lang),
          });
          return;
        }
      }
    }

    // Everyone else (or admin with nothing pending): normal commands / force-join gate
    if (ctx.message.text) {
      const text = ctx.message.text.trim();
      if (text.toLowerCase() === "testbit") {
        await ctx.reply(t(lang, "testbit"));
        return;
      }
      if (text.toLowerCase() === "creator") {
        await ctx.reply(t(lang, "creator"));
        return;
      }
    }

    if (!admin) {
      const channels = await getAllChannels(env);
      if (channels.length > 0) {
        const membership = await checkMembership(ctx, channels, userId);
        if (!membership.ok) {
          await ctx.reply(t(lang, "verify_error"));
          return;
        }
        if (membership.missing.length > 0) {
          await ctx.reply(t(lang, "join_intro_dm"), { reply_markup: joinKeyboard(membership.missing, lang) });
          return;
        }
      }
    }
  });

  return bot;
}

function buildChannelPickerKeyboard(channels: ChannelRow[], selected: number[], sessionId: string, lang: Lang): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const ch of channels) {
    const mark = selected.includes(ch.id) ? "✅ " : "";
    kb.text(`${mark}${ch.title ?? ch.username ?? ch.channel_id}`, `chsel:${sessionId}:${ch.id}`).row();
  }
  kb.text(t(lang, "btn_confirm"), `chconfirm:${sessionId}`);
  return kb;
}

async function deliverArchive(ctx: Context, env: Env, userId: number, code: string, lang: Lang) {
  const archive = await getArchiveByCode(env, code);
  if (!archive || !archive.is_active) {
    await ctx.reply(t(lang, "link_invalid_long"));
    return;
  }

  const admin = await isAdmin(env, userId);
  if (!admin) {
    const channels = await getArchiveChannels(env, archive.id);
    const membership = await checkMembership(ctx, channels, userId);
    if (!membership.ok) {
      await ctx.reply(t(lang, "verify_error"));
      return;
    }
    if (membership.missing.length > 0) {
      await ctx.reply(t(lang, "join_intro_archive"), { reply_markup: joinKeyboard(membership.missing, lang, `check:${code}`) });
      return;
    }
  }

  await sendArchiveFiles(ctx, env, userId, archive);
}

async function sendArchiveFiles(
  ctx: Context,
  env: Env,
  userId: number,
  archive: { id: number; delete_after_seconds: number | null }
) {
  const lang = await getLangOrDefault(env, userId);
  const files = await getArchiveFiles(env, archive.id);
  if (files.length === 0) {
    await ctx.reply(t(lang, "link_no_files"));
    return;
  }

  const chatId = ctx.chat!.id;
  let delivered = false;
  for (const f of files) {
    const sent = await sendStoredFile(ctx, chatId, f);
    if (sent && "message_id" in sent) {
      delivered = true;
      await trackSentMessage(env, userId, chatId, sent.message_id, archive.id, archive.delete_after_seconds);
    }
  }
  if (delivered) await incrementArchiveViews(env, archive.id);
}

async function handleGroupMessage(ctx: Context, env: Env) {
  const userId = ctx.from?.id;
  const chat = ctx.chat;
  if (!userId || !chat) return;

  const lang: Lang = (await getSetting(env, "default_group_lang", DEFAULT_LANG)) === "fa" ? "fa" : "en";

  const channels = await getAllChannels(env);
  if (channels.length === 0) return; // nothing configured — don't restrict groups

  const membership = await checkMembership(ctx, channels, userId);
  if (!membership.ok) return; // can't verify — fail open rather than deleting messages incorrectly
  if (membership.missing.length === 0) return;

  try {
    await ctx.deleteMessage();
  } catch {
    /* ignore */
  }

  const existing = await getGroupPrompt(env, chat.id);
  if (existing && now() - existing.created_at < GROUP_PROMPT_DEBOUNCE_SECONDS * 1000) {
    return; // already nudged recently
  }
  if (existing) {
    try {
      await ctx.api.deleteMessage(chat.id, existing.message_id);
    } catch {
      /* ignore */
    }
  }

  const from = ctx.from!;
  const displayName = escapeHtml(`${from.first_name ?? ""} ${from.last_name ?? ""}`.trim() || "User");
  const userLink = from.username ? `https://t.me/${from.username}` : `tg://user?id=${from.id}`;
  const mention = `<a href="${userLink}">${displayName}</a>`;

  const sent = await ctx.api.sendMessage(
    chat.id,
    `${mention}${t(lang, "join_intro_group")}`,
    { parse_mode: "HTML", reply_markup: joinKeyboard(membership.missing, lang) }
  );
  await setGroupPrompt(env, chat.id, sent.message_id);
}

// ---------- Worker entrypoint ----------

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const bot = buildBot(env);
    return webhookCallback(bot, "cloudflare-mod")(request);
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const bot = buildBot(env);
    ctx.waitUntil(runDueDeletions(env, bot));
  },
};
