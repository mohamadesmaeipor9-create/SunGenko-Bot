/**
 * BUILD MARKER: v2.1-channelpicker-fix (2026-07-24)
 * If you don't see this comment in your local file, you are NOT looking
 * at the patched version — re-download and fully replace index.ts.
 *
 * SunGenko Force-Join + Archive (file-store) Bot — v2
 * Built with grammy, running on Cloudflare Workers + D1.
 *
 * v2 changes (single-file rewrite, no new modules):
 *  - Full inline-panel admin UI (persistent bottom keyboard + in-place
 *    edited "windows" for every section), replacing the old text commands.
 *  - Channel management panel: connect (username OR forwarded message) +
 *    connected list with per-channel delete.
 *  - Upload panel: title + description + files + cancel, unchanged DB
 *    shape (only file_id links are stored, never the file itself).
 *  - Archive management panel: browse archives, edit title/description,
 *    add/remove files, activate/deactivate, delete.
 *  - Stats panel backed by a new lightweight `events` log table
 *    (see schema_addendum_3.sql).
 *  - Settings panel: language (fa/en) + auto-delete timer presets.
 *  - Full bilingual (fa/en) support throughout, including everything new.
 *
 * Requires (in addition to schema.sql / schema_addendum.sql /
 * schema_addendum_2.sql): schema_addendum_3.sql — adds the `events` table.
 */

import { Bot, InlineKeyboard, Keyboard, Context, webhookCallback } from "grammy";

export interface Env {
  BOT_TOKEN: string;
  BOT_USERNAME: string;
  ENVIRONMENT: string;
  DB: D1Database;
}

// =========================================================================
// Constants
// =========================================================================

const GROUP_PROMPT_DEBOUNCE_SECONDS = 20;
const DEFAULT_AUTO_DELETE_SECONDS = 40;
const AUTO_DELETE_PRESETS = [0, 30, 60, 300, 600, 3600];
const CHANNELS_PAGE_SIZE = 8;
const ARCHIVES_PAGE_SIZE = 6;
const DEFAULT_LANG: Lang = "fa";

// =========================================================================
// i18n
// =========================================================================

type Lang = "fa" | "en";

const T = {
  fa: {
    welcome_user: "خوش آمدید 👋",
    welcome_admin: "خوش آمدید، مدیر عزیز.\nبرای مدیریت ربات از دکمه‌های پایین صفحه استفاده کنید.",
    invalid_or_inactive_link: "این لینک نامعتبر یا غیرفعال است.",
    error_checking_membership: "خطایی در بررسی عضویت رخ داد. لطفاً دوباره تلاش کنید.",
    please_join_channels: "برای استفاده از ربات، لطفاً ابتدا در کانال(های) زیر عضو شوید:",
    please_join_to_get_files: "برای دریافت فایل‌ها، لطفاً ابتدا در کانال(های) زیر عضو شوید:",
    btn_joined: "✅ عضو شدم",
    not_joined_yet: "هنوز در همه کانال‌ها عضو نشده‌اید.",
    verified_sending: "تأیید شد! در حال ارسال فایل‌ها...",
    archive_empty: "این لینک هیچ فایلی ندارد.",
    testbit_reply: "ربات فعال است ✔️",
    creator_reply: "این ربات با grammy + Cloudflare Workers ساخته شده است.",
    group_join_notice: "برای استفاده از این گروه، لطفاً ابتدا در کانال(های) زیر عضو شوید:\nبعد از عضویت، به گروه برگردید.",

    // main reply keyboard
    btn_upload: "📤 آپلود آرشیو",
    btn_channels: "📁 مدیریت کانال‌ها",
    btn_archives: "🗂 مدیریت آرشیوها",
    btn_stats: "📊 آمار",
    btn_info: "🔍 اطلاعات ربات",
    btn_broadcast: "📢 پیام همگانی",
    btn_settings: "⚙️ تنظیمات",

    // generic
    btn_back: "🔙 بازگشت",
    btn_close: "✖️ بستن",
    btn_cancel: "❌ لغو",
    btn_confirm: "✅ تأیید",
    btn_skip: "⏭ رد کردن",
    btn_delete: "🗑 حذف",
    btn_edit: "✏️ ویرایش",
    btn_yes_delete: "✅ بله، حذف کن",
    btn_no: "↩️ خیر",
    cancelled: "❌ لغو شد.",
    not_admin: "شما دسترسی مدیریت ندارید.",
    unknown_state_reset: "وضعیت نامعتبر بود، دوباره تلاش کنید.",

    // channel management
    channels_panel_title: "📁 مدیریت کانال‌ها\n\nیکی از گزینه‌ها را انتخاب کنید:",
    btn_connect_channel: "➕ اتصال کانال جدید",
    btn_channel_list: "📋 لیست کانال‌های متصل",
    connect_channel_prompt:
      "یوزرنیم کانال را با @ ارسال کنید (مثال: @mychannel)\nیا یک پیام از همان کانال را برای من فوروارد کنید (برای کانال‌های خصوصی).\n\n⚠️ ربات باید از قبل در آن کانال عضو/ادمین باشد.",
    channel_added_ok: "✅ کانال «{title}» با موفقیت متصل شد.",
    channel_add_fail:
      "❌ کانال پیدا نشد. مطمئن شوید ربات از قبل عضو آن کانال است و یوزرنیم درست وارد شده.",
    channel_already_exists: "این کانال قبلاً متصل شده است.",
    no_channels_yet: "هنوز هیچ کانالی متصل نشده است.",
    channels_list_title: "📋 کانال‌های متصل ({count}):",
    channel_detail_title: "📡 کانال:\n{title}\n{handle}",
    channel_delete_confirm: "آیا از حذف کانال «{title}» مطمئن هستید؟\nآرشیوهایی که به این کانال وابسته‌اند، دیگر شرط این کانال را نخواهند داشت.",
    channel_deleted_ok: "🗑 کانال حذف شد.",

    // upload flow
    upload_start_prompt:
      "📤 حالت آپلود آغاز شد.\nفایل‌های خود را یکی‌یکی ارسال کنید (عکس، ویدیو، سند، صوت، ویس، گیف).\n\nفایل‌های دریافت‌شده: {count}",
    upload_file_added: "📤 حالت آپلود\n\nفایل‌های دریافت‌شده: {count}\nبرای پایان دادن یا لغو، از دکمه‌های زیر استفاده کنید.",
    upload_no_files: "هنوز فایلی ارسال نکرده‌اید. یک فایل بفرستید یا لغو کنید.",
    upload_ask_title: "✅ {count} فایل دریافت شد.\n\nحالا یک عنوان برای این آرشیو ارسال کنید:",
    upload_ask_description: "عنوان: «{title}»\n\nحالا توضیحات این آرشیو را ارسال کنید (یا رد کنید):",
    upload_ask_channels: "کدام کانال(ها) برای دریافت این آرشیو الزامی باشند؟\nروی موارد مورد نظر بزنید، سپس تأیید کنید.",
    upload_need_one_channel: "حداقل یک کانال انتخاب کنید.",
    upload_need_channels_first: "هنوز هیچ کانالی متصل نیست. ابتدا از بخش «مدیریت کانال‌ها» یک کانال اضافه کنید.",
    upload_done: "✅ آرشیو ساخته شد!\n\nعنوان: {title}\nتعداد فایل: {count}\n\nلینک اشتراک‌گذاری:\n{link}",
    btn_upload_done: "✅ پایان آپلود",

    // archive management
    archives_panel_title: "🗂 مدیریت آرشیوها",
    no_archives_yet: "هنوز هیچ آرشیوی ساخته نشده است.",
    archives_list_title: "🗂 آرشیوها ({count}):",
    archive_detail:
      "🗂 {title}\n{status}\n\nتوضیحات: {description}\nفایل‌ها: {file_count}\nبازدید: {views}\nکد: {code}\nکانال(های) لازم: {channels}",
    archive_active: "🟢 فعال",
    archive_inactive: "🔴 غیرفعال",
    no_description: "—",
    btn_edit_title: "✏️ ویرایش عنوان",
    btn_edit_desc: "✏️ ویرایش توضیحات",
    btn_manage_files: "🖼 مدیریت فایل‌ها",
    btn_toggle_active: "🔁 تغییر وضعیت فعال/غیرفعال",
    btn_delete_archive: "🗑 حذف آرشیو",
    archive_delete_confirm: "آیا از حذف کامل آرشیو «{title}» و همه فایل‌های آن مطمئن هستید؟ این کار برگشت‌ناپذیر است.",
    archive_deleted_ok: "🗑 آرشیو حذف شد.",
    archive_status_changed: "✅ وضعیت آرشیو تغییر کرد.",
    edit_title_prompt: "عنوان جدید را ارسال کنید:",
    edit_desc_prompt: "توضیحات جدید را ارسال کنید (یا برای خالی کردن، - ارسال کنید):",
    title_updated: "✅ عنوان به‌روزرسانی شد.",
    desc_updated: "✅ توضیحات به‌روزرسانی شد.",
    manage_files_title: "🖼 فایل‌های «{title}» ({count}):\n\nبرای حذف روی فایل مورد نظر بزنید، یا فایل جدید ارسال کنید تا اضافه شود.",
    file_added_to_archive: "✅ فایل اضافه شد. مجموع: {count}",
    file_deleted_ok: "🗑 فایل حذف شد.",
    btn_done_editing_files: "✅ پایان ویرایش فایل‌ها",

    // stats
    stats_title: "📊 آمار ربات",
    stats_body:
      "👥 کاربران: {users}\n   (۲۴ ساعت اخیر: {users_today} | ۷ روز اخیر: {users_week})\n\n📁 کانال‌ها: {channels}\n🗂 آرشیوها: {archives} (فعال: {active_archives})\n🖼 فایل‌های ذخیره‌شده: {files}\n\n👁 مجموع بازدید آرشیوها: {views}\n📬 تحویل موفق فایل: {deliveries}\n🚪 شروع‌های ربات (/start): {starts}\n\n🏆 پربازدیدترین آرشیوها:\n{top_archives}",
    no_data: "داده‌ای وجود ندارد.",
    btn_refresh: "🔄 به‌روزرسانی",

    // bot info
    info_title: "🔍 اطلاعات ربات",
    info_body:
      "نام کاربری: @{username}\nمحیط: {env}\nمدیران: {admins}\nکانال‌های متصل: {channels}\nآرشیوها: {archives}\nتاخیر پیش‌فرض حذف خودکار: {autodel} ثانیه",

    // broadcast
    broadcast_prompt: "پیامی که می‌خواهید برای همه کاربران ارسال شود را بفرستید (متن، عکس، ویدیو و ...).",
    broadcast_sending: "⏳ در حال ارسال به {count} کاربر...",
    broadcast_done: "✅ ارسال شد.\nموفق: {ok} | ناموفق: {fail}",

    // settings
    settings_title: "⚙️ تنظیمات",
    btn_language: "🌐 زبان",
    btn_autodelete: "⏱ حذف خودکار پیام",
    language_prompt: "زبان مورد نظر را انتخاب کنید:",
    language_set_ok: "✅ زبان به فارسی تغییر کرد.",
    autodelete_prompt: "تأخیر پیش‌فرض حذف خودکار پیام‌ها را انتخاب کنید (برای لینک‌های جدید):\nمقدار فعلی: {current} ثانیه",
    autodelete_off: "غیرفعال",
    autodelete_custom: "✍️ مقدار دلخواه",
    autodelete_custom_prompt: "مقدار دلخواه را به ثانیه ارسال کنید (عدد صحیح مثبت):",
    autodelete_set_ok: "✅ تأخیر حذف خودکار روی {seconds} ثانیه تنظیم شد.",
    invalid_number: "عدد نامعتبر است.",
  },
  en: {
    welcome_user: "Welcome 👋",
    welcome_admin: "Welcome, admin.\nUse the buttons below to manage the bot.",
    invalid_or_inactive_link: "This link is invalid or no longer active.",
    error_checking_membership: "An error occurred while checking your membership. Please try again.",
    please_join_channels: "To use this bot, please join the following channel(s) first:",
    please_join_to_get_files: "To get these files, please join the following channel(s) first:",
    btn_joined: "✅ I've joined",
    not_joined_yet: "You haven't joined everything yet.",
    verified_sending: "Verified! Sending your files...",
    archive_empty: "This link has no files.",
    testbit_reply: "Bot is active ✔️",
    creator_reply: "This bot was built with grammy + Cloudflare Workers.",
    group_join_notice: "To use this group, please join the following channel(s) first:\nCome back once you've joined.",

    btn_upload: "📤 Upload Archive",
    btn_channels: "📁 Channel Management",
    btn_archives: "🗂 Archive Management",
    btn_stats: "📊 Statistics",
    btn_info: "🔍 Bot Info",
    btn_broadcast: "📢 Broadcast",
    btn_settings: "⚙️ Settings",

    btn_back: "🔙 Back",
    btn_close: "✖️ Close",
    btn_cancel: "❌ Cancel",
    btn_confirm: "✅ Confirm",
    btn_skip: "⏭ Skip",
    btn_delete: "🗑 Delete",
    btn_edit: "✏️ Edit",
    btn_yes_delete: "✅ Yes, delete",
    btn_no: "↩️ No",
    cancelled: "❌ Cancelled.",
    not_admin: "You don't have admin access.",
    unknown_state_reset: "Invalid state, please try again.",

    channels_panel_title: "📁 Channel Management\n\nChoose an option:",
    btn_connect_channel: "➕ Connect New Channel",
    btn_channel_list: "📋 Connected Channels List",
    connect_channel_prompt:
      "Send the channel username with @ (e.g. @mychannel)\nor forward a message from that channel to me (for private channels).\n\n⚠️ The bot must already be a member/admin of that channel.",
    channel_added_ok: "✅ Channel \"{title}\" connected successfully.",
    channel_add_fail:
      "❌ Channel not found. Make sure the bot is already a member of that channel and the username is correct.",
    channel_already_exists: "This channel is already connected.",
    no_channels_yet: "No channels connected yet.",
    channels_list_title: "📋 Connected channels ({count}):",
    channel_detail_title: "📡 Channel:\n{title}\n{handle}",
    channel_delete_confirm: "Are you sure you want to remove channel \"{title}\"?\nArchives that depended on it will no longer require it.",
    channel_deleted_ok: "🗑 Channel removed.",

    upload_start_prompt:
      "📤 Upload mode started.\nSend your files one by one (photo, video, document, audio, voice, animation).\n\nFiles received: {count}",
    upload_file_added: "📤 Upload mode\n\nFiles received: {count}\nUse the buttons below to finish or cancel.",
    upload_no_files: "You haven't sent any files yet. Send a file or cancel.",
    upload_ask_title: "✅ {count} file(s) received.\n\nNow send a title for this archive:",
    upload_ask_description: "Title: \"{title}\"\n\nNow send a description for this archive (or skip):",
    upload_ask_channels: "Which channel(s) should be required to unlock this archive?\nTap to toggle, then confirm.",
    upload_need_one_channel: "Select at least one channel.",
    upload_need_channels_first: "No channels are connected yet. Add one from \"Channel Management\" first.",
    upload_done: "✅ Archive created!\n\nTitle: {title}\nFiles: {count}\n\nShare link:\n{link}",
    btn_upload_done: "✅ Finish Upload",

    archives_panel_title: "🗂 Archive Management",
    no_archives_yet: "No archives created yet.",
    archives_list_title: "🗂 Archives ({count}):",
    archive_detail:
      "🗂 {title}\n{status}\n\nDescription: {description}\nFiles: {file_count}\nViews: {views}\nCode: {code}\nRequired channel(s): {channels}",
    archive_active: "🟢 Active",
    archive_inactive: "🔴 Inactive",
    no_description: "—",
    btn_edit_title: "✏️ Edit Title",
    btn_edit_desc: "✏️ Edit Description",
    btn_manage_files: "🖼 Manage Files",
    btn_toggle_active: "🔁 Toggle Active/Inactive",
    btn_delete_archive: "🗑 Delete Archive",
    archive_delete_confirm: "Are you sure you want to permanently delete archive \"{title}\" and all its files? This cannot be undone.",
    archive_deleted_ok: "🗑 Archive deleted.",
    archive_status_changed: "✅ Archive status changed.",
    edit_title_prompt: "Send the new title:",
    edit_desc_prompt: "Send the new description (or send - to clear it):",
    title_updated: "✅ Title updated.",
    desc_updated: "✅ Description updated.",
    manage_files_title: "🖼 Files in \"{title}\" ({count}):\n\nTap a file to delete it, or send a new file to add it.",
    file_added_to_archive: "✅ File added. Total: {count}",
    file_deleted_ok: "🗑 File deleted.",
    btn_done_editing_files: "✅ Done Editing Files",

    stats_title: "📊 Bot Statistics",
    stats_body:
      "👥 Users: {users}\n   (last 24h: {users_today} | last 7d: {users_week})\n\n📁 Channels: {channels}\n🗂 Archives: {archives} (active: {active_archives})\n🖼 Stored files: {files}\n\n👁 Total archive views: {views}\n📬 Successful deliveries: {deliveries}\n🚪 Bot starts (/start): {starts}\n\n🏆 Top archives:\n{top_archives}",
    no_data: "No data yet.",
    btn_refresh: "🔄 Refresh",

    info_title: "🔍 Bot Info",
    info_body:
      "Username: @{username}\nEnvironment: {env}\nAdmins: {admins}\nConnected channels: {channels}\nArchives: {archives}\nDefault auto-delete delay: {autodel}s",

    broadcast_prompt: "Send the message you want broadcast to all users (text, photo, video, etc.).",
    broadcast_sending: "⏳ Sending to {count} users...",
    broadcast_done: "✅ Sent.\nSuccess: {ok} | Failed: {fail}",

    settings_title: "⚙️ Settings",
    btn_language: "🌐 Language",
    btn_autodelete: "⏱ Auto-delete Timer",
    language_prompt: "Choose your language:",
    language_set_ok: "✅ Language switched to English.",
    autodelete_prompt: "Choose the default auto-delete delay for new links:\nCurrent value: {current}s",
    autodelete_off: "Off",
    autodelete_custom: "✍️ Custom value",
    autodelete_custom_prompt: "Send a custom value in seconds (positive integer):",
    autodelete_set_ok: "✅ Auto-delete delay set to {seconds}s.",
    invalid_number: "Invalid number.",
  },
} as const;

type TKey = keyof typeof T["fa"];

function t(lang: Lang, key: TKey, vars?: Record<string, string | number>): string {
  let s: string = T[lang][key] ?? T.fa[key];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.split(`{${k}}`).join(String(v));
    }
  }
  return s;
}

function otherLang(lang: Lang): Lang {
  return lang === "fa" ? "en" : "fa";
}

// =========================================================================
// Types
// =========================================================================

type FileRow = {
  id?: number;
  file_id: string;
  file_unique_id: string | null;
  file_type: string;
  file_name: string | null;
  caption: string | null;
  order_index: number;
};

type ChannelRow = { id: number; channel_id: string; username: string | null; title: string | null };

type ArchiveRow = {
  id: number;
  code: string;
  title: string;
  description: string | null;
  is_active: number;
  delete_after_seconds: number | null;
  views: number;
};

// =========================================================================
// small helpers
// =========================================================================

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

async function sendStoredFile(ctx: Context, chatId: number, f: FileRow) {
  const method = SEND_METHOD[f.file_type];
  if (!method) return null;
  // @ts-ignore - dynamic method dispatch on the Bot API
  return await ctx.api[method](chatId, f.file_id, f.caption ? { caption: f.caption } : undefined);
}

/** Extracts a forwarded channel's chat info, supporting both the newer
 *  forward_origin shape and the older forward_from_chat shape. */
function extractForwardedChannel(message: any): { id: number; title: string | null; username: string | null } | null {
  const origin = message.forward_origin;
  if (origin && origin.type === "channel" && origin.chat) {
    return { id: origin.chat.id, title: origin.chat.title ?? null, username: origin.chat.username ? `@${origin.chat.username}` : null };
  }
  const legacy = message.forward_from_chat;
  if (legacy && legacy.type === "channel") {
    return { id: legacy.id, title: legacy.title ?? null, username: legacy.username ? `@${legacy.username}` : null };
  }
  return null;
}

// =========================================================================
// D1 data access
// =========================================================================

async function isAdmin(env: Env, telegramId: number): Promise<boolean> {
  const row = await env.DB.prepare("SELECT 1 FROM admins WHERE telegram_id = ?").bind(String(telegramId)).first();
  return !!row;
}

async function adminCount(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) as c FROM admins").first<{ c: number }>();
  return row?.c ?? 0;
}

async function upsertUser(env: Env, telegramId: number) {
  const t0 = now();
  await env.DB.prepare(
    `INSERT INTO users (telegram_id, first_seen_at, last_seen_at) VALUES (?, ?, ?)
     ON CONFLICT(telegram_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`
  ).bind(String(telegramId), t0, t0).run();
}

async function getUserLang(env: Env, telegramId: number): Promise<Lang> {
  const row = await env.DB.prepare("SELECT lang FROM users WHERE telegram_id = ?").bind(String(telegramId)).first<{ lang: string | null }>();
  return row?.lang === "en" ? "en" : DEFAULT_LANG;
}

async function setUserLang(env: Env, telegramId: number, lang: Lang) {
  await env.DB.prepare("UPDATE users SET lang = ? WHERE telegram_id = ?").bind(lang, String(telegramId)).run();
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

async function getChannelById(env: Env, id: number): Promise<ChannelRow | null> {
  const row = await env.DB.prepare("SELECT id, channel_id, username, title FROM channels WHERE id = ?").bind(id).first<ChannelRow>();
  return row ?? null;
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
      // Treat an unreachable channel as "not verifiable" for this user only,
      // instead of failing the whole check (a single misconfigured channel
      // should not lock every user out).
      missing.push(ch);
    }
  }
  return { ok: true, missing };
}

function joinKeyboard(lang: Lang, missing: ChannelRow[], checkCallbackData?: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const ch of missing) {
    const handle = ch.username ? ch.username.replace("@", "") : null;
    if (handle) {
      kb.url(`🔑 ${ch.title ?? ch.username}`, `https://t.me/${handle}`).row();
    }
  }
  if (checkCallbackData) {
    kb.text(t(lang, "btn_joined"), checkCallbackData);
  }
  return kb;
}

// ---------- admin_state (conversation state) ----------

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

// ---------- upload sessions ----------

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

async function cancelSession(env: Env, sessionId: number) {
  await env.DB.prepare("UPDATE upload_sessions SET status = 'cancelled', updated_at = ? WHERE id = ?").bind(now(), sessionId).run();
  await env.DB.prepare("DELETE FROM upload_session_files WHERE session_id = ?").bind(sessionId).run();
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

// ---------- finalize archive ----------

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

async function getArchiveByCode(env: Env, code: string): Promise<ArchiveRow | null> {
  const row = await env.DB.prepare("SELECT id, code, title, description, is_active, delete_after_seconds, views FROM archives WHERE code = ?")
    .bind(code).first<ArchiveRow>();
  return row ?? null;
}

async function getArchiveById(env: Env, id: number): Promise<ArchiveRow | null> {
  const row = await env.DB.prepare("SELECT id, code, title, description, is_active, delete_after_seconds, views FROM archives WHERE id = ?")
    .bind(id).first<ArchiveRow>();
  return row ?? null;
}

async function getAllArchives(env: Env): Promise<ArchiveRow[]> {
  const res = await env.DB.prepare("SELECT id, code, title, description, is_active, delete_after_seconds, views FROM archives ORDER BY id DESC").all<ArchiveRow>();
  return res.results ?? [];
}

async function getArchiveFiles(env: Env, archiveId: number): Promise<FileRow[]> {
  const res = await env.DB.prepare(
    "SELECT id, file_id, file_unique_id, file_type, file_name, caption, order_index FROM files WHERE archive_id = ? ORDER BY order_index ASC"
  ).bind(archiveId).all<FileRow>();
  return res.results ?? [];
}

async function incrementArchiveViews(env: Env, archiveId: number) {
  await env.DB.prepare("UPDATE archives SET views = views + 1 WHERE id = ?").bind(archiveId).run();
}

// ---------- events / stats ----------

async function logEvent(env: Env, type: string, telegramId?: number, refId?: string) {
  await env.DB.prepare(
    "INSERT INTO events (type, telegram_id, ref_id, created_at) VALUES (?, ?, ?, ?)"
  ).bind(type, telegramId != null ? String(telegramId) : null, refId ?? null, now()).run();
}

async function countEventsSince(env: Env, type: string, sinceMs: number): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) as c FROM events WHERE type = ? AND created_at >= ?")
    .bind(type, sinceMs).first<{ c: number }>();
  return row?.c ?? 0;
}

async function countEventsTotal(env: Env, type: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) as c FROM events WHERE type = ?").bind(type).first<{ c: number }>();
  return row?.c ?? 0;
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

// ---------- group-chat join prompt debounce ----------

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

// =========================================================================
// Keyboards
// =========================================================================

function mainReplyKeyboard(lang: Lang): Keyboard {
  return new Keyboard()
    .text(t(lang, "btn_upload")).row()
    .text(t(lang, "btn_channels")).text(t(lang, "btn_archives")).row()
    .text(t(lang, "btn_stats")).text(t(lang, "btn_info")).row()
    .text(t(lang, "btn_broadcast")).row()
    .text(t(lang, "btn_settings")).row()
    .resized();
}

function matchAnyLang(text: string, key: TKey): boolean {
  return text === T.fa[key] || text === T.en[key];
}

// =========================================================================
// bot construction
// =========================================================================

function buildBot(env: Env): Bot {
  const bot = new Bot(env.BOT_TOKEN);

  // ----- /start (deep link or plain) -----
  bot.command("start", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    await upsertUser(env, userId);
    const lang = await getUserLang(env, userId);
    const payload = ctx.match?.toString().trim();

    if (payload) {
      await logEvent(env, "start", userId, payload);
      await deliverArchive(ctx, env, userId, payload, lang);
      return;
    }

    await logEvent(env, "start", userId);
    const admin = await isAdmin(env, userId);
    if (admin) {
      await ctx.reply(t(lang, "welcome_admin"), { reply_markup: mainReplyKeyboard(lang) });
    } else {
      await ctx.reply(t(lang, "welcome_user"));
    }
  });

  // ----- callback queries -----
  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    const userId = ctx.from.id;
    const lang = await getUserLang(env, userId);

    try {
      await routeCallback(ctx, env, data, userId, lang);
    } catch (err) {
      try {
        await ctx.answerCallbackQuery();
      } catch {
        /* ignore */
      }
      // TEMPORARY DIAGNOSTIC: show the real error to the admin so we can
      // pinpoint the bug instead of guessing. Safe to remove later.
      if (await isAdmin(env, userId)) {
        const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        try {
          await ctx.reply(`⚠️ DEBUG ERROR:\n${msg.slice(0, 800)}`);
        } catch {
          /* ignore */
        }
      }
    }
  });

  // ----- messages -----
  bot.on("message", async (ctx) => {
    const userId = ctx.from?.id;
    const chatType = ctx.chat.type;
    if (!userId) return;

    if (chatType === "group" || chatType === "supergroup") {
      const admin = await isAdmin(env, userId);
      if (admin) return; // admins are exempt from the group force-join gate
      await handleGroupMessage(ctx, env);
      return;
    }

    if (chatType !== "private") return;

    await upsertUser(env, userId);
    const lang = await getUserLang(env, userId);
    const admin = await isAdmin(env, userId);

    if (admin) {
      const handled = await handleAdminMessage(ctx, env, userId, lang);
      if (handled) return;
    }

    // Everyone else: normal commands / force-join gate
    if (ctx.message.text) {
      const text = ctx.message.text.trim();
      if (text.toLowerCase() === "testbit") {
        await ctx.reply(t(lang, "testbit_reply"));
        return;
      }
      if (text.toLowerCase() === "creator") {
        await ctx.reply(t(lang, "creator_reply"));
        return;
      }
    }

    if (!admin) {
      const channels = await getAllChannels(env);
      if (channels.length > 0) {
        const membership = await checkMembership(ctx, channels, userId);
        if (!membership.ok) {
          await ctx.reply(t(lang, "error_checking_membership"));
          return;
        }
        if (membership.missing.length > 0) {
          await ctx.reply(t(lang, "please_join_channels"), {
            reply_markup: joinKeyboard(lang, membership.missing),
          });
          return;
        }
      }
    }
  });

  return bot;
}

// =========================================================================
// Admin message handling (reply-keyboard buttons + conversation steps)
// Returns true if the message was consumed by admin-flow logic.
// =========================================================================

async function handleAdminMessage(ctx: Context, env: Env, userId: number, lang: Lang): Promise<boolean> {
  const text = ctx.message?.text?.trim();

  // ---- top-level reply-keyboard buttons ----
  if (text) {
    if (matchAnyLang(text, "btn_upload")) {
      await startUploadFlow(ctx, env, userId, lang);
      return true;
    }
    if (matchAnyLang(text, "btn_channels")) {
      await sendChannelsPanel(ctx, env, lang);
      return true;
    }
    if (matchAnyLang(text, "btn_archives")) {
      await sendArchivesListWindow(ctx, env, lang, 0);
      return true;
    }
    if (matchAnyLang(text, "btn_stats")) {
      await sendStatsWindow(ctx, env, lang);
      return true;
    }
    if (matchAnyLang(text, "btn_info")) {
      await sendInfoWindow(ctx, env, lang);
      return true;
    }
    if (matchAnyLang(text, "btn_broadcast")) {
      await setAdminState(env, userId, "awaiting_broadcast", {});
      await ctx.reply(t(lang, "broadcast_prompt"), {
        reply_markup: new InlineKeyboard().text(t(lang, "btn_cancel"), "bcast:cancel"),
      });
      return true;
    }
    if (matchAnyLang(text, "btn_settings")) {
      await sendSettingsWindow(ctx, env, lang);
      return true;
    }
  }

  // ---- active upload session: receiving files ----
  const session = await getActiveSession(env, userId);
  if (session) {
    const file = ctx.message ? detectFile(ctx.message) : null;
    if (file) {
      const state = await getAdminState(env, userId);
      const position = await addFileToSession(env, session.id, file);
      const statusMsgId = state?.context?.statusMessageId as number | undefined;
      const kb = new InlineKeyboard()
        .text(t(lang, "btn_upload_done"), `up:done:${session.id}`)
        .text(t(lang, "btn_cancel"), `up:cancel:${session.id}`);
      if (statusMsgId) {
        try {
          await ctx.api.editMessageText(ctx.chat!.id, statusMsgId, t(lang, "upload_file_added", { count: position }), { reply_markup: kb });
          return true;
        } catch {
          /* fall through to sending a new status message */
        }
      }
      const sent = await ctx.reply(t(lang, "upload_file_added", { count: position }), { reply_markup: kb });
      await setAdminState(env, userId, "uploading", { sessionId: session.id, statusMessageId: sent.message_id });
      return true;
    }
  }

  // ---- conversation states ----
  const state = await getAdminState(env, userId);
  if (state && text) {
    switch (state.state) {
      case "awaiting_channel_input": {
        await handleConnectChannelInput(ctx, env, userId, lang, text);
        return true;
      }
      case "awaiting_title": {
        const sessionId = state.context.sessionId as number;
        await setAdminState(env, userId, "awaiting_description", { sessionId, title: text });
        await ctx.reply(t(lang, "upload_ask_description", { title: text }), {
          reply_markup: new InlineKeyboard()
            .text(t(lang, "btn_skip"), `up:skipdesc:${sessionId}`)
            .text(t(lang, "btn_cancel"), `up:cancel:${sessionId}`),
        });
        return true;
      }
      case "awaiting_description": {
        const sessionId = state.context.sessionId as number;
        const title = state.context.title as string;
        await proceedToChannelSelection(ctx, env, userId, lang, sessionId, title, text);
        return true;
      }
      case "awaiting_broadcast": {
        await clearAdminState(env, userId);
        await runBroadcast(ctx, env, lang);
        return true;
      }
      case "editing_archive_title": {
        const archiveId = state.context.archiveId as number;
        await env.DB.prepare("UPDATE archives SET title = ?, updated_at = ? WHERE id = ?").bind(text, now(), archiveId).run();
        await clearAdminState(env, userId);
        await ctx.reply(t(lang, "title_updated"));
        await sendArchiveDetailWindow(ctx, env, lang, archiveId, undefined);
        return true;
      }
      case "editing_archive_desc": {
        const archiveId = state.context.archiveId as number;
        const desc = text === "-" ? null : text;
        await env.DB.prepare("UPDATE archives SET description = ?, updated_at = ? WHERE id = ?").bind(desc, now(), archiveId).run();
        await clearAdminState(env, userId);
        await ctx.reply(t(lang, "desc_updated"));
        await sendArchiveDetailWindow(ctx, env, lang, archiveId, undefined);
        return true;
      }
      case "autodelete_custom": {
        const seconds = parseInt(text, 10);
        if (!Number.isFinite(seconds) || seconds < 0) {
          await ctx.reply(t(lang, "invalid_number"));
          return true;
        }
        await setSetting(env, "auto_delete_seconds", String(seconds));
        await clearAdminState(env, userId);
        await ctx.reply(t(lang, "autodelete_set_ok", { seconds }));
        return true;
      }
    }
  }

  // ---- editing files of an existing archive: any file sent gets appended ----
  if (state && state.state === "editing_archive_files") {
    const file = ctx.message ? detectFile(ctx.message) : null;
    if (file) {
      const archiveId = state.context.archiveId as number;
      const countRow = await env.DB.prepare("SELECT COUNT(*) as c FROM files WHERE archive_id = ?").bind(archiveId).first<{ c: number }>();
      const position = (countRow?.c ?? 0) + 1;
      await env.DB.prepare(
        `INSERT INTO files (archive_id, file_id, file_unique_id, file_type, file_name, caption, order_index, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(archiveId, file.file_id, file.file_unique_id, file.file_type, file.file_name, file.caption, position, now()).run();
      await ctx.reply(t(lang, "file_added_to_archive", { count: position }));
      return true;
    }
  }

  return false;
}

async function handleConnectChannelInput(ctx: Context, env: Env, userId: number, lang: Lang, text: string) {
  let username: string | null = null;
  let chatIdToLookup: string | number | null = null;
  const forwarded = ctx.message ? extractForwardedChannel(ctx.message) : null;

  if (forwarded) {
    chatIdToLookup = forwarded.id;
    username = forwarded.username;
  } else if (text.startsWith("@")) {
    username = text;
    chatIdToLookup = text;
  } else {
    await ctx.reply(t(lang, "connect_channel_prompt"));
    return;
  }

  try {
    const chat = await ctx.api.getChat(chatIdToLookup!);
    const title = "title" in chat ? chat.title ?? null : null;
    const existing = await env.DB.prepare("SELECT id FROM channels WHERE channel_id = ?").bind(String(chat.id)).first();
    if (existing) {
      await ctx.reply(t(lang, "channel_already_exists"));
      await clearAdminState(env, userId);
      await sendChannelsPanel(ctx, env, lang);
      return;
    }
    await env.DB.prepare(
      `INSERT INTO channels (channel_id, username, title, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(channel_id) DO UPDATE SET username = excluded.username, title = excluded.title`
    ).bind(String(chat.id), username, title, now()).run();
    await logEvent(env, "channel_added", userId, String(chat.id));
    await clearAdminState(env, userId);
    await ctx.reply(t(lang, "channel_added_ok", { title: title ?? username ?? String(chat.id) }));
    await sendChannelsPanel(ctx, env, lang);
  } catch {
    await ctx.reply(t(lang, "channel_add_fail"));
  }
}

async function persistPendingArchiveMeta(env: Env, sessionId: number, title: string, description: string | null) {
  await env.DB.prepare(
    "UPDATE upload_sessions SET pending_title = ?, pending_description = ?, selected_channels = '[]', updated_at = ? WHERE id = ?"
  ).bind(title, description, now(), sessionId).run();
}

async function getPendingArchiveMeta(env: Env, sessionId: number) {
  return env.DB.prepare(
    "SELECT pending_title, pending_description, selected_channels FROM upload_sessions WHERE id = ? AND status = 'collecting'"
  ).bind(sessionId).first<{ pending_title: string | null; pending_description: string | null; selected_channels: string | null }>();
}

async function proceedToChannelSelection(ctx: Context, env: Env, userId: number, lang: Lang, sessionId: number, title: string, descriptionInput: string) {
  const description = descriptionInput === "-" || matchAnyLang(descriptionInput, "btn_skip") ? null : descriptionInput;
  const channels = await getAllChannels(env);
  if (channels.length === 0) {
    await ctx.reply(t(lang, "upload_need_channels_first"));
    await clearAdminState(env, userId);
    return;
  }
  await persistPendingArchiveMeta(env, sessionId, title, description);
  await setAdminState(env, userId, "awaiting_channels", { sessionId });
  await ctx.reply(t(lang, "upload_ask_channels"), {
    reply_markup: buildChannelPickerKeyboard(lang, channels, [], sessionId),
  });
}

function buildChannelPickerKeyboard(lang: Lang, channels: ChannelRow[], selected: number[], sessionId: number): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const ch of channels) {
    const mark = selected.includes(ch.id) ? "✅ " : "";
    kb.text(`${mark}${ch.title ?? ch.username ?? ch.channel_id}`, `chsel:${sessionId}:${ch.id}`).row();
  }
  kb.text(t(lang, "btn_confirm"), `chconfirm:${sessionId}`).text(t(lang, "btn_cancel"), `up:cancel:${sessionId}`);
  return kb;
}

// =========================================================================
// Callback router
// =========================================================================

async function routeCallback(ctx: Context, env: Env, data: string, userId: number, lang: Lang) {
  const [ns, ...rest] = data.split(":");

  // ----- end-user membership recheck (available to everyone) -----
  if (ns === "check") {
    const code = rest.join(":");
    const archive = await getArchiveByCode(env, code);
    if (!archive) {
      await ctx.answerCallbackQuery({ text: t(lang, "invalid_or_inactive_link") });
      return;
    }
    const channels = await getArchiveChannels(env, archive.id);
    const membership = await checkMembership(ctx, channels, userId);
    if (!membership.ok) {
      await ctx.answerCallbackQuery({ text: t(lang, "error_checking_membership") });
      return;
    }
    if (membership.missing.length > 0) {
      await ctx.answerCallbackQuery({ text: t(lang, "not_joined_yet") });
      await ctx.editMessageReplyMarkup({ reply_markup: joinKeyboard(lang, membership.missing, `check:${code}`) });
      return;
    }
    await ctx.answerCallbackQuery({ text: t(lang, "verified_sending") });
    try {
      await ctx.deleteMessage();
    } catch {
      /* ignore */
    }
    await sendArchiveFiles(ctx, env, userId, archive);
    return;
  }

  // Everything below is admin-only.
  if (!(await isAdmin(env, userId))) {
    await ctx.answerCallbackQuery({ text: t(lang, "not_admin") });
    return;
  }

  switch (ns) {
    case "chmgmt":
      await handleChannelMgmtCallback(ctx, env, lang, rest);
      return;
    case "arcmgmt":
      await handleArchiveMgmtCallback(ctx, env, userId, lang, rest);
      return;
    case "up":
      await handleUploadCallback(ctx, env, userId, lang, rest);
      return;
    case "chsel":
    case "chconfirm":
      await handleChannelPickerCallback(ctx, env, userId, lang, ns, rest);
      return;
    case "bcast":
      if (rest[0] === "cancel") {
        await clearAdminState(env, userId);
        await ctx.answerCallbackQuery();
        await ctx.editMessageText(t(lang, "cancelled"));
      }
      return;
    case "settings":
      await handleSettingsCallback(ctx, env, userId, lang, rest);
      return;
    case "stats":
      if (rest[0] === "refresh") {
        await ctx.answerCallbackQuery();
        await sendStatsWindow(ctx, env, lang, true);
      }
      return;
    case "nav":
      if (rest[0] === "close") {
        await ctx.answerCallbackQuery();
        try {
          await ctx.deleteMessage();
        } catch {
          /* ignore */
        }
      }
      return;
    default:
      await ctx.answerCallbackQuery();
  }
}

// ---------- Channel management ----------

async function sendChannelsPanel(ctx: Context, env: Env, lang: Lang) {
  const kb = new InlineKeyboard()
    .text(t(lang, "btn_connect_channel"), "chmgmt:connect").row()
    .text(t(lang, "btn_channel_list"), "chmgmt:list:0").row()
    .text(t(lang, "btn_close"), "nav:close");
  await ctx.reply(t(lang, "channels_panel_title"), { reply_markup: kb });
}

async function handleChannelMgmtCallback(ctx: Context, env: Env, lang: Lang, rest: string[]) {
  const userId = ctx.from!.id;
  const action = rest[0];

  if (action === "connect") {
    await setAdminState(env, userId, "awaiting_channel_input", {});
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(t(lang, "connect_channel_prompt"), {
      reply_markup: new InlineKeyboard().text(t(lang, "btn_back"), "chmgmt:backtopanel"),
    });
    return;
  }

  if (action === "backtopanel") {
    await clearAdminState(env, userId);
    await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard()
      .text(t(lang, "btn_connect_channel"), "chmgmt:connect").row()
      .text(t(lang, "btn_channel_list"), "chmgmt:list:0").row()
      .text(t(lang, "btn_close"), "nav:close");
    await ctx.editMessageText(t(lang, "channels_panel_title"), { reply_markup: kb });
    return;
  }

  if (action === "list") {
    const page = parseInt(rest[1] ?? "0", 10);
    await ctx.answerCallbackQuery();
    await renderChannelListWindow(ctx, env, lang, page, true);
    return;
  }

  if (action === "view") {
    const channelId = parseInt(rest[1], 10);
    const ch = await getChannelById(env, channelId);
    await ctx.answerCallbackQuery();
    if (!ch) return;
    const kb = new InlineKeyboard()
      .text(t(lang, "btn_delete"), `chmgmt:del:${channelId}`).row()
      .text(t(lang, "btn_back"), "chmgmt:list:0");
    await ctx.editMessageText(
      t(lang, "channel_detail_title", { title: ch.title ?? "-", handle: ch.username ?? ch.channel_id }),
      { reply_markup: kb }
    );
    return;
  }

  if (action === "del") {
    const channelId = parseInt(rest[1], 10);
    const ch = await getChannelById(env, channelId);
    await ctx.answerCallbackQuery();
    if (!ch) return;
    const kb = new InlineKeyboard()
      .text(t(lang, "btn_yes_delete"), `chmgmt:delok:${channelId}`)
      .text(t(lang, "btn_no"), `chmgmt:view:${channelId}`);
    await ctx.editMessageText(t(lang, "channel_delete_confirm", { title: ch.title ?? ch.channel_id }), { reply_markup: kb });
    return;
  }

  if (action === "delok") {
    const channelId = parseInt(rest[1], 10);
    const ch = await getChannelById(env, channelId);
    await env.DB.prepare("DELETE FROM channels WHERE id = ?").bind(channelId).run();
    await logEvent(env, "channel_removed", userId, ch?.channel_id);
    await ctx.answerCallbackQuery({ text: t(lang, "channel_deleted_ok") });
    await renderChannelListWindow(ctx, env, lang, 0, true);
    return;
  }
}

async function renderChannelListWindow(ctx: Context, env: Env, lang: Lang, page: number, edit: boolean) {
  const channels = await getAllChannels(env);
  if (channels.length === 0) {
    const kb = new InlineKeyboard().text(t(lang, "btn_back"), "chmgmt:backtopanel");
    if (edit) await ctx.editMessageText(t(lang, "no_channels_yet"), { reply_markup: kb });
    else await ctx.reply(t(lang, "no_channels_yet"), { reply_markup: kb });
    return;
  }

  const totalPages = Math.max(1, Math.ceil(channels.length / CHANNELS_PAGE_SIZE));
  const p = Math.min(Math.max(page, 0), totalPages - 1);
  const slice = channels.slice(p * CHANNELS_PAGE_SIZE, p * CHANNELS_PAGE_SIZE + CHANNELS_PAGE_SIZE);

  const kb = new InlineKeyboard();
  for (const ch of slice) {
    kb.text(`${ch.title ?? ch.username ?? ch.channel_id}`, `chmgmt:view:${ch.id}`).row();
  }
  if (totalPages > 1) {
    kb.text("«", `chmgmt:list:${Math.max(0, p - 1)}`)
      .text(`${p + 1}/${totalPages}`, `chmgmt:list:${p}`)
      .text("»", `chmgmt:list:${Math.min(totalPages - 1, p + 1)}`)
      .row();
  }
  kb.text(t(lang, "btn_back"), "chmgmt:backtopanel");

  const text = t(lang, "channels_list_title", { count: channels.length });
  if (edit) await ctx.editMessageText(text, { reply_markup: kb });
  else await ctx.reply(text, { reply_markup: kb });
}

// ---------- Upload flow ----------

async function startUploadFlow(ctx: Context, env: Env, userId: number, lang: Lang) {
  const existing = await getActiveSession(env, userId);
  if (existing) await cancelSession(env, existing.id);
  await clearAdminState(env, userId);

  const sessionId = await startSession(env, userId);
  const kb = new InlineKeyboard()
    .text(t(lang, "btn_upload_done"), `up:done:${sessionId}`)
    .text(t(lang, "btn_cancel"), `up:cancel:${sessionId}`);
  const sent = await ctx.reply(t(lang, "upload_start_prompt", { count: 0 }), { reply_markup: kb });
  await setAdminState(env, userId, "uploading", { sessionId, statusMessageId: sent.message_id });
}

async function handleUploadCallback(ctx: Context, env: Env, userId: number, lang: Lang, rest: string[]) {
  const action = rest[0];
  const sessionId = parseInt(rest[1], 10);

  if (action === "cancel") {
    await cancelSession(env, sessionId);
    await clearAdminState(env, userId);
    await ctx.answerCallbackQuery({ text: t(lang, "cancelled") });
    await ctx.editMessageText(t(lang, "cancelled"));
    return;
  }

  if (action === "done") {
    const files = await getSessionFiles(env, sessionId);
    if (files.length === 0) {
      await ctx.answerCallbackQuery({ text: t(lang, "upload_no_files") });
      return;
    }
    await setAdminState(env, userId, "awaiting_title", { sessionId });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(t(lang, "upload_ask_title", { count: files.length }));
    return;
  }

  if (action === "skipdesc") {
    const state = await getAdminState(env, userId);
    if (!state || state.state !== "awaiting_description") {
      await ctx.answerCallbackQuery();
      return;
    }
    const title = state.context.title as string;
    await proceedToChannelSelectionFromCallback(ctx, env, userId, lang, sessionId, title, null);
    return;
  }
}

async function proceedToChannelSelectionFromCallback(ctx: Context, env: Env, userId: number, lang: Lang, sessionId: number, title: string, description: string | null) {
  const channels = await getAllChannels(env);
  if (channels.length === 0) {
    await ctx.answerCallbackQuery({ text: t(lang, "upload_need_channels_first") });
    await clearAdminState(env, userId);
    return;
  }
  await persistPendingArchiveMeta(env, sessionId, title, description);
  await setAdminState(env, userId, "awaiting_channels", { sessionId });
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(t(lang, "upload_ask_channels"), {
    reply_markup: buildChannelPickerKeyboard(lang, channels, [], sessionId),
  });
}

// Channel selection reads/writes go straight to the upload_sessions row
// (keyed by the sessionId embedded in the callback data itself) instead of
// relying on admin_state staying perfectly in sync across many taps.
async function handleChannelPickerCallback(ctx: Context, env: Env, userId: number, lang: Lang, ns: string, rest: string[]) {
  if (ns === "chsel") {
    const [sessionIdStr, channelIdStr] = rest;
    const sessionId = parseInt(sessionIdStr, 10);
    const meta = await getPendingArchiveMeta(env, sessionId);
    if (!meta || !meta.pending_title) {
      await ctx.answerCallbackQuery();
      return;
    }
    const selected: number[] = meta.selected_channels ? JSON.parse(meta.selected_channels) : [];
    const channelId = parseInt(channelIdStr, 10);
    const idx = selected.indexOf(channelId);
    if (idx >= 0) selected.splice(idx, 1);
    else selected.push(channelId);
    await env.DB.prepare("UPDATE upload_sessions SET selected_channels = ?, updated_at = ? WHERE id = ?")
      .bind(JSON.stringify(selected), now(), sessionId).run();
    const channels = await getAllChannels(env);
    await ctx.editMessageReplyMarkup({ reply_markup: buildChannelPickerKeyboard(lang, channels, selected, sessionId) });
    await ctx.answerCallbackQuery();
    return;
  }

  if (ns === "chconfirm") {
    const sessionId = parseInt(rest[0], 10);
    const meta = await getPendingArchiveMeta(env, sessionId);
    if (!meta || !meta.pending_title) {
      await ctx.answerCallbackQuery();
      return;
    }
    const selected: number[] = meta.selected_channels ? JSON.parse(meta.selected_channels) : [];
    if (selected.length === 0) {
      await ctx.answerCallbackQuery({ text: t(lang, "upload_need_one_channel") });
      return;
    }
    const title = meta.pending_title;
    const description = meta.pending_description ?? null;
    const fileCount = (await getSessionFiles(env, sessionId)).length;
    const code = await finalizeArchive(env, sessionId, title, description, selected);
    await clearAdminState(env, userId);
    await ctx.answerCallbackQuery({ text: t(lang, "upload_done").split("\n")[0] });
    const link = `https://t.me/${(await ctx.api.getMe()).username}?start=${code}`;
    await ctx.editMessageText(t(lang, "upload_done", { title, count: fileCount, link }));
    return;
  }
}

// ---------- Archive management ----------

async function sendArchivesListWindow(ctx: Context, env: Env, lang: Lang, page: number) {
  await renderArchivesList(ctx, env, lang, page, false);
}

async function renderArchivesList(ctx: Context, env: Env, lang: Lang, page: number, edit: boolean) {
  const archives = await getAllArchives(env);
  if (archives.length === 0) {
    const kb = new InlineKeyboard().text(t(lang, "btn_close"), "nav:close");
    if (edit) await ctx.editMessageText(t(lang, "no_archives_yet"), { reply_markup: kb });
    else await ctx.reply(t(lang, "no_archives_yet"), { reply_markup: kb });
    return;
  }

  const totalPages = Math.max(1, Math.ceil(archives.length / ARCHIVES_PAGE_SIZE));
  const p = Math.min(Math.max(page, 0), totalPages - 1);
  const slice = archives.slice(p * ARCHIVES_PAGE_SIZE, p * ARCHIVES_PAGE_SIZE + ARCHIVES_PAGE_SIZE);

  const kb = new InlineKeyboard();
  for (const a of slice) {
    const mark = a.is_active ? "🟢" : "🔴";
    kb.text(`${mark} ${a.title}`, `arcmgmt:view:${a.id}`).row();
  }
  if (totalPages > 1) {
    kb.text("«", `arcmgmt:list:${Math.max(0, p - 1)}`)
      .text(`${p + 1}/${totalPages}`, `arcmgmt:list:${p}`)
      .text("»", `arcmgmt:list:${Math.min(totalPages - 1, p + 1)}`)
      .row();
  }
  kb.text(t(lang, "btn_close"), "nav:close");

  const text = t(lang, "archives_list_title", { count: archives.length });
  if (edit) await ctx.editMessageText(text, { reply_markup: kb });
  else await ctx.reply(text, { reply_markup: kb });
}

async function sendArchiveDetailWindow(ctx: Context, env: Env, lang: Lang, archiveId: number, _unused: undefined) {
  const archive = await getArchiveById(env, archiveId);
  if (!archive) return;
  const files = await getArchiveFiles(env, archiveId);
  const channels = await getArchiveChannels(env, archiveId);
  const kb = new InlineKeyboard()
    .text(t(lang, "btn_edit_title"), `arcmgmt:edittitle:${archiveId}`)
    .text(t(lang, "btn_edit_desc"), `arcmgmt:editdesc:${archiveId}`).row()
    .text(t(lang, "btn_manage_files"), `arcmgmt:files:${archiveId}:0`).row()
    .text(t(lang, "btn_toggle_active"), `arcmgmt:toggle:${archiveId}`).row()
    .text(t(lang, "btn_delete_archive"), `arcmgmt:del:${archiveId}`).row()
    .text(t(lang, "btn_back"), "arcmgmt:list:0");

  const text = t(lang, "archive_detail", {
    title: archive.title,
    status: archive.is_active ? t(lang, "archive_active") : t(lang, "archive_inactive"),
    description: archive.description ?? t(lang, "no_description"),
    file_count: files.length,
    views: archive.views ?? 0,
    code: archive.code,
    channels: channels.map((c) => c.title ?? c.username ?? c.channel_id).join(", ") || "-",
  });

  await ctx.reply(text, { reply_markup: kb });
}

async function handleArchiveMgmtCallback(ctx: Context, env: Env, userId: number, lang: Lang, rest: string[]) {
  const action = rest[0];

  if (action === "list") {
    const page = parseInt(rest[1] ?? "0", 10);
    await ctx.answerCallbackQuery();
    await renderArchivesList(ctx, env, lang, page, true);
    return;
  }

  if (action === "view") {
    const archiveId = parseInt(rest[1], 10);
    await ctx.answerCallbackQuery();
    await renderArchiveDetail(ctx, env, lang, archiveId, true);
    return;
  }

  if (action === "edittitle") {
    const archiveId = parseInt(rest[1], 10);
    await setAdminState(env, userId, "editing_archive_title", { archiveId });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(t(lang, "edit_title_prompt"), {
      reply_markup: new InlineKeyboard().text(t(lang, "btn_cancel"), `arcmgmt:canceledit:${archiveId}`),
    });
    return;
  }

  if (action === "editdesc") {
    const archiveId = parseInt(rest[1], 10);
    await setAdminState(env, userId, "editing_archive_desc", { archiveId });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(t(lang, "edit_desc_prompt"), {
      reply_markup: new InlineKeyboard().text(t(lang, "btn_cancel"), `arcmgmt:canceledit:${archiveId}`),
    });
    return;
  }

  if (action === "canceledit") {
    const archiveId = parseInt(rest[1], 10);
    await clearAdminState(env, userId);
    await ctx.answerCallbackQuery({ text: t(lang, "cancelled") });
    await renderArchiveDetail(ctx, env, lang, archiveId, true);
    return;
  }

  if (action === "files") {
    const archiveId = parseInt(rest[1], 10);
    await setAdminState(env, userId, "editing_archive_files", { archiveId });
    await ctx.answerCallbackQuery();
    await renderFilesManageWindow(ctx, env, lang, archiveId, true);
    return;
  }

  if (action === "delfile") {
    const fileId = parseInt(rest[1], 10);
    const archiveId = parseInt(rest[2], 10);
    await env.DB.prepare("DELETE FROM files WHERE id = ?").bind(fileId).run();
    await ctx.answerCallbackQuery({ text: t(lang, "file_deleted_ok") });
    await renderFilesManageWindow(ctx, env, lang, archiveId, true);
    return;
  }

  if (action === "donefiles") {
    const archiveId = parseInt(rest[1], 10);
    await clearAdminState(env, userId);
    await ctx.answerCallbackQuery();
    await renderArchiveDetail(ctx, env, lang, archiveId, true);
    return;
  }

  if (action === "toggle") {
    const archiveId = parseInt(rest[1], 10);
    const archive = await getArchiveById(env, archiveId);
    if (!archive) {
      await ctx.answerCallbackQuery();
      return;
    }
    await env.DB.prepare("UPDATE archives SET is_active = ?, updated_at = ? WHERE id = ?")
      .bind(archive.is_active ? 0 : 1, now(), archiveId).run();
    await ctx.answerCallbackQuery({ text: t(lang, "archive_status_changed") });
    await renderArchiveDetail(ctx, env, lang, archiveId, true);
    return;
  }

  if (action === "del") {
    const archiveId = parseInt(rest[1], 10);
    const archive = await getArchiveById(env, archiveId);
    if (!archive) {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard()
      .text(t(lang, "btn_yes_delete"), `arcmgmt:delok:${archiveId}`)
      .text(t(lang, "btn_no"), `arcmgmt:view:${archiveId}`);
    await ctx.editMessageText(t(lang, "archive_delete_confirm", { title: archive.title }), { reply_markup: kb });
    return;
  }

  if (action === "delok") {
    const archiveId = parseInt(rest[1], 10);
    await env.DB.prepare("DELETE FROM archives WHERE id = ?").bind(archiveId).run();
    await ctx.answerCallbackQuery({ text: t(lang, "archive_deleted_ok") });
    await renderArchivesList(ctx, env, lang, 0, true);
    return;
  }
}

async function renderArchiveDetail(ctx: Context, env: Env, lang: Lang, archiveId: number, edit: boolean) {
  const archive = await getArchiveById(env, archiveId);
  if (!archive) return;
  const files = await getArchiveFiles(env, archiveId);
  const channels = await getArchiveChannels(env, archiveId);
  const kb = new InlineKeyboard()
    .text(t(lang, "btn_edit_title"), `arcmgmt:edittitle:${archiveId}`)
    .text(t(lang, "btn_edit_desc"), `arcmgmt:editdesc:${archiveId}`).row()
    .text(t(lang, "btn_manage_files"), `arcmgmt:files:${archiveId}`).row()
    .text(t(lang, "btn_toggle_active"), `arcmgmt:toggle:${archiveId}`).row()
    .text(t(lang, "btn_delete_archive"), `arcmgmt:del:${archiveId}`).row()
    .text(t(lang, "btn_back"), "arcmgmt:list:0");

  const text = t(lang, "archive_detail", {
    title: archive.title,
    status: archive.is_active ? t(lang, "archive_active") : t(lang, "archive_inactive"),
    description: archive.description ?? t(lang, "no_description"),
    file_count: files.length,
    views: archive.views ?? 0,
    code: archive.code,
    channels: channels.map((c) => c.title ?? c.username ?? c.channel_id).join(", ") || "-",
  });

  if (edit) await ctx.editMessageText(text, { reply_markup: kb });
  else await ctx.reply(text, { reply_markup: kb });
}

async function renderFilesManageWindow(ctx: Context, env: Env, lang: Lang, archiveId: number, edit: boolean) {
  const archive = await getArchiveById(env, archiveId);
  const files = await getArchiveFiles(env, archiveId);
  if (!archive) return;

  const kb = new InlineKeyboard();
  for (const f of files) {
    const label = `🗑 ${f.file_type} #${f.order_index}${f.file_name ? " — " + f.file_name : ""}`;
    kb.text(label.slice(0, 60), `arcmgmt:delfile:${f.id}:${archiveId}`).row();
  }
  kb.text(t(lang, "btn_done_editing_files"), `arcmgmt:donefiles:${archiveId}`);

  const text = t(lang, "manage_files_title", { title: archive.title, count: files.length });
  if (edit) await ctx.editMessageText(text, { reply_markup: kb });
  else await ctx.reply(text, { reply_markup: kb });
}

// ---------- Stats ----------

async function sendStatsWindow(ctx: Context, env: Env, lang: Lang, edit = false) {
  const [users, channels, archives, activeArchives, files, viewsRow, deliveries, starts, usersToday, usersWeek, topArchives] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) as c FROM users").first<{ c: number }>(),
    env.DB.prepare("SELECT COUNT(*) as c FROM channels").first<{ c: number }>(),
    env.DB.prepare("SELECT COUNT(*) as c FROM archives").first<{ c: number }>(),
    env.DB.prepare("SELECT COUNT(*) as c FROM archives WHERE is_active = 1").first<{ c: number }>(),
    env.DB.prepare("SELECT COUNT(*) as c FROM files").first<{ c: number }>(),
    env.DB.prepare("SELECT COALESCE(SUM(views),0) as v FROM archives").first<{ v: number }>(),
    countEventsTotal(env, "archive_delivered"),
    countEventsTotal(env, "start"),
    countEventsSince(env, "start", now() - 24 * 3600 * 1000),
    countEventsSince(env, "start", now() - 7 * 24 * 3600 * 1000),
    env.DB.prepare("SELECT title, views FROM archives ORDER BY views DESC LIMIT 5").all<{ title: string; views: number }>(),
  ]);

  const topList = (topArchives.results ?? [])
    .map((a, i) => `${i + 1}. ${a.title} — ${a.views}`)
    .join("\n") || t(lang, "no_data");

  const text = t(lang, "stats_body", {
    users: users?.c ?? 0,
    users_today: usersToday,
    users_week: usersWeek,
    channels: channels?.c ?? 0,
    archives: archives?.c ?? 0,
    active_archives: activeArchives?.c ?? 0,
    files: files?.c ?? 0,
    views: viewsRow?.v ?? 0,
    deliveries,
    starts,
    top_archives: topList,
  });

  const kb = new InlineKeyboard().text(t(lang, "btn_refresh"), "stats:refresh").row().text(t(lang, "btn_close"), "nav:close");
  const full = `${t(lang, "stats_title")}\n\n${text}`;
  if (edit) {
    try {
      await ctx.editMessageText(full, { reply_markup: kb });
      return;
    } catch {
      /* fall through */
    }
  }
  await ctx.reply(full, { reply_markup: kb });
}

// ---------- Bot info ----------

async function sendInfoWindow(ctx: Context, env: Env, lang: Lang) {
  const [admins, channels, archives, autodel] = await Promise.all([
    adminCount(env),
    env.DB.prepare("SELECT COUNT(*) as c FROM channels").first<{ c: number }>(),
    env.DB.prepare("SELECT COUNT(*) as c FROM archives").first<{ c: number }>(),
    getSetting(env, "auto_delete_seconds", String(DEFAULT_AUTO_DELETE_SECONDS)),
  ]);
  const me = await ctx.api.getMe();
  const text = `${t(lang, "info_title")}\n\n${t(lang, "info_body", {
    username: me.username,
    env: env.ENVIRONMENT,
    admins,
    channels: channels?.c ?? 0,
    archives: archives?.c ?? 0,
    autodel,
  })}`;
  await ctx.reply(text, { reply_markup: new InlineKeyboard().text(t(lang, "btn_close"), "nav:close") });
}

// ---------- Broadcast ----------

async function runBroadcast(ctx: Context, env: Env, lang: Lang) {
  const srcChatId = ctx.chat!.id;
  const srcMessageId = ctx.message!.message_id;
  const usersRes = await env.DB.prepare("SELECT telegram_id FROM users").all<{ telegram_id: string }>();
  const ids = (usersRes.results ?? []).map((r) => r.telegram_id);

  const status = await ctx.reply(t(lang, "broadcast_sending", { count: ids.length }));

  let ok = 0;
  let fail = 0;
  const BATCH = 20;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map((id) => ctx.api.copyMessage(id, srcChatId, srcMessageId))
    );
    for (const r of results) {
      if (r.status === "fulfilled") ok++;
      else fail++;
    }
  }

  await ctx.api.editMessageText(srcChatId, status.message_id, t(lang, "broadcast_done", { ok, fail }));
}

// ---------- Settings ----------

async function sendSettingsWindow(ctx: Context, env: Env, lang: Lang) {
  const kb = new InlineKeyboard()
    .text(t(lang, "btn_language"), "settings:lang").row()
    .text(t(lang, "btn_autodelete"), "settings:autodel").row()
    .text(t(lang, "btn_close"), "nav:close");
  await ctx.reply(t(lang, "settings_title"), { reply_markup: kb });
}

async function handleSettingsCallback(ctx: Context, env: Env, userId: number, lang: Lang, rest: string[]) {
  const action = rest[0];

  if (action === "lang") {
    const kb = new InlineKeyboard()
      .text("🇮🇷 فارسی", "settings:setlang:fa")
      .text("🇬🇧 English", "settings:setlang:en").row()
      .text(t(lang, "btn_back"), "settings:back");
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(t(lang, "language_prompt"), { reply_markup: kb });
    return;
  }

  if (action === "setlang") {
    const newLang = rest[1] === "en" ? "en" : "fa";
    await setUserLang(env, userId, newLang as Lang);
    await ctx.answerCallbackQuery({ text: t(newLang as Lang, "language_set_ok") });
    await ctx.editMessageText(t(newLang as Lang, "language_set_ok"));
    try {
      await ctx.reply(t(newLang as Lang, "welcome_admin"), { reply_markup: mainReplyKeyboard(newLang as Lang) });
    } catch {
      /* ignore */
    }
    return;
  }

  if (action === "autodel") {
    const current = await getSetting(env, "auto_delete_seconds", String(DEFAULT_AUTO_DELETE_SECONDS));
    const kb = new InlineKeyboard();
    for (const secs of AUTO_DELETE_PRESETS) {
      const label = secs === 0 ? t(lang, "autodelete_off") : `${secs}s`;
      kb.text(label, `settings:setautodel:${secs}`).row();
    }
    kb.text(t(lang, "autodelete_custom"), "settings:customautodel").row();
    kb.text(t(lang, "btn_back"), "settings:back");
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(t(lang, "autodelete_prompt", { current }), { reply_markup: kb });
    return;
  }

  if (action === "setautodel") {
    const seconds = parseInt(rest[1], 10);
    await setSetting(env, "auto_delete_seconds", String(seconds));
    await ctx.answerCallbackQuery({ text: t(lang, "autodelete_set_ok", { seconds }) });
    await ctx.editMessageText(t(lang, "autodelete_set_ok", { seconds }));
    return;
  }

  if (action === "customautodel") {
    await setAdminState(env, userId, "autodelete_custom", {});
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(t(lang, "autodelete_custom_prompt"));
    return;
  }

  if (action === "back") {
    await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard()
      .text(t(lang, "btn_language"), "settings:lang").row()
      .text(t(lang, "btn_autodelete"), "settings:autodel").row()
      .text(t(lang, "btn_close"), "nav:close");
    await ctx.editMessageText(t(lang, "settings_title"), { reply_markup: kb });
    return;
  }
}

// =========================================================================
// Delivery / group gate (end users)
// =========================================================================

async function deliverArchive(ctx: Context, env: Env, userId: number, code: string, lang: Lang) {
  const archive = await getArchiveByCode(env, code);
  if (!archive || !archive.is_active) {
    await ctx.reply(t(lang, "invalid_or_inactive_link"));
    return;
  }

  const admin = await isAdmin(env, userId);
  if (!admin) {
    const channels = await getArchiveChannels(env, archive.id);
    const membership = await checkMembership(ctx, channels, userId);
    if (!membership.ok) {
      await ctx.reply(t(lang, "error_checking_membership"));
      return;
    }
    if (membership.missing.length > 0) {
      await ctx.reply(t(lang, "please_join_to_get_files"), {
        reply_markup: joinKeyboard(lang, membership.missing, `check:${code}`),
      });
      return;
    }
  }

  await sendArchiveFiles(ctx, env, userId, archive);
}

async function sendArchiveFiles(ctx: Context, env: Env, userId: number, archive: ArchiveRow) {
  const lang = await getUserLang(env, userId);
  const files = await getArchiveFiles(env, archive.id);
  if (files.length === 0) {
    await ctx.reply(t(lang, "archive_empty"));
    return;
  }

  const chatId = ctx.chat!.id;
  for (const f of files) {
    const sent = await sendStoredFile(ctx, chatId, f);
    if (sent && "message_id" in sent) {
      await trackSentMessage(env, userId, chatId, sent.message_id, archive.id, archive.delete_after_seconds);
    }
  }
  await incrementArchiveViews(env, archive.id);
  await logEvent(env, "archive_delivered", userId, archive.code);
}

async function handleGroupMessage(ctx: Context, env: Env) {
  const userId = ctx.from?.id;
  const chat = ctx.chat;
  if (!userId || !chat) return;

  const channels = await getAllChannels(env);
  if (channels.length === 0) return; // nothing configured — don't restrict groups

  const membership = await checkMembership(ctx, channels, userId);
  if (!membership.ok) return;
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

  const lang = await getUserLang(env, userId);
  const from = ctx.from!;
  const displayName = escapeHtml(`${from.first_name ?? ""} ${from.last_name ?? ""}`.trim() || "User");
  const userLink = from.username ? `https://t.me/${from.username}` : `tg://user?id=${from.id}`;
  const mention = `<a href="${userLink}">${displayName}</a>`;

  const sent = await ctx.api.sendMessage(
    chat.id,
    `${mention},\n${t(lang, "group_join_notice")}`,
    { parse_mode: "HTML", reply_markup: joinKeyboard(lang, membership.missing) }
  );
  await setGroupPrompt(env, chat.id, sent.message_id);
  await logEvent(env, "group_block", userId, String(chat.id));
}

// =========================================================================
// Worker entrypoint
// =========================================================================

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
