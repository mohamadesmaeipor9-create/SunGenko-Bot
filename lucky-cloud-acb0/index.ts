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
  AI: Ai;
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

// ---------- AI assistant ----------
// A single Workers AI model handles BOTH vision (it can actually look at
// photos sent to it) and tool/function calling — no separate captioning
// model needed, and no external API key: this runs entirely on Cloudflare's
// free Workers AI tier (the `AI` binding in wrangler.jsonc).
const AI_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
// How long, after a post is actually published to the channel, the AI is
// still allowed to fix a mistake in it. Enforced server-side in
// aiEditRecentPost — the tool call is refused outright once this has
// elapsed, regardless of what it's asked to do.
const AI_EDIT_WINDOW_MS = 2 * 60 * 1000;
// How many recent turns of a chat with the AI assistant are kept as
// context. Old turns are pruned automatically so this never grows forever.
const AI_CHAT_HISTORY_TURNS = 16;
const AI_ACTIVITY_PAGE_SIZE = 10;
const AI_SCHEDULED_PAGE_SIZE = 8;
// The wake word admins use to summon Shinkou inside a group. Matched
// case-insensitively, in either script, as a substring — so "Shinkou",
// "shinkou جان", "@شینکو" etc. all trigger it. This is the ONLY thing that
// makes Shinkou respond in a group, which is what keeps its free daily
// Workers AI quota from being burned by ordinary group chatter.
const AI_WAKE_WORDS = ["shinkou", "شینکو"];

// How much passive group conversation history is kept and how much Shinkou
// is allowed to pull in one go — capped deliberately, since every extra
// message costs real tokens against the model's context window.
const GROUP_LOG_KEEP_PER_CHAT = 300;
const GROUP_LOG_DEFAULT_READ = 20;
const GROUP_LOG_MAX_READ = 50;
const GROUP_LOG_MAX_CHARS_PER_MESSAGE = 250;

function extractWakeWordPrompt(text: string): string | null {
  const lower = text.toLowerCase();
  const hit = AI_WAKE_WORDS.find((w) => lower.includes(w));
  if (!hit) return null;
  // Strip the first occurrence of the wake word (either script) and hand
  // the rest to the model as the actual instruction/question.
  const idx = lower.indexOf(hit);
  const stripped = (text.slice(0, idx) + text.slice(idx + hit.length)).trim();
  // Strip common leading punctuation left behind (",", "،", ":" etc.)
  return stripped.replace(/^[\s,،:\-]+/, "").trim();
}

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
    auto_delete_notice: "⚠️ توجه: این فایل‌ها تا {seconds} ثانیه دیگر برای همیشه از این چت پاک می‌شوند.\nهمین حالا آن‌ها را در گالری یا «پیام‌های ذخیره‌شده»ی خودتان ذخیره کنید.",
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
    btn_admin_mgmt: "🛡 مدیریت ادمین‌ها",
    admin_mgmt_panel_title: "🛡 مدیریت ادمین‌ها\n\nیکی از گزینه‌ها را انتخاب کنید:",
    btn_add_admin: "➕ افزودن ادمین",
    btn_admin_list: "📋 لیست ادمین‌ها",
    add_admin_prompt: "آیدی عددی تلگرام کاربر مورد نظر را ارسال کنید:\n(کاربر باید قبلاً حداقل یک‌بار با ربات /start زده باشد)",
    add_admin_invalid: "آیدی نامعتبر است. باید یک عدد باشد.",
    add_admin_already: "این کاربر از قبل ادمین است.",
    add_admin_ok: "✅ ادمین با آیدی {id} اضافه شد. اکنون می‌توانید دسترسی‌هایش را تنظیم کنید.",
    no_admins_yet: "به‌جز شما ادمین دیگری وجود ندارد.",
    admins_list_title: "📋 ادمین‌ها ({count} نفر):",
    admin_detail_title: "🛡 ادمین: {id}\nنوع: {role}",
    role_super: "مدیر کل (دسترسی کامل به همه‌چیز، از جمله مدیریت ادمین‌ها)",
    role_regular: "ادمین محدود — دسترسی‌ها را از دکمه‌های زیر تنظیم کنید:",
    perm_upload: "📤 آپلود آرشیو",
    perm_channels: "📁 مدیریت کانال‌ها",
    perm_archives_manage: "🗂 ویرایش/حذف آرشیوها",
    perm_ads: "📢 مدیریت تبلیغات",
    perm_broadcast: "📢 پیام همگانی",
    perm_settings: "⚙️ تنظیم حذف خودکار",
    perm_ai: "🤖 دستیار هوشمند",
    btn_remove_admin: "🗑 حذف این ادمین",
    remove_admin_confirm: "آیا از حذف ادمین {id} مطمئن هستید؟",
    remove_admin_ok: "🗑 ادمین حذف شد.",
    cannot_remove_super: "نمی‌توانید یک مدیر کل را از این پنل حذف کنید.",
    no_permission: "🚫 شما به این بخش دسترسی ندارید. از مدیر کل بخواهید دسترسی لازم را به شما بدهد.",
    super_only_notice: "این بخش فقط برای مدیر کل قابل دسترسی است.",

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
    upload_ask_description_fa: "عنوان: «{title}»\n\nحالا توضیحات فارسی این آرشیو را ارسال کنید (یا رد کنید):",
    upload_ask_description_en: "حالا توضیحات انگلیسی این آرشیو را ارسال کنید (یا رد کنید):",
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
      "🗂 {title}\n{status}\n\nتوضیحات (فارسی): {description}\nتوضیحات (English): {description_en}\nفایل‌ها: {file_count}\nبازدید: {views}\nکد: {code}\nکانال(های) لازم: {channels}",
    archive_active: "🟢 فعال",
    archive_inactive: "🔴 غیرفعال",
    no_description: "—",
    btn_edit_title: "✏️ ویرایش عنوان",
    btn_edit_desc_fa: "✏️ ویرایش توضیحات فارسی",
    btn_edit_desc_en: "✏️ ویرایش توضیحات انگلیسی",
    btn_manage_files: "🖼 مدیریت فایل‌ها",
    btn_toggle_active: "🔁 تغییر وضعیت فعال/غیرفعال",
    btn_delete_archive: "🗑 حذف آرشیو",
    btn_viewers: "👥 بازدیدکنندگان",
    viewers_title: "👥 بازدیدکنندگان «{title}» ({count} نفر):",
    viewer_line: "• {name} — آیدی: {id} — بازدید: {count} بار",
    no_username: "بدون یوزرنیم",
    no_viewers_yet: "هنوز کسی این آرشیو را دریافت نکرده است.",
    archive_delete_confirm: "آیا از حذف کامل آرشیو «{title}» و همه فایل‌های آن مطمئن هستید؟ این کار برگشت‌ناپذیر است.",
    archive_deleted_ok: "🗑 آرشیو حذف شد.",
    archive_status_changed: "✅ وضعیت آرشیو تغییر کرد.",
    edit_title_prompt: "عنوان جدید را ارسال کنید:",
    edit_desc_fa_prompt: "توضیحات فارسی جدید را ارسال کنید (یا برای خالی کردن، - ارسال کنید):",
    edit_desc_en_prompt: "توضیحات انگلیسی جدید را ارسال کنید (یا برای خالی کردن، - ارسال کنید):",
    title_updated: "✅ عنوان به‌روزرسانی شد.",
    desc_fa_updated: "✅ توضیحات فارسی به‌روزرسانی شد.",
    desc_en_updated: "✅ توضیحات انگلیسی به‌روزرسانی شد.",
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

    // ads management
    btn_ads: "📢 مدیریت تبلیغات",
    ads_panel_title: "📢 مدیریت تبلیغات\n\nهر زبان پنجره‌ی جدای خودش را دارد:",
    ad_detail: "🖼 تبلیغ {lang_name}\n\nعکس: {has_photo}\nمتن: {caption}",
    has_photo_yes: "دارد ✅",
    has_photo_no: "ندارد",
    btn_edit_ad: "✏️ ویرایش تبلیغ",
    btn_delete_ad: "🗑 حذف تبلیغ",
    btn_broadcast_ad: "📢 ارسال همگانی همین تبلیغ",
    edit_ad_prompt: "یک عکس همراه کپشن ارسال کنید (کپشن، متن تبلیغ خواهد بود)، یا اگر می‌خواهید بدون عکس فقط متن تبلیغ باشد، صرفاً متن را ارسال کنید.",
    ad_updated_ok: "✅ تبلیغ به‌روزرسانی شد.",
    ad_delete_confirm: "آیا از حذف تبلیغ {lang_name} مطمئن هستید؟",
    ad_deleted_ok: "🗑 تبلیغ حذف شد.",
    ad_broadcast_confirm: "این تبلیغ برای همه‌ی کاربران با زبان {lang_name} ارسال شود؟",
    no_ad_set: "هنوز تبلیغی برای این زبان تنظیم نشده است.",
    choose_language_prompt: "🌐 لطفاً زبان خود را انتخاب کنید:\nPlease choose your language:",

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

    // AI assistant
    btn_ai_assistant: "🤖 دستیار هوشمند",
    btn_ai_control: "🎛 کنترل و مدیریت AI",
    ai_disabled_notice: "🚫 دستیار هوشمند در حال حاضر توسط ادمین کل خاموش است.",
    ai_chat_welcome:
      "🤖 با دستیار هوشمند در گفتگو هستید.\n\nمی‌تونید ازش سوال بپرسید (آب‌وهوا، تاریخ و ...)، قوانین ساختار پست‌هاتون رو بهش یاد بدید، یا فایل/عکس بفرستید و بگید باهاش چیکار کنه.\nهیچ پستی بدون تأیید نهایی خودتون منتشر نمی‌شه.\n\nبرای خروج از این حالت، دکمه‌ی زیر رو بزنید.",
    btn_ai_chat_exit: "⏹ پایان گفتگو با دستیار",
    ai_chat_exited: "گفتگو با دستیار هوشمند پایان یافت.",
    ai_thinking: "🤖 در حال بررسی...",
    ai_file_received: "📎 مورد {count} دریافت شد ({type}).\nهر وقت آماده بودید، بگویید این محتوا باید چطور و کجا منتشر شود.",
    ai_error_generic: "⚠️ دستیار در پردازش این درخواست با خطا مواجه شد. لطفاً دوباره تلاش کنید.",
    ai_no_content_yet: "برای این کار، اول باید حداقل یک فایل/عکس یا یک متن مشخص در اختیار دستیار بگذارید.",
    ai_propose_title: "🤖 پیش‌نویس پست برای تأیید",
    ai_propose_body:
      "📋 درک دستیار از محتوا:\n{summary}\n\n📢 کانال: {channel}\n⏰ زمان‌بندی: {schedule}\n\nبرای انتشار طبق این زمان‌بندی، تأیید کنید:",
    btn_ai_confirm: "✅ تأیید و فعال‌سازی",
    btn_ai_reject: "❌ رد کردن",
    ai_proposal_confirmed: "✅ تأیید شد. طبق زمان‌بندی گفته‌شده اجرا خواهد شد.",
    ai_proposal_rejected: "❌ این پیش‌نویس رد و حذف شد.",
    ai_schedule_once: "یک‌بار، در {time}",
    ai_schedule_daily: "هر روز ساعت {time}",
    ai_schedule_weekly: "هر هفته، {day} ساعت {time}",

    // AI control panel
    ai_control_title: "🎛 کنترل و مدیریت AI",
    ai_control_body:
      "کلید کلی: {master}\nپست‌گذاری خودکار: {autopost}\n\nℹ️ دستیار هرگز نمی‌تواند پست‌های منتشرشده یا زمان‌بندی‌شده‌ی قبلی را ویرایش یا حذف کند — این قابلیت اصلاً در اختیارش گذاشته نشده. تنها استثنا: می‌تواند پست‌ خودش را حداکثر تا ۲ دقیقه پس از انتشار، فقط برای رفع اشتباه، ویرایش کند.",
    ai_master_on: "🟢 روشن",
    ai_master_off: "🔴 خاموش",
    btn_ai_toggle_master: "🔌 روشن/خاموش کردن کامل دستیار",
    btn_ai_toggle_autopost: "⏯ روشن/خاموش کردن پست‌گذاری خودکار",
    btn_ai_scheduled_list: "📋 پست‌های زمان‌بندی‌شده",
    btn_ai_activity_log: "📜 گزارش فعالیت‌ها",
    btn_ai_memory: "🧠 قوانین آموزش‌داده‌شده",
    ai_master_toggled: "✅ وضعیت کلی دستیار تغییر کرد.",
    ai_autopost_toggled: "✅ وضعیت پست‌گذاری خودکار تغییر کرد.",
    ai_no_scheduled: "هیچ پست زمان‌بندی‌شده‌ی فعالی وجود ندارد.",
    ai_scheduled_list_title: "📋 پست‌های زمان‌بندی‌شده ({count}):",
    ai_scheduled_line: "📢 {channel} — {schedule}",
    btn_ai_cancel_scheduled: "🗑 لغو این پست",
    ai_scheduled_cancelled: "🗑 پست زمان‌بندی‌شده لغو شد.",
    ai_no_memory: "هنوز هیچ قانونی به دستیار آموزش داده نشده است.",
    ai_memory_list_title: "🧠 قوانین آموزش‌داده‌شده ({count}):",
    btn_ai_delete_memory: "🗑 حذف این قانون",
    ai_memory_deleted: "🗑 قانون حذف شد.",
    btn_ai_clear_memory: "🗑 پاک‌کردن کامل حافظه",
    ai_clear_memory_confirm: "آیا از پاک‌کردن کامل حافظه‌ی دستیار (همه‌ی قوانین آموزش‌داده‌شده) مطمئن هستید؟",
    ai_memory_cleared: "🗑 حافظه‌ی دستیار کاملاً پاک شد.",
    ai_no_activity: "هنوز فعالیتی ثبت نشده است.",
    ai_activity_list_title: "📜 گزارش فعالیت‌ها ({count}):",
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
    auto_delete_notice: "⚠️ Note: these files will be permanently deleted from this chat in {seconds} seconds.\nSave them to your gallery or \"Saved Messages\" right now.",
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
    btn_admin_mgmt: "🛡 Admin Management",
    admin_mgmt_panel_title: "🛡 Admin Management\n\nChoose an option:",
    btn_add_admin: "➕ Add Admin",
    btn_admin_list: "📋 Admin List",
    add_admin_prompt: "Send the numeric Telegram ID of the user:\n(the user must have pressed /start at least once before)",
    add_admin_invalid: "Invalid ID. It must be a number.",
    add_admin_already: "This user is already an admin.",
    add_admin_ok: "✅ Admin with ID {id} added. You can now configure their permissions.",
    no_admins_yet: "There are no other admins besides you.",
    admins_list_title: "📋 Admins ({count}):",
    admin_detail_title: "🛡 Admin: {id}\nRole: {role}",
    role_super: "Super-admin (full access, including admin management)",
    role_regular: "Limited admin — configure access with the buttons below:",
    perm_upload: "📤 Upload Archive",
    perm_channels: "📁 Channel Management",
    perm_archives_manage: "🗂 Edit/Delete Archives",
    perm_ads: "📢 Ads Management",
    perm_broadcast: "📢 Broadcast",
    perm_settings: "⚙️ Auto-delete Settings",
    perm_ai: "🤖 AI Assistant",
    btn_remove_admin: "🗑 Remove This Admin",
    remove_admin_confirm: "Are you sure you want to remove admin {id}?",
    remove_admin_ok: "🗑 Admin removed.",
    cannot_remove_super: "You can't remove a super-admin from this panel.",
    no_permission: "🚫 You don't have access to this section. Ask the super-admin to grant it.",
    super_only_notice: "This section is only accessible to the super-admin.",

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
    upload_ask_description_fa: "Title: \"{title}\"\n\nNow send the Persian description for this archive (or skip):",
    upload_ask_description_en: "Now send the English description for this archive (or skip):",
    upload_ask_channels: "Which channel(s) should be required to unlock this archive?\nTap to toggle, then confirm.",
    upload_need_one_channel: "Select at least one channel.",
    upload_need_channels_first: "No channels are connected yet. Add one from \"Channel Management\" first.",
    upload_done: "✅ Archive created!\n\nTitle: {title}\nFiles: {count}\n\nShare link:\n{link}",
    btn_upload_done: "✅ Finish Upload",

    archives_panel_title: "🗂 Archive Management",
    no_archives_yet: "No archives created yet.",
    archives_list_title: "🗂 Archives ({count}):",
    archive_detail:
      "🗂 {title}\n{status}\n\nDescription (Persian): {description}\nDescription (English): {description_en}\nFiles: {file_count}\nViews: {views}\nCode: {code}\nRequired channel(s): {channels}",
    archive_active: "🟢 Active",
    archive_inactive: "🔴 Inactive",
    no_description: "—",
    btn_edit_title: "✏️ Edit Title",
    btn_edit_desc_fa: "✏️ Edit Persian Description",
    btn_edit_desc_en: "✏️ Edit English Description",
    btn_manage_files: "🖼 Manage Files",
    btn_toggle_active: "🔁 Toggle Active/Inactive",
    btn_delete_archive: "🗑 Delete Archive",
    btn_viewers: "👥 Viewers",
    viewers_title: "👥 Viewers of \"{title}\" ({count}):",
    viewer_line: "• {name} — ID: {id} — Views: {count}",
    no_username: "no username",
    no_viewers_yet: "No one has received this archive yet.",
    archive_delete_confirm: "Are you sure you want to permanently delete archive \"{title}\" and all its files? This cannot be undone.",
    archive_deleted_ok: "🗑 Archive deleted.",
    archive_status_changed: "✅ Archive status changed.",
    edit_title_prompt: "Send the new title:",
    edit_desc_fa_prompt: "Send the new Persian description (or send - to clear it):",
    edit_desc_en_prompt: "Send the new English description (or send - to clear it):",
    title_updated: "✅ Title updated.",
    desc_fa_updated: "✅ Persian description updated.",
    desc_en_updated: "✅ English description updated.",
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

    // ads management
    btn_ads: "📢 Ads Management",
    ads_panel_title: "📢 Ads Management\n\nEach language has its own separate window:",
    ad_detail: "🖼 {lang_name} Ad\n\nPhoto: {has_photo}\nText: {caption}",
    has_photo_yes: "Yes ✅",
    has_photo_no: "None",
    btn_edit_ad: "✏️ Edit Ad",
    btn_delete_ad: "🗑 Delete Ad",
    btn_broadcast_ad: "📢 Broadcast This Ad",
    edit_ad_prompt: "Send a photo with a caption (the caption becomes the ad text), or just send text if you want a photo-less ad.",
    ad_updated_ok: "✅ Ad updated.",
    ad_delete_confirm: "Are you sure you want to delete the {lang_name} ad?",
    ad_deleted_ok: "🗑 Ad deleted.",
    ad_broadcast_confirm: "Send this ad to all {lang_name}-language users?",
    no_ad_set: "No ad set for this language yet.",
    choose_language_prompt: "🌐 لطفاً زبان خود را انتخاب کنید:\nPlease choose your language:",

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

    // AI assistant
    btn_ai_assistant: "🤖 AI Assistant",
    btn_ai_control: "🎛 AI Control & Management",
    ai_disabled_notice: "🚫 The AI assistant is currently turned off by the super-admin.",
    ai_chat_welcome:
      "🤖 You're chatting with the AI assistant.\n\nAsk it things (weather, date, etc.), teach it your post-structure rules, or send a file/photo and tell it what to do with it.\nNo post is ever published without your final confirmation.\n\nTap the button below to exit this mode.",
    btn_ai_chat_exit: "⏹ End Chat With Assistant",
    ai_chat_exited: "Chat with the AI assistant ended.",
    ai_thinking: "🤖 Thinking...",
    ai_file_received: "📎 Item {count} received ({type}).\nWhenever you're ready, tell it how and where this content should be published.",
    ai_error_generic: "⚠️ The assistant hit an error processing this. Please try again.",
    ai_no_content_yet: "For this, first give the assistant at least one file/photo or a specific piece of text.",
    ai_propose_title: "🤖 Post Draft — Needs Your Approval",
    ai_propose_body:
      "📋 The assistant's understanding of the content:\n{summary}\n\n📢 Channel: {channel}\n⏰ Schedule: {schedule}\n\nConfirm to publish on this schedule:",
    btn_ai_confirm: "✅ Confirm & Activate",
    btn_ai_reject: "❌ Reject",
    ai_proposal_confirmed: "✅ Confirmed. It will run on the schedule described.",
    ai_proposal_rejected: "❌ This draft was rejected and discarded.",
    ai_schedule_once: "once, at {time}",
    ai_schedule_daily: "daily at {time}",
    ai_schedule_weekly: "weekly on {day} at {time}",

    // AI control panel
    ai_control_title: "🎛 AI Control & Management",
    ai_control_body:
      "Master switch: {master}\nAuto-posting: {autopost}\n\nℹ️ The assistant can never edit or delete any previously published or scheduled post — that capability was never given to it. The one exception: it may edit its own just-published post, for up to 2 minutes, only to fix a mistake.",
    ai_master_on: "🟢 On",
    ai_master_off: "🔴 Off",
    btn_ai_toggle_master: "🔌 Turn Assistant Fully On/Off",
    btn_ai_toggle_autopost: "⏯ Turn Auto-posting On/Off",
    btn_ai_scheduled_list: "📋 Scheduled Posts",
    btn_ai_activity_log: "📜 Activity Log",
    btn_ai_memory: "🧠 Taught Rules",
    ai_master_toggled: "✅ Assistant master state changed.",
    ai_autopost_toggled: "✅ Auto-posting state changed.",
    ai_no_scheduled: "No active scheduled posts.",
    ai_scheduled_list_title: "📋 Scheduled posts ({count}):",
    ai_scheduled_line: "📢 {channel} — {schedule}",
    btn_ai_cancel_scheduled: "🗑 Cancel This Post",
    ai_scheduled_cancelled: "🗑 Scheduled post cancelled.",
    ai_no_memory: "No rules have been taught to the assistant yet.",
    ai_memory_list_title: "🧠 Taught rules ({count}):",
    btn_ai_delete_memory: "🗑 Delete This Rule",
    ai_memory_deleted: "🗑 Rule deleted.",
    btn_ai_clear_memory: "🗑 Clear All Memory",
    ai_clear_memory_confirm: "Are you sure you want to completely clear the assistant's memory (all taught rules)?",
    ai_memory_cleared: "🗑 The assistant's memory was completely cleared.",
    ai_no_activity: "No activity logged yet.",
    ai_activity_list_title: "📜 Activity log ({count}):",
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

// ---------- AI assistant types ----------

type AiContentFileRow = FileRow & { vision_description: string | null };

type AiScheduledPostRow = {
  id: number;
  channel_id: number;
  content_session_id: number | null;
  caption: string | null;
  schedule_type: "once" | "daily" | "weekly";
  time_of_day: string | null;
  day_of_week: number | null;
  next_run_at: number;
  status: "awaiting_confirmation" | "active" | "cancelled" | "done";
  last_posted_at: number | null;
  posted_chat_id: string | null;
  posted_message_ids: string | null;
  edit_locked_at: number | null;
  created_by: string;
};

type AiMemoryRow = { id: number; rule_text: string; created_at: number };

type ArchiveRow = {
  id: number;
  code: string;
  title: string;
  description: string | null;
  description_en: string | null;
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

/** Gregorian -> Jalali (Persian) calendar conversion, no external library. */
function toJalali(gy: number, gm: number, gd: number): { jy: number; jm: number; jd: number } {
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = gy <= 1600 ? 0 : 979;
  gy -= gy <= 1600 ? 621 : 1600;
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days =
    365 * gy +
    Math.floor((gy2 + 3) / 4) -
    Math.floor((gy2 + 99) / 100) +
    Math.floor((gy2 + 399) / 400) -
    80 +
    gd +
    g_d_m[gm - 1];
  jy += 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return { jy, jm, jd };
}

const JALALI_MONTHS_FA = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
];

function formatNowForAi(): string {
  const d = new Date();
  const { jy, jm, jd } = toJalali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `Gregorian: ${d.toISOString().slice(0, 10)} ${hh}:${mm} UTC | Jalali (Persian): ${jd} ${JALALI_MONTHS_FA[jm - 1]} ${jy}`;
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

// ---------- admin roles & permissions ----------

type PermissionKey = "upload" | "channels" | "archives_manage" | "ads" | "broadcast" | "settings" | "ai";

const DEFAULT_ADMIN_PERMISSIONS: Record<PermissionKey, boolean> = {
  upload: true,
  channels: true,
  archives_manage: false,
  ads: false,
  broadcast: true,
  settings: false,
  ai: false,
};

type AdminInfo = { isSuper: boolean; permissions: Record<PermissionKey, boolean> };

async function getAdminInfo(env: Env, telegramId: number): Promise<AdminInfo | null> {
  const row = await env.DB.prepare("SELECT is_super, permissions FROM admins WHERE telegram_id = ?")
    .bind(String(telegramId)).first<{ is_super: number; permissions: string | null }>();
  if (!row) return null;
  const stored = row.permissions ? JSON.parse(row.permissions) : {};
  return { isSuper: !!row.is_super, permissions: { ...DEFAULT_ADMIN_PERMISSIONS, ...stored } };
}

/** True if this admin can use a given panel section — always true for a
 *  super-admin, otherwise depends on their configured permissions. */
async function hasPermission(env: Env, telegramId: number, key: PermissionKey): Promise<boolean> {
  const info = await getAdminInfo(env, telegramId);
  if (!info) return false;
  if (info.isSuper) return true;
  return !!info.permissions[key];
}

async function addAdmin(env: Env, telegramId: string) {
  await env.DB.prepare(
    `INSERT INTO admins (telegram_id, created_at, is_super, permissions) VALUES (?, ?, 0, ?)
     ON CONFLICT(telegram_id) DO NOTHING`
  ).bind(telegramId, now(), JSON.stringify(DEFAULT_ADMIN_PERMISSIONS)).run();
}

async function removeAdmin(env: Env, telegramId: string) {
  await env.DB.prepare("DELETE FROM admins WHERE telegram_id = ?").bind(telegramId).run();
}

async function listAdmins(env: Env): Promise<{ telegram_id: string; is_super: number }[]> {
  const res = await env.DB.prepare("SELECT telegram_id, is_super FROM admins ORDER BY is_super DESC, id ASC")
    .all<{ telegram_id: string; is_super: number }>();
  return res.results ?? [];
}

async function togglePermission(env: Env, telegramId: string, key: PermissionKey) {
  const info = await getAdminInfo(env, parseInt(telegramId, 10));
  if (!info || info.isSuper) return;
  const updated = { ...info.permissions, [key]: !info.permissions[key] };
  await env.DB.prepare("UPDATE admins SET permissions = ? WHERE telegram_id = ?")
    .bind(JSON.stringify(updated), telegramId).run();
}

async function upsertUser(env: Env, telegramId: number, username?: string | null, firstName?: string | null, lastName?: string | null) {
  const t0 = now();
  await env.DB.prepare(
    `INSERT INTO users (telegram_id, first_seen_at, last_seen_at, username, first_name, last_name) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(telegram_id) DO UPDATE SET last_seen_at = excluded.last_seen_at, username = excluded.username, first_name = excluded.first_name, last_name = excluded.last_name`
  ).bind(String(telegramId), t0, t0, username ?? null, firstName ?? null, lastName ?? null).run();
}

async function getUserLang(env: Env, telegramId: number): Promise<Lang> {
  const row = await env.DB.prepare("SELECT lang FROM users WHERE telegram_id = ?").bind(String(telegramId)).first<{ lang: string | null }>();
  return row?.lang === "en" ? "en" : DEFAULT_LANG;
}

/** Returns null if the user has never explicitly picked a language yet
 *  (used to decide whether to show the language picker on /start). */
async function getRawUserLang(env: Env, telegramId: number): Promise<Lang | null> {
  const row = await env.DB.prepare("SELECT lang FROM users WHERE telegram_id = ?").bind(String(telegramId)).first<{ lang: string | null }>();
  if (row?.lang === "en") return "en";
  if (row?.lang === "fa") return "fa";
  return null;
}

async function setUserLang(env: Env, telegramId: number, lang: Lang) {
  await env.DB.prepare("UPDATE users SET lang = ? WHERE telegram_id = ?").bind(lang, String(telegramId)).run();
}

// ---------- ads (per-language promo photo + caption, edited outside the upload flow) ----------

async function getAd(env: Env, lang: Lang) {
  return env.DB.prepare("SELECT file_id, file_type, caption, entities FROM ads WHERE lang = ?")
    .bind(lang).first<{ file_id: string | null; file_type: string | null; caption: string | null; entities: string | null }>();
}

async function setAd(env: Env, lang: Lang, fileId: string | null, fileType: string | null, caption: string | null, entities: unknown[] | null) {
  await env.DB.prepare(
    `INSERT INTO ads (lang, file_id, file_type, caption, entities, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(lang) DO UPDATE SET file_id = excluded.file_id, file_type = excluded.file_type, caption = excluded.caption, entities = excluded.entities, updated_at = excluded.updated_at`
  ).bind(lang, fileId, fileType, caption, entities && entities.length > 0 ? JSON.stringify(entities) : null, now()).run();
}

async function clearAd(env: Env, lang: Lang) {
  await setAd(env, lang, null, null, null, null);
}

async function getUserIdsByLang(env: Env, lang: Lang): Promise<string[]> {
  const query = lang === "fa"
    ? "SELECT telegram_id FROM users WHERE lang = 'fa' OR lang IS NULL"
    : "SELECT telegram_id FROM users WHERE lang = 'en'";
  const res = await env.DB.prepare(query).all<{ telegram_id: string }>();
  return (res.results ?? []).map((r) => r.telegram_id);
}

/** Sends the configured ad for this language, if one is set. Used both on
 *  plain /start and appended at the end of every archive delivery. */
async function sendAdIfConfigured(ctx: Context, env: Env, lang: Lang) {
  const ad = await getAd(env, lang);
  if (!ad || (!ad.file_id && !ad.caption)) return;
  const entities = ad.entities ? JSON.parse(ad.entities) : undefined;
  try {
    if (ad.file_id && ad.file_type) {
      const method = SEND_METHOD[ad.file_type] ?? "sendPhoto";
      const opts = ad.caption ? { caption: ad.caption, caption_entities: entities } : undefined;
      // @ts-ignore - dynamic method dispatch on the Bot API
      await ctx.api[method](ctx.chat!.id, ad.file_id, opts);
    } else if (ad.caption) {
      await ctx.reply(ad.caption, { entities });
    }
  } catch {
    /* never let a broken ad block the rest of the flow */
  }
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
  const res = await env.DB.prepare(
    `INSERT INTO upload_session_files (session_id, file_id, file_unique_id, file_type, file_name, caption, order_index, created_at)
     VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(order_index), 0) + 1 FROM upload_session_files WHERE session_id = ?), ?)`
  ).bind(sessionId, f.file_id, f.file_unique_id, f.file_type, f.file_name, f.caption, sessionId, now()).run();
  const row = await env.DB.prepare("SELECT order_index FROM upload_session_files WHERE id = ?")
    .bind(res.meta.last_row_id).first<{ order_index: number }>();
  return row?.order_index ?? 1;
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
  descriptionFa: string | null,
  descriptionEn: string | null,
  channelIds: number[]
): Promise<string> {
  const files = await getSessionFiles(env, sessionId);
  const code = generateCode();
  const t0 = now();
  const defaultDelete = parseInt(await getSetting(env, "auto_delete_seconds", String(DEFAULT_AUTO_DELETE_SECONDS)), 10);

  const archiveRes = await env.DB.prepare(
    `INSERT INTO archives (code, title, description, description_en, delete_after_seconds, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
  ).bind(code, title, descriptionFa, descriptionEn, defaultDelete, t0, t0).run();
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
  const row = await env.DB.prepare("SELECT id, code, title, description, description_en, is_active, delete_after_seconds, views FROM archives WHERE code = ?")
    .bind(code).first<ArchiveRow>();
  return row ?? null;
}

async function getArchiveById(env: Env, id: number): Promise<ArchiveRow | null> {
  const row = await env.DB.prepare("SELECT id, code, title, description, description_en, is_active, delete_after_seconds, views FROM archives WHERE id = ?")
    .bind(id).first<ArchiveRow>();
  return row ?? null;
}

async function getAllArchives(env: Env): Promise<ArchiveRow[]> {
  const res = await env.DB.prepare("SELECT id, code, title, description, description_en, is_active, delete_after_seconds, views FROM archives ORDER BY id DESC").all<ArchiveRow>();
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

async function getArchiveViewers(env: Env, code: string, limit: number, offset: number) {
  const res = await env.DB.prepare(
    `SELECT e.telegram_id as telegram_id, COUNT(*) as view_count, u.username as username, u.first_name as first_name, u.last_name as last_name
     FROM events e
     LEFT JOIN users u ON u.telegram_id = e.telegram_id
     WHERE e.type = 'archive_delivered' AND e.ref_id = ?
     GROUP BY e.telegram_id
     ORDER BY view_count DESC
     LIMIT ? OFFSET ?`
  ).bind(code, limit, offset).all<{ telegram_id: string; view_count: number; username: string | null; first_name: string | null; last_name: string | null }>();
  return res.results ?? [];
}

async function countArchiveViewers(env: Env, code: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(DISTINCT telegram_id) as c FROM events WHERE type = 'archive_delivered' AND ref_id = ?"
  ).bind(code).first<{ c: number }>();
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
// AI assistant — data access
// =========================================================================

// ---------- master switches (reuse the generic `settings` table) ----------

async function isAiMasterEnabled(env: Env): Promise<boolean> {
  return (await getSetting(env, "ai_master_enabled", "1")) !== "0";
}
async function setAiMasterEnabled(env: Env, on: boolean) {
  await setSetting(env, "ai_master_enabled", on ? "1" : "0");
}
async function isAiAutopostEnabled(env: Env): Promise<boolean> {
  return (await getSetting(env, "ai_autopost_enabled", "1")) !== "0";
}
async function setAiAutopostEnabled(env: Env, on: boolean) {
  await setSetting(env, "ai_autopost_enabled", on ? "1" : "0");
}

// ---------- memory (rules the admin taught the AI) ----------

async function addAiMemory(env: Env, ruleText: string) {
  await env.DB.prepare("INSERT INTO ai_memory (rule_text, created_at) VALUES (?, ?)").bind(ruleText, now()).run();
}
async function getAllAiMemory(env: Env): Promise<AiMemoryRow[]> {
  const res = await env.DB.prepare("SELECT id, rule_text, created_at FROM ai_memory ORDER BY id ASC").all<AiMemoryRow>();
  return res.results ?? [];
}
async function deleteAiMemory(env: Env, id: number) {
  await env.DB.prepare("DELETE FROM ai_memory WHERE id = ?").bind(id).run();
}
async function clearAllAiMemory(env: Env) {
  await env.DB.prepare("DELETE FROM ai_memory").run();
}

// ---------- content staging session ----------

async function getActiveAiContentSession(env: Env, adminId: number): Promise<{ id: number } | null> {
  const row = await env.DB.prepare(
    "SELECT id FROM ai_content_sessions WHERE admin_telegram_id = ? AND status = 'collecting' ORDER BY id DESC LIMIT 1"
  ).bind(String(adminId)).first<{ id: number }>();
  return row ?? null;
}
async function getOrStartAiContentSession(env: Env, adminId: number): Promise<number> {
  const existing = await getActiveAiContentSession(env, adminId);
  if (existing) return existing.id;
  const t0 = now();
  const res = await env.DB.prepare(
    "INSERT INTO ai_content_sessions (admin_telegram_id, status, created_at, updated_at) VALUES (?, 'collecting', ?, ?)"
  ).bind(String(adminId), t0, t0).run();
  return res.meta.last_row_id as number;
}
async function addFileToAiContentSession(env: Env, sessionId: number, f: Omit<FileRow, "order_index">, visionDescription: string | null): Promise<number> {
  const res = await env.DB.prepare(
    `INSERT INTO ai_content_session_files (session_id, file_id, file_unique_id, file_type, file_name, caption, order_index, created_at, vision_description)
     VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(order_index), 0) + 1 FROM ai_content_session_files WHERE session_id = ?), ?, ?)`
  ).bind(sessionId, f.file_id, f.file_unique_id, f.file_type, f.file_name, f.caption, sessionId, now(), visionDescription).run();
  const row = await env.DB.prepare("SELECT order_index FROM ai_content_session_files WHERE id = ?")
    .bind(res.meta.last_row_id).first<{ order_index: number }>();
  return row?.order_index ?? 1;
}
async function getAiContentSessionFiles(env: Env, sessionId: number): Promise<AiContentFileRow[]> {
  const res = await env.DB.prepare(
    "SELECT file_id, file_unique_id, file_type, file_name, caption, order_index, vision_description FROM ai_content_session_files WHERE session_id = ? ORDER BY order_index ASC"
  ).bind(sessionId).all<AiContentFileRow>();
  return res.results ?? [];
}
async function markAiContentSessionUsed(env: Env, sessionId: number) {
  await env.DB.prepare("UPDATE ai_content_sessions SET status = 'used', updated_at = ? WHERE id = ?").bind(now(), sessionId).run();
}
async function clearAiContentSession(env: Env, adminId: number) {
  const existing = await getActiveAiContentSession(env, adminId);
  if (!existing) return;
  await env.DB.prepare("UPDATE ai_content_sessions SET status = 'cancelled', updated_at = ? WHERE id = ?").bind(now(), existing.id).run();
  await env.DB.prepare("DELETE FROM ai_content_session_files WHERE session_id = ?").bind(existing.id).run();
}

// ---------- scheduled posts ----------

function computeNextRun(scheduleType: "once" | "daily" | "weekly", timeOfDay: string | null, dayOfWeek: number | null, fromMs: number): number {
  if (scheduleType === "once") return fromMs;
  const [hh, mm] = (timeOfDay ?? "09:00").split(":").map((x) => parseInt(x, 10));
  const d = new Date(fromMs);
  d.setUTCSeconds(0, 0);
  d.setUTCHours(hh, mm, 0, 0);
  if (scheduleType === "daily") {
    if (d.getTime() <= fromMs) d.setUTCDate(d.getUTCDate() + 1);
    return d.getTime();
  }
  // weekly
  const targetDow = dayOfWeek ?? d.getUTCDay();
  let diff = (targetDow - d.getUTCDay() + 7) % 7;
  if (diff === 0 && d.getTime() <= fromMs) diff = 7;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.getTime();
}

async function createAiScheduledPost(
  env: Env,
  createdBy: string,
  channelDbId: number,
  contentSessionId: number | null,
  caption: string | null,
  scheduleType: "once" | "daily" | "weekly",
  timeOfDay: string | null,
  dayOfWeek: number | null
): Promise<number> {
  const t0 = now();
  const nextRun = scheduleType === "once" && !timeOfDay ? t0 : computeNextRun(scheduleType, timeOfDay, dayOfWeek, t0);
  const res = await env.DB.prepare(
    `INSERT INTO ai_scheduled_posts
       (channel_id, content_session_id, caption, schedule_type, time_of_day, day_of_week, next_run_at, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'awaiting_confirmation', ?, ?, ?)`
  ).bind(channelDbId, contentSessionId, caption, scheduleType, timeOfDay, dayOfWeek, nextRun, createdBy, t0, t0).run();
  return res.meta.last_row_id as number;
}

async function getAiScheduledPost(env: Env, id: number): Promise<AiScheduledPostRow | null> {
  const row = await env.DB.prepare("SELECT * FROM ai_scheduled_posts WHERE id = ?").bind(id).first<AiScheduledPostRow>();
  return row ?? null;
}

async function confirmAiScheduledPost(env: Env, id: number) {
  await env.DB.prepare("UPDATE ai_scheduled_posts SET status = 'active', updated_at = ? WHERE id = ? AND status = 'awaiting_confirmation'")
    .bind(now(), id).run();
}

async function rejectAiScheduledPost(env: Env, id: number) {
  await env.DB.prepare("DELETE FROM ai_scheduled_posts WHERE id = ? AND status = 'awaiting_confirmation'").bind(id).run();
}

/** Cancel — only ever reachable for posts that are not yet published, or
 *  for the admin cancelling their own recurring series going forward.
 *  Never deletes anything already sent to the channel. */
async function cancelAiScheduledPost(env: Env, id: number) {
  await env.DB.prepare("UPDATE ai_scheduled_posts SET status = 'cancelled', updated_at = ? WHERE id = ?").bind(now(), id).run();
}

async function listActiveAiScheduledPosts(env: Env): Promise<AiScheduledPostRow[]> {
  const res = await env.DB.prepare("SELECT * FROM ai_scheduled_posts WHERE status = 'active' ORDER BY next_run_at ASC").all<AiScheduledPostRow>();
  return res.results ?? [];
}

async function findDueAiScheduledPosts(env: Env): Promise<AiScheduledPostRow[]> {
  const res = await env.DB.prepare("SELECT * FROM ai_scheduled_posts WHERE status = 'active' AND next_run_at <= ? LIMIT 20")
    .bind(now()).all<AiScheduledPostRow>();
  return res.results ?? [];
}

async function afterAiPostPublished(env: Env, post: AiScheduledPostRow, chatId: string, messageIds: number[]) {
  const t0 = now();
  const isRecurring = post.schedule_type !== "once";
  const nextRun = isRecurring ? computeNextRun(post.schedule_type, post.time_of_day, post.day_of_week, t0 + 60000) : post.next_run_at;
  await env.DB.prepare(
    `UPDATE ai_scheduled_posts
     SET status = ?, last_posted_at = ?, posted_chat_id = ?, posted_message_ids = ?, edit_locked_at = ?, next_run_at = ?, updated_at = ?
     WHERE id = ?`
  ).bind(
    isRecurring ? "active" : "done",
    t0,
    chatId,
    JSON.stringify(messageIds),
    t0 + AI_EDIT_WINDOW_MS,
    nextRun,
    t0,
    post.id
  ).run();
}

// ---------- activity log ----------

async function logAiActivity(env: Env, actionType: string, detail: string, channelId?: number) {
  await env.DB.prepare("INSERT INTO ai_activity_log (action_type, detail, channel_id, created_at) VALUES (?, ?, ?, ?)")
    .bind(actionType, detail, channelId ?? null, now()).run();
}
async function listAiActivity(env: Env, limit: number, offset: number) {
  const res = await env.DB.prepare("SELECT action_type, detail, created_at FROM ai_activity_log ORDER BY id DESC LIMIT ? OFFSET ?")
    .bind(limit, offset).all<{ action_type: string; detail: string; created_at: number }>();
  return res.results ?? [];
}
async function countAiActivity(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) as c FROM ai_activity_log").first<{ c: number }>();
  return row?.c ?? 0;
}

// ---------- short rolling chat history (per admin) ----------

async function appendAiChatHistory(env: Env, telegramId: number, role: "user" | "model" | "tool", content: string) {
  await env.DB.prepare("INSERT INTO ai_chat_history (telegram_id, role, content, created_at) VALUES (?, ?, ?, ?)")
    .bind(String(telegramId), role, content, now()).run();
  // prune anything beyond the last AI_CHAT_HISTORY_TURNS*2 rows for this admin
  await env.DB.prepare(
    `DELETE FROM ai_chat_history WHERE telegram_id = ? AND id NOT IN (
       SELECT id FROM ai_chat_history WHERE telegram_id = ? ORDER BY id DESC LIMIT ?
     )`
  ).bind(String(telegramId), String(telegramId), AI_CHAT_HISTORY_TURNS * 2).run();
}
async function getAiChatHistory(env: Env, telegramId: number): Promise<{ role: "user" | "model" | "tool"; content: string }[]> {
  const res = await env.DB.prepare("SELECT role, content FROM ai_chat_history WHERE telegram_id = ? ORDER BY id ASC")
    .bind(String(telegramId)).all<{ role: "user" | "model" | "tool"; content: string }>();
  return res.results ?? [];
}
async function clearAiChatHistory(env: Env, telegramId: number) {
  await env.DB.prepare("DELETE FROM ai_chat_history WHERE telegram_id = ?").bind(String(telegramId)).run();
}

// ---------- reaction tracking (aggregated counts only, no per-user identity) ----------

// Hard cap so this table never grows unbounded — only the most recently
// reacted-to messages per chat are kept; anything older just falls off.
const AI_REACTIONS_KEEP_PER_CHAT = 200;

// Standard Telegram "thumbs down"-style reactions treated as negative.
// Everything else Shinkou tracks is treated as positive/neutral — this is
// deliberately simple (like vs dislike), not a full sentiment model.
const NEGATIVE_REACTION_EMOJIS = new Set(["👎", "💩", "🤮", "🤬", "😡", "💔", "😢", "😭"]);

async function upsertMessageReactionCounts(env: Env, chatId: string, messageId: number, reactions: { emoji: string; count: number }[]) {
  await env.DB.prepare(
    `INSERT INTO ai_message_reactions (chat_id, message_id, reactions_json, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(chat_id, message_id) DO UPDATE SET reactions_json = excluded.reactions_json, updated_at = excluded.updated_at`
  ).bind(chatId, messageId, JSON.stringify(reactions), now()).run();
  // Prune to the cap right away so this table can never grow unbounded.
  await env.DB.prepare(
    `DELETE FROM ai_message_reactions WHERE chat_id = ? AND rowid NOT IN (
       SELECT rowid FROM ai_message_reactions WHERE chat_id = ? ORDER BY updated_at DESC LIMIT ?
     )`
  ).bind(chatId, chatId, AI_REACTIONS_KEEP_PER_CHAT).run();
}

/** Turns raw per-emoji counts into a simple, decisive like-vs-dislike
 *  read — this is what makes "was it a like or a dislike?" answerable
 *  instead of just handing back a pile of emoji counts. */
async function getMessageReactionsSummary(env: Env, chatId: string, messageId: number): Promise<string | null> {
  const row = await env.DB.prepare("SELECT reactions_json FROM ai_message_reactions WHERE chat_id = ? AND message_id = ?")
    .bind(chatId, messageId).first<{ reactions_json: string }>();
  if (!row) return null;
  try {
    const reactions: { emoji: string; count: number }[] = JSON.parse(row.reactions_json);
    if (reactions.length === 0) return "No reactions yet.";
    let likes = 0;
    let dislikes = 0;
    for (const r of reactions) {
      if (NEGATIVE_REACTION_EMOJIS.has(r.emoji)) dislikes += r.count;
      else likes += r.count;
    }
    const verdict = likes === 0 && dislikes === 0 ? "no clear reaction" : likes >= dislikes ? "overall LIKED" : "overall DISLIKED";
    const detail = reactions.map((r) => `${r.emoji}×${r.count}`).join(", ");
    return `${verdict} — ${likes} like(s), ${dislikes} dislike(s) (breakdown: ${detail}).`;
  } catch {
    return null;
  }
}

// ---------- passive group-message log (read-only awareness for Shinkou) ----------

/** Logs one group message from ANYONE (admin or regular user) — purely
 *  passive, never used to act on/reply to regular users. Pruned to the
 *  most recent GROUP_LOG_KEEP_PER_CHAT rows per chat so this never grows
 *  unbounded or gets expensive to read back. */
async function logGroupMessage(env: Env, chatId: string, messageId: number, senderId: string | null, senderName: string | null, text: string | null) {
  if (!text) return;
  await env.DB.prepare(
    "INSERT INTO group_message_log (chat_id, message_id, sender_id, sender_name, text, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(chatId, messageId, senderId, senderName, text.slice(0, GROUP_LOG_MAX_CHARS_PER_MESSAGE), now()).run();
  await env.DB.prepare(
    `DELETE FROM group_message_log WHERE chat_id = ? AND id NOT IN (
       SELECT id FROM group_message_log WHERE chat_id = ? ORDER BY id DESC LIMIT ?
     )`
  ).bind(chatId, chatId, GROUP_LOG_KEEP_PER_CHAT).run();
}

/** Token-capped read for Shinkou's on-demand "catch me up" tool — hard
 *  clamped to GROUP_LOG_MAX_READ regardless of what's requested. */
async function getRecentGroupMessages(env: Env, chatId: string, count: number): Promise<{ senderName: string | null; text: string }[]> {
  const limit = Math.max(1, Math.min(count, GROUP_LOG_MAX_READ));
  const res = await env.DB.prepare("SELECT sender_name, text FROM group_message_log WHERE chat_id = ? ORDER BY id DESC LIMIT ?")
    .bind(chatId, limit).all<{ sender_name: string | null; text: string }>();
  return (res.results ?? []).reverse().map((r) => ({ senderName: r.sender_name, text: r.text }));
}

// =========================================================================
// Keyboards
// =========================================================================

function mainReplyKeyboard(lang: Lang, info: AdminInfo): Keyboard {
  const kb = new Keyboard();
  const perms = info.permissions;

  if (info.isSuper || perms.upload) kb.text(t(lang, "btn_upload")).row();

  const row2: string[] = [];
  if (info.isSuper || perms.channels) row2.push(t(lang, "btn_channels"));
  row2.push(t(lang, "btn_archives")); // list/view always allowed; edit/delete gated inside
  if (row2.length === 2) kb.text(row2[0]).text(row2[1]).row();
  else kb.text(row2[0]).row();

  kb.text(t(lang, "btn_stats")).text(t(lang, "btn_info")).row();

  if (info.isSuper || perms.broadcast) kb.text(t(lang, "btn_broadcast")).row();
  if (info.isSuper || perms.ads) kb.text(t(lang, "btn_ads")).row();
  if (info.isSuper || perms.ai) kb.text(t(lang, "btn_ai_assistant")).text(t(lang, "btn_ai_control")).row();

  kb.text(t(lang, "btn_settings")).row();
  if (info.isSuper) kb.text(t(lang, "btn_admin_mgmt")).row();

  return kb.resized();
}

function matchAnyLang(text: string, key: TKey): boolean {
  return text === T.fa[key] || text === T.en[key];
}

// =========================================================================
// AI assistant — engine (vision, weather, tools, tool-calling loop)
// =========================================================================

/** Downloads a Telegram file and returns it as a base64 data URI, so it can
 *  be handed directly to the vision model. */
async function telegramFileToDataUri(env: Env, ctx: Context, fileId: string): Promise<string | null> {
  try {
    const file = await ctx.api.getFile(fileId);
    if (!file.file_path) return null;
    const url = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${file.file_path}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const b64 = btoa(binary);
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    return `data:${contentType};base64,${b64}`;
  } catch {
    return null;
  }
}

/** Real, model-based understanding of an image (not a guess) — computed
 *  once, at upload time, and cached in ai_content_session_files so the
 *  assistant never has to re-analyze the same file twice. */
async function analyzeImageForAi(env: Env, dataUri: string): Promise<string | null> {
  try {
    const result: any = await env.AI.run(AI_MODEL, {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "این تصویر را دقیق و مختصر (حداکثر ۲ جمله) به فارسی توصیف کن: چه چیزی در تصویر است، اگر متنی روی آن هست بگو چه متنی، و حال‌وهوای کلی آن." },
            { type: "image_url", image_url: { url: dataUri } },
          ],
        },
      ],
      max_tokens: 200,
    });
    return result?.response ?? null;
  } catch {
    return null;
  }
}

/** If the admin's summon message was a reply to another message, fetch that
 *  message's text/caption plus any tracked reaction counts on it, so Shinkou
 *  can answer "what do you think of this?" / "how did it do?" style
 *  questions without guessing. */
async function buildQuotedMessageContext(
  ctx: Context,
  env: Env,
  chatId: string
): Promise<{ text: string; reactionsSummary: string | null } | null> {
  const replied: any = (ctx.message as any)?.reply_to_message;
  if (!replied) return null;
  const text: string = replied.text ?? replied.caption ?? "(non-text content)";
  const reactionsSummary = await getMessageReactionsSummary(env, chatId, replied.message_id);
  return { text, reactionsSummary };
}

async function geocodeCity(city: string): Promise<{ lat: number; lon: number; name: string } | null> {
  try {
    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=fa`);
    if (!res.ok) return null;
    const data: any = await res.json();
    const first = data?.results?.[0];
    if (!first) return null;
    return { lat: first.latitude, lon: first.longitude, name: first.name };
  } catch {
    return null;
  }
}

async function fetchWeather(city: string): Promise<string> {
  const loc = await geocodeCity(city);
  if (!loc) return `شهر «${city}» پیدا نشد.`;
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,weather_code,wind_speed_10m&timezone=auto`
    );
    if (!res.ok) return "دریافت اطلاعات آب‌وهوا با خطا مواجه شد.";
    const data: any = await res.json();
    const c = data?.current;
    if (!c) return "اطلاعات آب‌وهوا در دسترس نبود.";
    return `آب‌وهوای ${loc.name}: دمای فعلی ${c.temperature_2m}°C، سرعت باد ${c.wind_speed_10m} km/h.`;
  } catch {
    return "دریافت اطلاعات آب‌وهوا با خطا مواجه شد.";
  }
}

// ---------- tool (function) definitions given to the model ----------
// Deliberately does NOT include anything that deletes/edits an existing
// channel, admin, archive, or already-published post — those simply have
// no corresponding tool, so the model has no way to reach them.

const AI_TOOLS = [
  {
    type: "function",
    function: {
      name: "get_datetime",
      description: "Get the current date and time (Gregorian and Persian/Jalali calendars).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get the current weather for a named city.",
      parameters: {
        type: "object",
        properties: { city: { type: "string", description: "City name, e.g. Tehran" } },
        required: ["city"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_channels",
      description: "List the Telegram channels currently connected to this bot, where the bot is admin and can post.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_pending_content",
      description: "List the files/photos the admin has sent in this conversation, in the exact order they were sent, with a real description of each.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "save_rule",
      description: "Permanently remember a rule/structure/convention the admin is teaching you about how this channel's posts should look. Use this whenever the admin explains 'our posts are structured like...' or similar.",
      parameters: {
        type: "object",
        properties: { rule_text: { type: "string", description: "The rule, written clearly, in the language the admin used." } },
        required: ["rule_text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_post",
      description:
        "Create a DRAFT scheduled post for the admin to review and approve. This does NOT publish anything by itself — it only shows the admin a preview with your understanding of the content, and nothing runs until the admin taps Confirm. Requires that the admin has already provided content (check list_pending_content first) OR an explicit text_body.",
      parameters: {
        type: "object",
        properties: {
          channel_title_or_username: { type: "string", description: "Which connected channel to post to — match against list_channels." },
          content_summary_fa: { type: "string", description: "Your own understanding of the content and its order, written in Persian, to show the admin for confirmation. Be specific about order (e.g. 'album of 2 photos then a text caption')." },
          text_body: { type: "string", description: "Optional extra caption/text to accompany the pending files, or the full post text if there are no files." },
          schedule_type: { type: "string", enum: ["once", "daily", "weekly"] },
          time_of_day: { type: "string", description: "HH:MM 24-hour, in UTC." },
          day_of_week: { type: "number", description: "0=Sunday..6=Saturday, only for weekly schedules." },
        },
        required: ["channel_title_or_username", "content_summary_fa", "schedule_type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_my_scheduled_posts",
      description: "List the scheduled posts you (the assistant) have created that are awaiting confirmation or already active.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_my_scheduled_post",
      description: "Cancel one of your own scheduled posts (only ones you created, and only before/around its own confirmation — for anything else, tell the admin to use the AI Control panel).",
      parameters: {
        type: "object",
        properties: { post_id: { type: "number" } },
        required: ["post_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_recent_post",
      description:
        "Fix a mistake in a post you JUST published, ONLY within a couple of minutes of publishing it. Will be refused automatically once that window has passed. Cannot be used on multi-file albums, and can never touch anything not created by you.",
      parameters: {
        type: "object",
        properties: {
          post_id: { type: "number" },
          new_text: { type: "string", description: "The corrected caption/text." },
        },
        required: ["post_id", "new_text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "react",
      description:
        "Add an emoji reaction to the message the admin just summoned/spoke to you in. Use this for a quick acknowledgement or reaction instead of (or in addition to) a text reply — e.g. react 👍 to approve something shown to you.",
      parameters: {
        type: "object",
        properties: { emoji: { type: "string", description: "A single emoji, e.g. 👍 ❤️ 😂 🔥 🎉" } },
        required: ["emoji"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_message_reactions",
      description: "Get the tracked reaction counts on the message the admin's request was replying to, if any.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "read_recent_group_messages",
      description:
        "Read the most recent messages sent by ANYONE in the current group (not just the admin), to catch up on what's been discussed. Only works when you are currently being talked to inside a group. Capped for token efficiency — only ask for more than the default if you genuinely need a longer window.",
      parameters: {
        type: "object",
        properties: { count: { type: "number", description: "How many recent messages to read, default 20, max 50." } },
      },
    },
  },
] as const;

type AiChatContext =
  | { kind: "private" }
  | { kind: "group"; chatId: string; title: string | null };

type AiToolCallCtx = {
  env: Env;
  ctx: Context;
  adminId: number;
  lang: Lang;
  isOwner: boolean; // true only for the super-admin — the actual owner of the bot
  chatContext: AiChatContext;
  /** If the summon message was itself a reply to another message, that
   *  quoted message's text/caption + any tracked reactions — given to the
   *  model as context so "what do you think of this?" style questions work. */
  quotedMessage: { text: string; reactionsSummary: string | null } | null;
  /** The message Shinkou was actually summoned/spoken to in — used by the
   *  react tool, since "react to what I just said/showed you" always means
   *  this message unless the admin points at something else. */
  triggerChatId: string;
  triggerMessageId: number;
};

/** Workers AI has been observed returning tool-call arguments both as a
 *  JSON string and as an already-parsed object, depending on the model —
 *  calling JSON.parse on an already-parsed object throws, which used to
 *  crash the whole conversation turn any time a tool was invoked. This
 *  normalizes both shapes safely. */
function safeParseToolArgs(raw: unknown): any {
  if (raw == null) return {};
  if (typeof raw === "object") return raw;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return {};
}

async function executeAiTool(tc: AiToolCallCtx, name: string, args: any): Promise<string> {
  const { env, adminId } = tc;
  switch (name) {
    case "get_datetime":
      return formatNowForAi();

    case "get_weather":
      return await fetchWeather(String(args.city ?? ""));

    case "list_channels": {
      const channels = await getAllChannels(env);
      if (channels.length === 0) return "No channels connected yet.";
      return channels.map((c) => `id=${c.id} title="${c.title ?? c.username ?? c.channel_id}"`).join("\n");
    }

    case "list_pending_content": {
      const session = await getActiveAiContentSession(env, adminId);
      if (!session) return "No content has been sent yet.";
      const files = await getAiContentSessionFiles(env, session.id);
      if (files.length === 0) return "No content has been sent yet.";
      return files
        .map((f) => `#${f.order_index} type=${f.file_type}${f.caption ? ` caption="${f.caption}"` : ""}${f.vision_description ? ` — ${f.vision_description}` : ""}`)
        .join("\n");
    }

    case "save_rule": {
      const ruleText = String(args.rule_text ?? "").trim();
      if (!ruleText) return "Error: empty rule.";
      await addAiMemory(env, ruleText);
      await logAiActivity(env, "rule_saved", ruleText);
      return "Rule saved permanently.";
    }

    case "propose_post": {
      const session = await getActiveAiContentSession(env, adminId);
      const files = session ? await getAiContentSessionFiles(env, session.id) : [];
      const textBody = args.text_body ? String(args.text_body) : null;
      if (files.length === 0 && !textBody) {
        return "Error: no content available yet. Ask the admin to send files or specify the exact text first.";
      }
      const channels = await getAllChannels(env);
      const needle = String(args.channel_title_or_username ?? "").toLowerCase();
      const channel = channels.find(
        (c) => (c.title ?? "").toLowerCase().includes(needle) || (c.username ?? "").toLowerCase().includes(needle)
      );
      if (!channel) return `Error: channel "${args.channel_title_or_username}" not found among connected channels. Call list_channels first.`;
      const scheduleType = (["once", "daily", "weekly"].includes(args.schedule_type) ? args.schedule_type : "once") as
        | "once"
        | "daily"
        | "weekly";
      const timeOfDay = args.time_of_day ?? null;
      const dayOfWeek = typeof args.day_of_week === "number" ? args.day_of_week : null;

      const postId = await createAiScheduledPost(
        env,
        String(adminId),
        channel.id,
        session ? session.id : null,
        textBody,
        scheduleType,
        timeOfDay,
        dayOfWeek
      );
      if (session) await markAiContentSessionUsed(env, session.id);

      await sendAiProposalMessage(tc.ctx, env, tc.lang, postId, channel, String(args.content_summary_fa ?? ""), scheduleType, timeOfDay, dayOfWeek);
      return `Draft #${postId} created and shown to the admin for confirmation. Do not tell the admin it is already scheduled — it only runs after they tap Confirm.`;
    }

    case "list_my_scheduled_posts": {
      const posts = await listActiveAiScheduledPosts(env);
      const mine = posts.filter((p) => p.created_by === String(adminId));
      if (mine.length === 0) return "No active scheduled posts.";
      return mine.map((p) => `id=${p.id} schedule=${p.schedule_type} time=${p.time_of_day ?? "-"}`).join("\n");
    }

    case "cancel_my_scheduled_post": {
      const post = await getAiScheduledPost(env, Number(args.post_id));
      if (!post || post.created_by !== String(adminId)) return "Error: no such scheduled post found for you.";
      if (post.status === "done") return "Error: this post was already published and cannot be cancelled.";
      await cancelAiScheduledPost(env, post.id);
      await logAiActivity(env, "schedule_cancelled", `post #${post.id}`, post.channel_id);
      return "Cancelled.";
    }

    case "edit_recent_post": {
      return await aiEditRecentPost(env, tc.ctx, adminId, Number(args.post_id), String(args.new_text ?? ""));
    }

    case "react": {
      const emoji = String(args.emoji ?? "").trim();
      if (!emoji) return "Error: no emoji given.";
      try {
        // @ts-ignore - reaction methods are newer than this project's pinned grammy types
        await tc.ctx.api.setMessageReaction(tc.triggerChatId, tc.triggerMessageId, [{ type: "emoji", emoji }]);
        return "Reacted.";
      } catch {
        return "Error: could not react with that emoji (Telegram may not support it, or reactions aren't enabled for this chat).";
      }
    }

    case "get_message_reactions": {
      if (!tc.quotedMessage) return "There is no quoted/replied-to message for this request.";
      return tc.quotedMessage.reactionsSummary ?? "No reactions tracked on that message yet.";
    }

    case "read_recent_group_messages": {
      if (tc.chatContext.kind !== "group") return "Error: not currently in a group — there is nothing to read here.";
      const count = typeof args.count === "number" ? args.count : GROUP_LOG_DEFAULT_READ;
      const msgs = await getRecentGroupMessages(env, tc.chatContext.chatId, count);
      if (msgs.length === 0) return "No recent group messages logged yet.";
      return msgs.map((m) => `${m.senderName ?? "?"}: ${m.text}`).join("\n");
    }

    default:
      return `Error: unknown tool "${name}".`;
  }
}

/** Server-enforced edit window: refuses outright once AI_EDIT_WINDOW_MS has
 *  elapsed since publication, no matter what the model is asked to do, and
 *  refuses multi-message albums since a partial caption edit across an
 *  album would be misleading. */
async function aiEditRecentPost(env: Env, ctx: Context, adminId: number, postId: number, newText: string): Promise<string> {
  const post = await getAiScheduledPost(env, postId);
  if (!post || post.created_by !== String(adminId)) return "Error: no such post found for you.";
  if (!post.last_posted_at || !post.posted_chat_id || !post.posted_message_ids) return "Error: this post has not been published yet.";
  if (!post.edit_locked_at || now() > post.edit_locked_at) return "Error: the edit window (2 minutes after publishing) has closed. This can no longer be changed.";
  const ids: number[] = JSON.parse(post.posted_message_ids);
  if (ids.length !== 1) return "Error: multi-file album posts cannot be edited — only single-message posts.";
  try {
    await ctx.api.editMessageCaption(post.posted_chat_id, ids[0], { caption: newText });
  } catch {
    try {
      await ctx.api.editMessageText(post.posted_chat_id, ids[0], newText);
    } catch {
      return "Error: Telegram refused the edit (it may have no caption/text to edit).";
    }
  }
  await logAiActivity(env, "post_edited", `post #${postId}`, post.channel_id);
  return "Edited successfully.";
}

async function sendAiProposalMessage(
  ctx: Context,
  env: Env,
  lang: Lang,
  postId: number,
  channel: ChannelRow,
  summary: string,
  scheduleType: "once" | "daily" | "weekly",
  timeOfDay: string | null,
  dayOfWeek: number | null
) {
  const scheduleText =
    scheduleType === "once"
      ? t(lang, "ai_schedule_once", { time: timeOfDay ?? "-" })
      : scheduleType === "daily"
        ? t(lang, "ai_schedule_daily", { time: timeOfDay ?? "-" })
        : t(lang, "ai_schedule_weekly", { day: String(dayOfWeek ?? 0), time: timeOfDay ?? "-" });

  const kb = new InlineKeyboard()
    .text(t(lang, "btn_ai_confirm"), `aiart:confirm:${postId}`)
    .text(t(lang, "btn_ai_reject"), `aiart:reject:${postId}`);

  await ctx.reply(
    `${t(lang, "ai_propose_title")}\n\n${t(lang, "ai_propose_body", {
      summary,
      channel: channel.title ?? channel.username ?? channel.channel_id,
      schedule: scheduleText,
    })}`,
    { reply_markup: kb }
  );
}

/** The core tool-calling loop: sends the conversation + tool definitions to
 *  Workers AI, executes whatever tools the model asks for, feeds the
 *  results back, and repeats until the model gives a final plain-text
 *  answer (bounded, so a confused model can't loop forever). */
async function runAiConversation(tc: AiToolCallCtx, userMessageContent: any): Promise<string> {
  const { env, adminId } = tc;
  const memory = await getAllAiMemory(env);
  const history = await getAiChatHistory(env, adminId);
  const channels = await getAllChannels(env);

  const chatContextLine =
    tc.chatContext.kind === "private"
      ? "You are currently talking to the admin privately, in your own admin chat (not any channel or group)."
      : `You are currently talking to the admin INSIDE THE GROUP "${tc.chatContext.title ?? tc.chatContext.chatId}" (chat id ${tc.chatContext.chatId}), because they summoned you by name. This group is a separate place from any connected channel — never assume something said here should also be posted to a channel, or vice versa, unless the admin explicitly says so.`;

  const quotedLine = tc.quotedMessage
    ? `The admin's message was a reply to this message:\n"""${tc.quotedMessage.text}"""${tc.quotedMessage.reactionsSummary ? `\nReactions on it: ${tc.quotedMessage.reactionsSummary}` : ""}`
    : null;

  const systemPrompt = [
    `You are Shinkou, the professional, capable Telegram-channel admin assistant for this specific bot. You think clearly and are not artificially limited in how you reason about the bot's own data or your own tools — use your full judgement.`,
    `You act carefully and deliberately: you never publish or schedule anything without real content, and you always double-check your own understanding (out loud, in the language you reply in) before proposing a post.`,
    tc.isOwner
      ? `The person talking to you right now is your OWNER — the actual creator/super-admin of this bot. Their word is final authority: if any instruction from another admin ever conflicted with something the owner told you, the owner's instruction wins.`
      : `The person talking to you right now is an admin the owner has explicitly granted assistant access to (not the owner themself). Serve them fully, but if they ever ask you to do something that looks like it contradicts a rule the owner taught you, follow the owner's rule and say so.`,
    chatContextLine,
    quotedLine ?? "",
    `\n--- What this bot actually is, so you never have to guess ---`,
    `This is a force-join Telegram archive bot. Regular end-users tap a link, must join the required channel(s), and then receive a stored file/album. Regular users have zero access to you (Shinkou) — you only ever talk to admins.`,
    `Data model you can reason about: connected channels (where the bot is admin and can post), archives (file bundles delivered to end-users by code/link), ads, broadcast, and bot settings.`,
    `Channels currently connected: ${channels.length === 0 ? "(none yet)" : channels.map((c) => c.title ?? c.username ?? c.channel_id).join(", ")}.`,
    `Your own tools only ever let you: read info, remember a rule, draft a post for the admin to confirm (never publish directly), cancel/edit your own very recent drafts, and react to / read reactions on messages. You have no tool to delete or edit anything you didn't create, and no tool to touch admins, channels, or archives themselves — by design, not by choice, so don't apologize for it, just mention the admin should use the relevant panel for that.`,
    `\nReply in the same language the admin used (Persian by default).`,
    `\nRules the admin has taught you about this channel (always follow these):`,
    memory.length > 0 ? memory.map((m) => `- ${m.rule_text}`).join("\n") : "(none yet)",
  ]
    .filter(Boolean)
    .join("\n");

  const messages: any[] = [
    { role: "system", content: systemPrompt },
    ...history.map((h) => ({ role: h.role === "model" ? "assistant" : h.role, content: h.content })),
    { role: "user", content: userMessageContent },
  ];

  await appendAiChatHistory(env, adminId, "user", typeof userMessageContent === "string" ? userMessageContent : "[content]");

  let finalText = "";
  for (let round = 0; round < 4; round++) {
    let result: any;
    try {
      result = await env.AI.run(AI_MODEL, { messages, tools: AI_TOOLS as any, max_tokens: 700 });
    } catch {
      finalText = t(tc.lang, "ai_error_generic");
      break;
    }
    const toolCalls = result?.tool_calls;
    if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
      messages.push({ role: "assistant", content: result.response ?? "", tool_calls: toolCalls });
      for (const call of toolCalls) {
        const fnName = String(call.name ?? call.function?.name ?? "unknown");
        const rawArgs = call.arguments ?? call.function?.arguments;
        const fnArgs = safeParseToolArgs(rawArgs);
        let toolResult: string;
        try {
          toolResult = await executeAiTool(tc, fnName, fnArgs);
        } catch {
          toolResult = `Error: tool "${fnName}" failed unexpectedly.`;
        }
        messages.push({ role: "tool", content: toolResult, name: fnName });
      }
      continue;
    }
    finalText = result?.response ?? "";
    break;
  }

  if (!finalText) finalText = t(tc.lang, "ai_error_generic");
  await appendAiChatHistory(env, adminId, "model", finalText);
  return finalText;
}

// =========================================================================
// AI assistant — control panel (super-admin / "ai"-permitted admins only)
// =========================================================================

async function renderAiControlPanel(ctx: Context, env: Env, lang: Lang, edit: boolean) {
  const masterOn = await isAiMasterEnabled(env);
  const autopostOn = await isAiAutopostEnabled(env);
  const kb = new InlineKeyboard()
    .text(t(lang, "btn_ai_toggle_master"), "aictrl:togglemaster").row()
    .text(t(lang, "btn_ai_toggle_autopost"), "aictrl:toggleautopost").row()
    .text(t(lang, "btn_ai_scheduled_list"), "aictrl:sched:0").row()
    .text(t(lang, "btn_ai_activity_log"), "aictrl:activity:0").row()
    .text(t(lang, "btn_ai_memory"), "aictrl:memory:0").row()
    .text(t(lang, "btn_close"), "nav:close");

  const body = t(lang, "ai_control_body", {
    master: masterOn ? t(lang, "ai_master_on") : t(lang, "ai_master_off"),
    autopost: autopostOn ? t(lang, "ai_master_on") : t(lang, "ai_master_off"),
  });
  const full = `${t(lang, "ai_control_title")}\n\n${body}`;
  if (edit) await ctx.editMessageText(full, { reply_markup: kb });
  else await ctx.reply(full, { reply_markup: kb });
}

async function sendAiControlPanel(ctx: Context, env: Env, lang: Lang) {
  await renderAiControlPanel(ctx, env, lang, false);
}

function scheduleTextFor(lang: Lang, post: AiScheduledPostRow): string {
  if (post.schedule_type === "once") return t(lang, "ai_schedule_once", { time: post.time_of_day ?? "-" });
  if (post.schedule_type === "daily") return t(lang, "ai_schedule_daily", { time: post.time_of_day ?? "-" });
  return t(lang, "ai_schedule_weekly", { day: String(post.day_of_week ?? 0), time: post.time_of_day ?? "-" });
}

async function renderAiScheduledListWindow(ctx: Context, env: Env, lang: Lang, page: number, edit: boolean) {
  const all = await listActiveAiScheduledPosts(env);
  if (all.length === 0) {
    const kb = new InlineKeyboard().text(t(lang, "btn_back"), "aictrl:backtopanel");
    if (edit) await ctx.editMessageText(t(lang, "ai_no_scheduled"), { reply_markup: kb });
    else await ctx.reply(t(lang, "ai_no_scheduled"), { reply_markup: kb });
    return;
  }

  const totalPages = Math.max(1, Math.ceil(all.length / AI_SCHEDULED_PAGE_SIZE));
  const p = Math.min(Math.max(page, 0), totalPages - 1);
  const slice = all.slice(p * AI_SCHEDULED_PAGE_SIZE, p * AI_SCHEDULED_PAGE_SIZE + AI_SCHEDULED_PAGE_SIZE);

  const kb = new InlineKeyboard();
  for (const post of slice) {
    const channel = await getChannelById(env, post.channel_id);
    const label = t(lang, "ai_scheduled_line", {
      channel: channel?.title ?? channel?.username ?? channel?.channel_id ?? "?",
      schedule: scheduleTextFor(lang, post),
    });
    kb.text(`🗑 ${label}`.slice(0, 64), `aictrl:cancelsched:${post.id}`).row();
  }
  if (totalPages > 1) {
    kb.text("«", `aictrl:sched:${Math.max(0, p - 1)}`)
      .text(`${p + 1}/${totalPages}`, `aictrl:sched:${p}`)
      .text("»", `aictrl:sched:${Math.min(totalPages - 1, p + 1)}`)
      .row();
  }
  kb.text(t(lang, "btn_back"), "aictrl:backtopanel");

  const text = t(lang, "ai_scheduled_list_title", { count: all.length });
  if (edit) await ctx.editMessageText(text, { reply_markup: kb });
  else await ctx.reply(text, { reply_markup: kb });
}

async function renderAiActivityWindow(ctx: Context, env: Env, lang: Lang, page: number, edit: boolean) {
  const total = await countAiActivity(env);
  if (total === 0) {
    const kb = new InlineKeyboard().text(t(lang, "btn_back"), "aictrl:backtopanel");
    if (edit) await ctx.editMessageText(t(lang, "ai_no_activity"), { reply_markup: kb });
    else await ctx.reply(t(lang, "ai_no_activity"), { reply_markup: kb });
    return;
  }

  const totalPages = Math.max(1, Math.ceil(total / AI_ACTIVITY_PAGE_SIZE));
  const p = Math.min(Math.max(page, 0), totalPages - 1);
  const items = await listAiActivity(env, AI_ACTIVITY_PAGE_SIZE, p * AI_ACTIVITY_PAGE_SIZE);
  const lines = items.map((it) => {
    const d = new Date(it.created_at).toISOString().slice(0, 16).replace("T", " ");
    return `• [${it.action_type}] ${it.detail} — ${d}`;
  });

  const kb = new InlineKeyboard();
  if (totalPages > 1) {
    kb.text("«", `aictrl:activity:${Math.max(0, p - 1)}`)
      .text(`${p + 1}/${totalPages}`, `aictrl:activity:${p}`)
      .text("»", `aictrl:activity:${Math.min(totalPages - 1, p + 1)}`)
      .row();
  }
  kb.text(t(lang, "btn_back"), "aictrl:backtopanel");

  const text = `${t(lang, "ai_activity_list_title", { count: total })}\n\n${lines.join("\n")}`;
  if (edit) await ctx.editMessageText(text, { reply_markup: kb });
  else await ctx.reply(text, { reply_markup: kb });
}

const AI_MEMORY_PAGE_SIZE = 8;

async function renderAiMemoryWindow(ctx: Context, env: Env, lang: Lang, page: number, edit: boolean) {
  const rules = await getAllAiMemory(env);
  if (rules.length === 0) {
    const kb = new InlineKeyboard().text(t(lang, "btn_back"), "aictrl:backtopanel");
    if (edit) await ctx.editMessageText(t(lang, "ai_no_memory"), { reply_markup: kb });
    else await ctx.reply(t(lang, "ai_no_memory"), { reply_markup: kb });
    return;
  }

  const totalPages = Math.max(1, Math.ceil(rules.length / AI_MEMORY_PAGE_SIZE));
  const p = Math.min(Math.max(page, 0), totalPages - 1);
  const slice = rules.slice(p * AI_MEMORY_PAGE_SIZE, p * AI_MEMORY_PAGE_SIZE + AI_MEMORY_PAGE_SIZE);

  const kb = new InlineKeyboard();
  for (const r of slice) {
    kb.text(`🗑 ${r.rule_text}`.slice(0, 64), `aictrl:delrule:${r.id}`).row();
  }
  if (totalPages > 1) {
    kb.text("«", `aictrl:memory:${Math.max(0, p - 1)}`)
      .text(`${p + 1}/${totalPages}`, `aictrl:memory:${p}`)
      .text("»", `aictrl:memory:${Math.min(totalPages - 1, p + 1)}`)
      .row();
  }
  kb.text(t(lang, "btn_ai_clear_memory"), "aictrl:clearmemconfirm").row();
  kb.text(t(lang, "btn_back"), "aictrl:backtopanel");

  const text = t(lang, "ai_memory_list_title", { count: rules.length });
  if (edit) await ctx.editMessageText(text, { reply_markup: kb });
  else await ctx.reply(text, { reply_markup: kb });
}

async function handleAiCtrlCallback(ctx: Context, env: Env, userId: number, lang: Lang, rest: string[]) {
  const action = rest[0];

  if (action === "backtopanel") {
    await ctx.answerCallbackQuery();
    await renderAiControlPanel(ctx, env, lang, true);
    return;
  }

  if (action === "togglemaster") {
    await setAiMasterEnabled(env, !(await isAiMasterEnabled(env)));
    await ctx.answerCallbackQuery({ text: t(lang, "ai_master_toggled") });
    await renderAiControlPanel(ctx, env, lang, true);
    return;
  }

  if (action === "toggleautopost") {
    await setAiAutopostEnabled(env, !(await isAiAutopostEnabled(env)));
    await ctx.answerCallbackQuery({ text: t(lang, "ai_autopost_toggled") });
    await renderAiControlPanel(ctx, env, lang, true);
    return;
  }

  if (action === "sched") {
    const page = parseInt(rest[1] ?? "0", 10);
    await ctx.answerCallbackQuery();
    await renderAiScheduledListWindow(ctx, env, lang, page, true);
    return;
  }

  if (action === "cancelsched") {
    const id = parseInt(rest[1], 10);
    const post = await getAiScheduledPost(env, id);
    await cancelAiScheduledPost(env, id);
    await logAiActivity(env, "schedule_cancelled", `post #${id} cancelled from control panel`, post?.channel_id);
    await ctx.answerCallbackQuery({ text: t(lang, "ai_scheduled_cancelled") });
    await renderAiScheduledListWindow(ctx, env, lang, 0, true);
    return;
  }

  if (action === "activity") {
    const page = parseInt(rest[1] ?? "0", 10);
    await ctx.answerCallbackQuery();
    await renderAiActivityWindow(ctx, env, lang, page, true);
    return;
  }

  if (action === "memory") {
    const page = parseInt(rest[1] ?? "0", 10);
    await ctx.answerCallbackQuery();
    await renderAiMemoryWindow(ctx, env, lang, page, true);
    return;
  }

  if (action === "delrule") {
    const id = parseInt(rest[1], 10);
    await deleteAiMemory(env, id);
    await ctx.answerCallbackQuery({ text: t(lang, "ai_memory_deleted") });
    await renderAiMemoryWindow(ctx, env, lang, 0, true);
    return;
  }

  if (action === "clearmemconfirm") {
    await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard()
      .text(t(lang, "btn_yes_delete"), "aictrl:clearmemok")
      .text(t(lang, "btn_no"), "aictrl:memory:0");
    await ctx.editMessageText(t(lang, "ai_clear_memory_confirm"), { reply_markup: kb });
    return;
  }

  if (action === "clearmemok") {
    await clearAllAiMemory(env);
    await ctx.answerCallbackQuery({ text: t(lang, "ai_memory_cleared") });
    await renderAiMemoryWindow(ctx, env, lang, 0, true);
    return;
  }
}

/** Handles the Confirm/Reject buttons on a single post proposal. Confirming
 *  only flips it to 'active' so the cron picks it up at its scheduled
 *  time — nothing is ever published directly from this callback. */
async function handleAiProposalCallback(ctx: Context, env: Env, lang: Lang, rest: string[]) {
  const action = rest[0];
  const postId = parseInt(rest[1], 10);
  const post = await getAiScheduledPost(env, postId);
  if (!post) {
    await ctx.answerCallbackQuery();
    return;
  }

  if (action === "confirm") {
    await confirmAiScheduledPost(env, postId);
    await logAiActivity(env, "post_scheduled", `post #${postId} confirmed by admin`, post.channel_id);
    await ctx.answerCallbackQuery({ text: t(lang, "ai_proposal_confirmed") });
    await ctx.editMessageText(t(lang, "ai_proposal_confirmed"));
    return;
  }

  if (action === "reject") {
    await rejectAiScheduledPost(env, postId);
    await ctx.answerCallbackQuery({ text: t(lang, "ai_proposal_rejected") });
    await ctx.editMessageText(t(lang, "ai_proposal_rejected"));
    return;
  }
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
    await upsertUser(env, userId, ctx.from?.username, ctx.from?.first_name, ctx.from?.last_name);
    const payload = ctx.match?.toString().trim() ?? "";
    const rawLang = await getRawUserLang(env, userId);

    if (rawLang === null) {
      const kb = new InlineKeyboard()
        .text("🇮🇷 فارسی", `pickstartlang:fa:${payload}`)
        .text("🇬🇧 English", `pickstartlang:en:${payload}`);
      await ctx.reply(t(DEFAULT_LANG, "choose_language_prompt"), { reply_markup: kb });
      return;
    }

    await performStart(ctx, env, userId, rawLang, payload);
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

  // ----- aggregated reaction counts (anonymous — no per-user identity) -----
  bot.on("message_reaction_count", async (ctx) => {
    try {
      const upd: any = (ctx as any).messageReactionCount ?? (ctx.update as any).message_reaction_count;
      if (!upd) return;
      const reactions = (upd.reactions ?? []).map((r: any) => ({
        emoji: r.type?.emoji ?? r.type?.custom_emoji_id ?? "?",
        count: r.total_count ?? 0,
      }));
      await upsertMessageReactionCounts(env, String(upd.chat.id), upd.message_id, reactions);
    } catch {
      /* best-effort only — never let this break the bot */
    }
  });

  // ----- messages -----
  bot.on("message", async (ctx) => {
    const userId = ctx.from?.id;
    const chatType = ctx.chat.type;
    if (!userId) return;

    if (chatType === "group" || chatType === "supergroup") {
      const admin = await isAdmin(env, userId);
      if (admin) {
        await handleGroupAdminMessage(ctx, env, userId);
        return; // admins are always exempt from the group force-join gate
      }
      await handleGroupMessage(ctx, env);
      return;
    }

    if (chatType !== "private") return;

    await upsertUser(env, userId, ctx.from?.username, ctx.from?.first_name, ctx.from?.last_name);
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
  const adminInfo = await getAdminInfo(env, userId);
  if (!adminInfo) return false;
  const can = (key: PermissionKey) => adminInfo.isSuper || adminInfo.permissions[key];

  // ---- top-level reply-keyboard buttons ----
  if (text) {
    if (matchAnyLang(text, "btn_upload")) {
      if (!can("upload")) {
        await ctx.reply(t(lang, "no_permission"));
        return true;
      }
      await startUploadFlow(ctx, env, userId, lang);
      return true;
    }
    if (matchAnyLang(text, "btn_channels")) {
      if (!can("channels")) {
        await ctx.reply(t(lang, "no_permission"));
        return true;
      }
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
      if (!can("broadcast")) {
        await ctx.reply(t(lang, "no_permission"));
        return true;
      }
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
    if (matchAnyLang(text, "btn_ads")) {
      if (!can("ads")) {
        await ctx.reply(t(lang, "no_permission"));
        return true;
      }
      await sendAdsPanel(ctx, env, lang);
      return true;
    }
    if (matchAnyLang(text, "btn_admin_mgmt")) {
      if (!adminInfo.isSuper) {
        await ctx.reply(t(lang, "super_only_notice"));
        return true;
      }
      await sendAdminMgmtPanel(ctx, env, lang);
      return true;
    }
    if (matchAnyLang(text, "btn_ai_assistant")) {
      if (!can("ai")) {
        await ctx.reply(t(lang, "no_permission"));
        return true;
      }
      if (!(await isAiMasterEnabled(env))) {
        await ctx.reply(t(lang, "ai_disabled_notice"));
        return true;
      }
      await ctx.reply(t(lang, "ai_chat_welcome"), {
        reply_markup: new InlineKeyboard().text(t(lang, "btn_ai_chat_exit"), "nav:close"),
      });
      return true;
    }
    if (matchAnyLang(text, "btn_ai_control")) {
      if (!can("ai")) {
        await ctx.reply(t(lang, "no_permission"));
        return true;
      }
      await sendAiControlPanel(ctx, env, lang);
      return true;
    }
  }

  // ---- editing an ad: accepts a photo+caption OR a text-only message ----
  const adState = await getAdminState(env, userId);
  if (adState && adState.state === "editing_ad") {
    const targetLang = (adState.context.lang as Lang) ?? "fa";
    const file = ctx.message ? detectFile(ctx.message) : null;
    if (file && file.file_type === "photo") {
      const entities = (ctx.message as any)?.caption_entities ?? [];
      await setAd(env, targetLang, file.file_id, "photo", file.caption ?? null, entities);
      await clearAdminState(env, userId);
      await ctx.reply(t(lang, "ad_updated_ok"));
      return true;
    }
    if (text) {
      const entities = (ctx.message as any)?.entities ?? [];
      await setAd(env, targetLang, null, null, text, entities);
      await clearAdminState(env, userId);
      await ctx.reply(t(lang, "ad_updated_ok"));
      return true;
    }
    await ctx.reply(t(lang, "edit_ad_prompt"));
    return true;
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
        await setAdminState(env, userId, "awaiting_description_fa", { sessionId, title: text });
        await ctx.reply(t(lang, "upload_ask_description_fa", { title: text }), {
          reply_markup: new InlineKeyboard()
            .text(t(lang, "btn_skip"), `up:skipdescfa:${sessionId}`)
            .text(t(lang, "btn_cancel"), `up:cancel:${sessionId}`),
        });
        return true;
      }
      case "awaiting_description_fa": {
        const sessionId = state.context.sessionId as number;
        const title = state.context.title as string;
        const descriptionFa = normalizeDescriptionInput(text);
        await setAdminState(env, userId, "awaiting_description_en", { sessionId, title, descriptionFa });
        await ctx.reply(t(lang, "upload_ask_description_en"), {
          reply_markup: new InlineKeyboard()
            .text(t(lang, "btn_skip"), `up:skipdescen:${sessionId}`)
            .text(t(lang, "btn_cancel"), `up:cancel:${sessionId}`),
        });
        return true;
      }
      case "awaiting_description_en": {
        const sessionId = state.context.sessionId as number;
        const title = state.context.title as string;
        const descriptionFa = (state.context.descriptionFa as string | null) ?? null;
        const descriptionEn = normalizeDescriptionInput(text);
        await proceedToChannelSelection(ctx, env, userId, lang, sessionId, title, descriptionFa, descriptionEn);
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
      case "editing_archive_desc_fa": {
        const archiveId = state.context.archiveId as number;
        const desc = text === "-" ? null : text;
        await env.DB.prepare("UPDATE archives SET description = ?, updated_at = ? WHERE id = ?").bind(desc, now(), archiveId).run();
        await clearAdminState(env, userId);
        await ctx.reply(t(lang, "desc_fa_updated"));
        await sendArchiveDetailWindow(ctx, env, lang, archiveId, undefined);
        return true;
      }
      case "editing_archive_desc_en": {
        const archiveId = state.context.archiveId as number;
        const desc = text === "-" ? null : text;
        await env.DB.prepare("UPDATE archives SET description_en = ?, updated_at = ? WHERE id = ?").bind(desc, now(), archiveId).run();
        await clearAdminState(env, userId);
        await ctx.reply(t(lang, "desc_en_updated"));
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
      case "awaiting_admin_id": {
        if (!adminInfo.isSuper) {
          await clearAdminState(env, userId);
          return true;
        }
        const newId = text.trim();
        if (!/^\d+$/.test(newId)) {
          await ctx.reply(t(lang, "add_admin_invalid"));
          return true;
        }
        const existing = await isAdmin(env, parseInt(newId, 10));
        if (existing) {
          await ctx.reply(t(lang, "add_admin_already"));
          await clearAdminState(env, userId);
          return true;
        }
        await addAdmin(env, newId);
        await clearAdminState(env, userId);
        await ctx.reply(t(lang, "add_admin_ok", { id: newId }));
        await renderAdminDetail(ctx, env, lang, newId, false);
        return true;
      }
    }
  }

  // ---- editing files of an existing archive: any file sent gets appended ----
  if (state && state.state === "editing_archive_files") {
    const file = ctx.message ? detectFile(ctx.message) : null;
    if (file) {
      const archiveId = state.context.archiveId as number;
      const res = await env.DB.prepare(
        `INSERT INTO files (archive_id, file_id, file_unique_id, file_type, file_name, caption, order_index, created_at)
         VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(order_index), 0) + 1 FROM files WHERE archive_id = ?), ?)`
      ).bind(archiveId, file.file_id, file.file_unique_id, file.file_type, file.file_name, file.caption, archiveId, now()).run();
      const row = await env.DB.prepare("SELECT order_index FROM files WHERE id = ?")
        .bind(res.meta.last_row_id).first<{ order_index: number }>();
      await ctx.reply(t(lang, "file_added_to_archive", { count: row?.order_index ?? 1 }));
      return true;
    }
  }

  // ---- AI assistant fallback: any file or text message not claimed by any
  // of the flows above (button, active session, or one-shot conversation
  // state) is handed to the AI assistant — this is what makes "just send it
  // a message/photo, no special mode needed" work. Skipped entirely while
  // the admin is mid another flow (e.g. an unfinished upload session, or an
  // unrecognized/stale conversation state) so the AI never talks over an
  // in-progress action. ----
  if (can("ai") && !session && !state) {
    if (!(await isAiMasterEnabled(env))) {
      if (text) {
        await ctx.reply(t(lang, "ai_disabled_notice"));
        return true;
      }
      return false;
    }

    const file = ctx.message ? detectFile(ctx.message) : null;
    if (file) {
      const sessionId = await getOrStartAiContentSession(env, userId);
      let visionDescription: string | null = null;
      if (file.file_type === "photo") {
        const dataUri = await telegramFileToDataUri(env, ctx, file.file_id);
        if (dataUri) visionDescription = await analyzeImageForAi(env, dataUri);
      }
      const position = await addFileToAiContentSession(env, sessionId, file, visionDescription);
      const base = t(lang, "ai_file_received", { count: position, type: file.file_type });
      await ctx.reply(visionDescription ? `${base}\n\n👁 ${visionDescription}` : base);
      return true;
    }

    if (text) {
      const thinking = await ctx.reply(t(lang, "ai_thinking"));
      const chatIdStr = String(ctx.chat!.id);
      const quotedMessage = await buildQuotedMessageContext(ctx, env, chatIdStr);
      let reply: string;
      try {
        reply = await runAiConversation(
          {
            env,
            ctx,
            adminId: userId,
            lang,
            isOwner: adminInfo.isSuper,
            chatContext: { kind: "private" },
            quotedMessage,
            triggerChatId: chatIdStr,
            triggerMessageId: ctx.message!.message_id,
          },
          text
        );
      } catch {
        reply = t(lang, "ai_error_generic");
      }
      try {
        await ctx.api.deleteMessage(ctx.chat!.id, thinking.message_id);
      } catch {
        /* ignore */
      }
      await ctx.reply(reply);
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

async function persistPendingArchiveMeta(env: Env, sessionId: number, title: string, descriptionFa: string | null, descriptionEn: string | null) {
  await env.DB.prepare(
    "UPDATE upload_sessions SET pending_title = ?, pending_description = ?, pending_description_en = ?, selected_channels = '[]', updated_at = ? WHERE id = ?"
  ).bind(title, descriptionFa, descriptionEn, now(), sessionId).run();
}

async function getPendingArchiveMeta(env: Env, sessionId: number) {
  return env.DB.prepare(
    "SELECT pending_title, pending_description, pending_description_en, selected_channels FROM upload_sessions WHERE id = ? AND status = 'collecting'"
  ).bind(sessionId).first<{ pending_title: string | null; pending_description: string | null; pending_description_en: string | null; selected_channels: string | null }>();
}

function normalizeDescriptionInput(input: string): string | null {
  return input === "-" || matchAnyLang(input, "btn_skip") ? null : input;
}

async function proceedToChannelSelection(ctx: Context, env: Env, userId: number, lang: Lang, sessionId: number, title: string, descriptionFa: string | null, descriptionEn: string | null) {
  const channels = await getAllChannels(env);
  if (channels.length === 0) {
    await ctx.reply(t(lang, "upload_need_channels_first"));
    await clearAdminState(env, userId);
    return;
  }
  await persistPendingArchiveMeta(env, sessionId, title, descriptionFa, descriptionEn);
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

  // ----- first-time language picker (available to everyone) -----
  if (ns === "pickstartlang") {
    const [langStr, ...payloadParts] = rest;
    const payload = payloadParts.join(":");
    const newLang: Lang = langStr === "en" ? "en" : "fa";
    await setUserLang(env, userId, newLang);
    await ctx.answerCallbackQuery();
    try {
      await ctx.deleteMessage();
    } catch {
      /* ignore */
    }
    await performStart(ctx, env, userId, newLang, payload);
    return;
  }

  // Everything below is admin-only.
  const adminInfo = await getAdminInfo(env, userId);
  if (!adminInfo) {
    await ctx.answerCallbackQuery({ text: t(lang, "not_admin") });
    return;
  }
  const can = (key: PermissionKey) => adminInfo.isSuper || adminInfo.permissions[key];

  switch (ns) {
    case "chmgmt":
      if (!can("channels")) {
        await ctx.answerCallbackQuery({ text: t(lang, "no_permission") });
        return;
      }
      await handleChannelMgmtCallback(ctx, env, lang, rest);
      return;
    case "adsmgmt":
      if (!can("ads")) {
        await ctx.answerCallbackQuery({ text: t(lang, "no_permission") });
        return;
      }
      await handleAdsMgmtCallback(ctx, env, userId, lang, rest);
      return;
    case "adminmgmt":
      if (!adminInfo.isSuper) {
        await ctx.answerCallbackQuery({ text: t(lang, "super_only_notice") });
        return;
      }
      await handleAdminMgmtCallback(ctx, env, userId, lang, rest);
      return;
    case "arcmgmt":
      await handleArchiveMgmtCallback(ctx, env, userId, lang, rest, adminInfo);
      return;
    case "up":
      if (!can("upload")) {
        await ctx.answerCallbackQuery({ text: t(lang, "no_permission") });
        return;
      }
      await handleUploadCallback(ctx, env, userId, lang, rest);
      return;
    case "chsel":
    case "chconfirm":
      if (!can("upload")) {
        await ctx.answerCallbackQuery({ text: t(lang, "no_permission") });
        return;
      }
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
      await handleSettingsCallback(ctx, env, userId, lang, rest, adminInfo);
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
    case "aictrl":
      if (!can("ai")) {
        await ctx.answerCallbackQuery({ text: t(lang, "no_permission") });
        return;
      }
      await handleAiCtrlCallback(ctx, env, userId, lang, rest);
      return;
    case "aiart":
      if (!can("ai")) {
        await ctx.answerCallbackQuery({ text: t(lang, "no_permission") });
        return;
      }
      await handleAiProposalCallback(ctx, env, lang, rest);
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

  if (action === "skipdescfa") {
    const state = await getAdminState(env, userId);
    if (!state || state.state !== "awaiting_description_fa") {
      await ctx.answerCallbackQuery();
      return;
    }
    const title = state.context.title as string;
    await setAdminState(env, userId, "awaiting_description_en", { sessionId, title, descriptionFa: null });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(t(lang, "upload_ask_description_en"), {
      reply_markup: new InlineKeyboard()
        .text(t(lang, "btn_skip"), `up:skipdescen:${sessionId}`)
        .text(t(lang, "btn_cancel"), `up:cancel:${sessionId}`),
    });
    return;
  }

  if (action === "skipdescen") {
    const state = await getAdminState(env, userId);
    if (!state || state.state !== "awaiting_description_en") {
      await ctx.answerCallbackQuery();
      return;
    }
    const title = state.context.title as string;
    const descriptionFa = (state.context.descriptionFa as string | null) ?? null;
    await proceedToChannelSelectionFromCallback(ctx, env, userId, lang, sessionId, title, descriptionFa, null);
    return;
  }
}

async function proceedToChannelSelectionFromCallback(ctx: Context, env: Env, userId: number, lang: Lang, sessionId: number, title: string, descriptionFa: string | null, descriptionEn: string | null) {
  const channels = await getAllChannels(env);
  if (channels.length === 0) {
    await ctx.answerCallbackQuery({ text: t(lang, "upload_need_channels_first") });
    await clearAdminState(env, userId);
    return;
  }
  await persistPendingArchiveMeta(env, sessionId, title, descriptionFa, descriptionEn);
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
    const descriptionFa = meta.pending_description ?? null;
    const descriptionEn = meta.pending_description_en ?? null;
    const fileCount = (await getSessionFiles(env, sessionId)).length;
    const code = await finalizeArchive(env, sessionId, title, descriptionFa, descriptionEn, selected);
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
    kb.text(`${mark} ${a.title} — 👁 ${a.views ?? 0}`, `arcmgmt:view:${a.id}`).row();
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
    .text(t(lang, "btn_edit_title"), `arcmgmt:edittitle:${archiveId}`).row()
    .text(t(lang, "btn_edit_desc_fa"), `arcmgmt:editdescfa:${archiveId}`)
    .text(t(lang, "btn_edit_desc_en"), `arcmgmt:editdescen:${archiveId}`).row()
    .text(t(lang, "btn_manage_files"), `arcmgmt:files:${archiveId}:0`).row()
    .text(t(lang, "btn_viewers"), `arcmgmt:viewers:${archiveId}:0`).row()
    .text(t(lang, "btn_toggle_active"), `arcmgmt:toggle:${archiveId}`).row()
    .text(t(lang, "btn_delete_archive"), `arcmgmt:del:${archiveId}`).row()
    .text(t(lang, "btn_back"), "arcmgmt:list:0");

  const text = t(lang, "archive_detail", {
    title: archive.title,
    status: archive.is_active ? t(lang, "archive_active") : t(lang, "archive_inactive"),
    description: archive.description ?? t(lang, "no_description"),
    description_en: archive.description_en ?? t(lang, "no_description"),
    file_count: files.length,
    views: archive.views ?? 0,
    code: archive.code,
    channels: channels.map((c) => c.title ?? c.username ?? c.channel_id).join(", ") || "-",
  });

  await ctx.reply(text, { reply_markup: kb });
}

async function handleArchiveMgmtCallback(ctx: Context, env: Env, userId: number, lang: Lang, rest: string[], adminInfo: AdminInfo) {
  const action = rest[0];
  const readOnlyActions = new Set(["list", "view", "viewers"]);
  const canManage = adminInfo.isSuper || adminInfo.permissions.archives_manage;
  if (!readOnlyActions.has(action) && !canManage) {
    await ctx.answerCallbackQuery({ text: t(lang, "no_permission") });
    return;
  }

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

  if (action === "editdescfa") {
    const archiveId = parseInt(rest[1], 10);
    await setAdminState(env, userId, "editing_archive_desc_fa", { archiveId });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(t(lang, "edit_desc_fa_prompt"), {
      reply_markup: new InlineKeyboard().text(t(lang, "btn_cancel"), `arcmgmt:canceledit:${archiveId}`),
    });
    return;
  }

  if (action === "editdescen") {
    const archiveId = parseInt(rest[1], 10);
    await setAdminState(env, userId, "editing_archive_desc_en", { archiveId });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(t(lang, "edit_desc_en_prompt"), {
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

  if (action === "viewers") {
    const archiveId = parseInt(rest[1], 10);
    const page = parseInt(rest[2] ?? "0", 10);
    await ctx.answerCallbackQuery();
    await renderViewersWindow(ctx, env, lang, archiveId, page, true);
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
    .text(t(lang, "btn_edit_title"), `arcmgmt:edittitle:${archiveId}`).row()
    .text(t(lang, "btn_edit_desc_fa"), `arcmgmt:editdescfa:${archiveId}`)
    .text(t(lang, "btn_edit_desc_en"), `arcmgmt:editdescen:${archiveId}`).row()
    .text(t(lang, "btn_manage_files"), `arcmgmt:files:${archiveId}`).row()
    .text(t(lang, "btn_viewers"), `arcmgmt:viewers:${archiveId}:0`).row()
    .text(t(lang, "btn_toggle_active"), `arcmgmt:toggle:${archiveId}`).row()
    .text(t(lang, "btn_delete_archive"), `arcmgmt:del:${archiveId}`).row()
    .text(t(lang, "btn_back"), "arcmgmt:list:0");

  const text = t(lang, "archive_detail", {
    title: archive.title,
    status: archive.is_active ? t(lang, "archive_active") : t(lang, "archive_inactive"),
    description: archive.description ?? t(lang, "no_description"),
    description_en: archive.description_en ?? t(lang, "no_description"),
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

// ---------- Viewer stats (per archive: who viewed it, how many times) ----------

const VIEWERS_PAGE_SIZE = 15;

async function renderViewersWindow(ctx: Context, env: Env, lang: Lang, archiveId: number, page: number, edit: boolean) {
  const archive = await getArchiveById(env, archiveId);
  if (!archive) return;

  const total = await countArchiveViewers(env, archive.code);
  const kb = new InlineKeyboard();

  if (total === 0) {
    kb.text(t(lang, "btn_back"), `arcmgmt:view:${archiveId}`);
    const text = `${t(lang, "viewers_title", { title: archive.title, count: 0 })}\n\n${t(lang, "no_viewers_yet")}`;
    if (edit) await ctx.editMessageText(text, { reply_markup: kb });
    else await ctx.reply(text, { reply_markup: kb });
    return;
  }

  const totalPages = Math.max(1, Math.ceil(total / VIEWERS_PAGE_SIZE));
  const p = Math.min(Math.max(page, 0), totalPages - 1);
  const viewers = await getArchiveViewers(env, archive.code, VIEWERS_PAGE_SIZE, p * VIEWERS_PAGE_SIZE);

  const lines = viewers.map((v, i) => {
    const fullName = [v.first_name, v.last_name].filter(Boolean).join(" ");
    const usernamePart = v.username ? `@${v.username}` : null;
    const name = [usernamePart, fullName].filter(Boolean).join(" — ") || t(lang, "no_username");
    return `${p * VIEWERS_PAGE_SIZE + i + 1}. ${name} — ID: ${v.telegram_id} — ${v.view_count}x`;
  });

  if (totalPages > 1) {
    kb.text("«", `arcmgmt:viewers:${archiveId}:${Math.max(0, p - 1)}`)
      .text(`${p + 1}/${totalPages}`, `arcmgmt:viewers:${archiveId}:${p}`)
      .text("»", `arcmgmt:viewers:${archiveId}:${Math.min(totalPages - 1, p + 1)}`)
      .row();
  }
  kb.text(t(lang, "btn_back"), `arcmgmt:view:${archiveId}`);

  const text = `${t(lang, "viewers_title", { title: archive.title, count: total })}\n\n${lines.join("\n")}`;
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

async function handleSettingsCallback(ctx: Context, env: Env, userId: number, lang: Lang, rest: string[], adminInfo: AdminInfo) {
  const action = rest[0];
  const autodelActions = new Set(["autodel", "setautodel", "customautodel"]);
  if (autodelActions.has(action) && !(adminInfo.isSuper || adminInfo.permissions.settings)) {
    await ctx.answerCallbackQuery({ text: t(lang, "no_permission") });
    return;
  }

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
      const info = await getAdminInfo(env, userId);
      if (info) {
        await ctx.reply(t(newLang as Lang, "welcome_admin"), { reply_markup: mainReplyKeyboard(newLang as Lang, info) });
      }
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
// Admin management (super-admin only): add/remove admins, grant/revoke
// per-section permissions to limited admins.
// =========================================================================

async function sendAdminMgmtPanel(ctx: Context, env: Env, lang: Lang) {
  const kb = new InlineKeyboard()
    .text(t(lang, "btn_add_admin"), "adminmgmt:addprompt").row()
    .text(t(lang, "btn_admin_list"), "adminmgmt:list:0").row()
    .text(t(lang, "btn_close"), "nav:close");
  await ctx.reply(t(lang, "admin_mgmt_panel_title"), { reply_markup: kb });
}

const PERMISSION_KEYS: PermissionKey[] = ["upload", "channels", "archives_manage", "ads", "broadcast", "settings", "ai"];

async function renderAdminDetail(ctx: Context, env: Env, lang: Lang, targetId: string, edit: boolean) {
  const info = await getAdminInfo(env, parseInt(targetId, 10));
  if (!info) return;

  const kb = new InlineKeyboard();
  if (!info.isSuper) {
    for (const key of PERMISSION_KEYS) {
      const mark = info.permissions[key] ? "✅" : "❌";
      kb.text(`${mark} ${t(lang, `perm_${key}` as TKey)}`, `adminmgmt:toggle:${key}:${targetId}`).row();
    }
    kb.text(t(lang, "btn_remove_admin"), `adminmgmt:del:${targetId}`).row();
  }
  kb.text(t(lang, "btn_back"), "adminmgmt:list:0");

  const text = t(lang, "admin_detail_title", {
    id: targetId,
    role: info.isSuper ? t(lang, "role_super") : t(lang, "role_regular"),
  });
  if (edit) await ctx.editMessageText(text, { reply_markup: kb });
  else await ctx.reply(text, { reply_markup: kb });
}

async function renderAdminList(ctx: Context, env: Env, lang: Lang, edit: boolean) {
  const admins = await listAdmins(env);
  const kb = new InlineKeyboard();
  for (const a of admins) {
    const mark = a.is_super ? "👑" : "🛡";
    kb.text(`${mark} ${a.telegram_id}`, `adminmgmt:view:${a.telegram_id}`).row();
  }
  kb.text(t(lang, "btn_back"), "adminmgmt:backtopanel");

  const text = admins.length === 0
    ? t(lang, "no_admins_yet")
    : t(lang, "admins_list_title", { count: admins.length });
  if (edit) await ctx.editMessageText(text, { reply_markup: kb });
  else await ctx.reply(text, { reply_markup: kb });
}

async function handleAdminMgmtCallback(ctx: Context, env: Env, userId: number, lang: Lang, rest: string[]) {
  const action = rest[0];

  if (action === "backtopanel") {
    await clearAdminState(env, userId);
    await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard()
      .text(t(lang, "btn_add_admin"), "adminmgmt:addprompt").row()
      .text(t(lang, "btn_admin_list"), "adminmgmt:list:0").row()
      .text(t(lang, "btn_close"), "nav:close");
    await ctx.editMessageText(t(lang, "admin_mgmt_panel_title"), { reply_markup: kb });
    return;
  }

  if (action === "addprompt") {
    await setAdminState(env, userId, "awaiting_admin_id", {});
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(t(lang, "add_admin_prompt"), {
      reply_markup: new InlineKeyboard().text(t(lang, "btn_cancel"), "adminmgmt:backtopanel"),
    });
    return;
  }

  if (action === "list") {
    await ctx.answerCallbackQuery();
    await renderAdminList(ctx, env, lang, true);
    return;
  }

  if (action === "view") {
    await ctx.answerCallbackQuery();
    await renderAdminDetail(ctx, env, lang, rest[1], true);
    return;
  }

  if (action === "toggle") {
    const key = rest[1] as PermissionKey;
    const targetId = rest[2];
    const info = await getAdminInfo(env, parseInt(targetId, 10));
    if (info?.isSuper) {
      await ctx.answerCallbackQuery();
      return;
    }
    await togglePermission(env, targetId, key);
    await ctx.answerCallbackQuery();
    await renderAdminDetail(ctx, env, lang, targetId, true);
    return;
  }

  if (action === "del") {
    const targetId = rest[1];
    const info = await getAdminInfo(env, parseInt(targetId, 10));
    if (info?.isSuper) {
      await ctx.answerCallbackQuery({ text: t(lang, "cannot_remove_super") });
      return;
    }
    await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard()
      .text(t(lang, "btn_yes_delete"), `adminmgmt:delok:${targetId}`)
      .text(t(lang, "btn_no"), `adminmgmt:view:${targetId}`);
    await ctx.editMessageText(t(lang, "remove_admin_confirm", { id: targetId }), { reply_markup: kb });
    return;
  }

  if (action === "delok") {
    const targetId = rest[1];
    const info = await getAdminInfo(env, parseInt(targetId, 10));
    if (info?.isSuper) {
      await ctx.answerCallbackQuery({ text: t(lang, "cannot_remove_super") });
      return;
    }
    await removeAdmin(env, targetId);
    await ctx.answerCallbackQuery({ text: t(lang, "remove_admin_ok") });
    await renderAdminList(ctx, env, lang, true);
    return;
  }
}

// =========================================================================
// Ads management (two fully separate fa/en windows)
// =========================================================================

async function sendAdsPanel(ctx: Context, env: Env, lang: Lang) {
  const kb = new InlineKeyboard()
    .text("🇮🇷 تبلیغ فارسی", "adsmgmt:view:fa").row()
    .text("🇬🇧 English Ad", "adsmgmt:view:en").row()
    .text(t(lang, "btn_close"), "nav:close");
  await ctx.reply(t(lang, "ads_panel_title"), { reply_markup: kb });
}

function adLangName(targetLang: Lang): string {
  return targetLang === "fa" ? "فارسی" : "English";
}

async function renderAdDetail(ctx: Context, env: Env, lang: Lang, targetLang: Lang, edit: boolean) {
  const ad = await getAd(env, targetLang);
  const hasPhoto = ad?.file_id ? t(lang, "has_photo_yes") : t(lang, "has_photo_no");
  const caption = ad?.caption ? ad.caption.slice(0, 300) : t(lang, "no_description");
  const kb = new InlineKeyboard()
    .text(t(lang, "btn_edit_ad"), `adsmgmt:edit:${targetLang}`).row()
    .text(t(lang, "btn_delete_ad"), `adsmgmt:del:${targetLang}`).row()
    .text(t(lang, "btn_broadcast_ad"), `adsmgmt:bcast:${targetLang}`).row()
    .text(t(lang, "btn_back"), "adsmgmt:backtopanel");

  const text = t(lang, "ad_detail", { lang_name: adLangName(targetLang), has_photo: hasPhoto, caption });
  if (edit) await ctx.editMessageText(text, { reply_markup: kb });
  else await ctx.reply(text, { reply_markup: kb });
}

async function handleAdsMgmtCallback(ctx: Context, env: Env, userId: number, lang: Lang, rest: string[]) {
  const action = rest[0];
  const targetLang: Lang = rest[1] === "en" ? "en" : "fa";

  if (action === "backtopanel") {
    await clearAdminState(env, userId);
    await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard()
      .text("🇮🇷 تبلیغ فارسی", "adsmgmt:view:fa").row()
      .text("🇬🇧 English Ad", "adsmgmt:view:en").row()
      .text(t(lang, "btn_close"), "nav:close");
    await ctx.editMessageText(t(lang, "ads_panel_title"), { reply_markup: kb });
    return;
  }

  if (action === "view") {
    await ctx.answerCallbackQuery();
    await renderAdDetail(ctx, env, lang, targetLang, true);
    return;
  }

  if (action === "edit") {
    await setAdminState(env, userId, "editing_ad", { lang: targetLang });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(t(lang, "edit_ad_prompt"), {
      reply_markup: new InlineKeyboard().text(t(lang, "btn_cancel"), `adsmgmt:view:${targetLang}`),
    });
    return;
  }

  if (action === "del") {
    await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard()
      .text(t(lang, "btn_yes_delete"), `adsmgmt:delok:${targetLang}`)
      .text(t(lang, "btn_no"), `adsmgmt:view:${targetLang}`);
    await ctx.editMessageText(t(lang, "ad_delete_confirm", { lang_name: adLangName(targetLang) }), { reply_markup: kb });
    return;
  }

  if (action === "delok") {
    await clearAd(env, targetLang);
    await ctx.answerCallbackQuery({ text: t(lang, "ad_deleted_ok") });
    await renderAdDetail(ctx, env, lang, targetLang, true);
    return;
  }

  if (action === "bcast") {
    await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard()
      .text(t(lang, "btn_confirm"), `adsmgmt:bcastok:${targetLang}`)
      .text(t(lang, "btn_cancel"), `adsmgmt:view:${targetLang}`);
    await ctx.editMessageText(t(lang, "ad_broadcast_confirm", { lang_name: adLangName(targetLang) }), { reply_markup: kb });
    return;
  }

  if (action === "bcastok") {
    await ctx.answerCallbackQuery();
    try {
      await ctx.deleteMessage();
    } catch {
      /* ignore */
    }
    await runAdBroadcast(ctx, env, lang, targetLang);
    return;
  }
}

async function runAdBroadcast(ctx: Context, env: Env, lang: Lang, targetLang: Lang) {
  const ad = await getAd(env, targetLang);
  if (!ad || (!ad.file_id && !ad.caption)) {
    await ctx.reply(t(lang, "no_ad_set"));
    return;
  }
  const entities = ad.entities ? JSON.parse(ad.entities) : undefined;
  const ids = await getUserIdsByLang(env, targetLang);
  const status = await ctx.reply(t(lang, "broadcast_sending", { count: ids.length }));

  let ok = 0;
  let fail = 0;
  const BATCH = 20;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(async (id) => {
        if (ad.file_id && ad.file_type) {
          const method = SEND_METHOD[ad.file_type] ?? "sendPhoto";
          const opts = ad.caption ? { caption: ad.caption, caption_entities: entities } : undefined;
          // @ts-ignore - dynamic method dispatch on the Bot API
          return ctx.api[method](id, ad.file_id, opts);
        }
        return ctx.api.sendMessage(id, ad.caption ?? "", { entities });
      })
    );
    for (const r of results) {
      if (r.status === "fulfilled") ok++;
      else fail++;
    }
  }

  await ctx.api.editMessageText(ctx.chat!.id, status.message_id, t(lang, "broadcast_done", { ok, fail }));
}

// =========================================================================
// Delivery / group gate (end users)
// =========================================================================

async function performStart(ctx: Context, env: Env, userId: number, lang: Lang, payload: string) {
  await logEvent(env, "start", userId, payload || undefined);

  if (payload) {
    await deliverArchive(ctx, env, userId, payload, lang);
    return;
  }

  await sendAdIfConfigured(ctx, env, lang);
  const adminInfo = await getAdminInfo(env, userId);
  if (adminInfo) {
    await ctx.reply(t(lang, "welcome_admin"), { reply_markup: mainReplyKeyboard(lang, adminInfo) });
  } else {
    await ctx.reply(t(lang, "welcome_user"));
  }
}

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

const VISUAL_GROUP_TYPES = new Set(["photo", "video"]);
const FILE_GROUP_TYPES = new Set(["document", "audio"]);

function mediaGroupBucket(fileType: string): "visual" | "filey" | "single" {
  if (VISUAL_GROUP_TYPES.has(fileType)) return "visual";
  if (FILE_GROUP_TYPES.has(fileType)) return "filey";
  return "single"; // voice, animation — not supported in sendMediaGroup
}

/** Sends a run of same-bucket files as one Telegram album (sendMediaGroup)
 *  when there are 2+ of them, preserving the exact upload order; falls
 *  back to individual sends for a single file or if the group call fails. */
async function flushMediaBatch(ctx: Context, env: Env, userId: number, chatId: number, archive: ArchiveRow, batch: FileRow[]) {
  if (batch.length === 0) return;

  if (batch.length === 1) {
    const sent = await sendStoredFile(ctx, chatId, batch[0]);
    if (sent && "message_id" in sent) {
      await trackSentMessage(env, userId, chatId, sent.message_id, archive.id, archive.delete_after_seconds);
    }
    return;
  }

  const media = batch.map((f) => ({
    type: f.file_type,
    media: f.file_id,
    caption: f.caption ?? undefined,
  }));

  try {
    // @ts-ignore - grammy's InputMedia union is stricter than our dynamic file_type
    const sentMessages = await ctx.api.sendMediaGroup(chatId, media);
    for (const sm of sentMessages) {
      await trackSentMessage(env, userId, chatId, sm.message_id, archive.id, archive.delete_after_seconds);
    }
  } catch {
    // fallback: same order, sent one by one
    for (const f of batch) {
      const sent = await sendStoredFile(ctx, chatId, f);
      if (sent && "message_id" in sent) {
        await trackSentMessage(env, userId, chatId, sent.message_id, archive.id, archive.delete_after_seconds);
      }
    }
  }
}

async function sendArchiveFiles(ctx: Context, env: Env, userId: number, archive: ArchiveRow) {
  const lang = await getUserLang(env, userId);
  const files = await getArchiveFiles(env, archive.id);
  if (files.length === 0) {
    await ctx.reply(t(lang, "archive_empty"));
    return;
  }

  const chatId = ctx.chat!.id;

  // 1) auto-delete warning — stays in chat, never auto-deleted itself
  if (archive.delete_after_seconds && archive.delete_after_seconds > 0) {
    await ctx.reply(t(lang, "auto_delete_notice", { seconds: archive.delete_after_seconds }));
  }

  // 2) the files themselves, in exact upload order, grouped into albums
  //    where Telegram allows it (photo+video together, document+audio
  //    together); only these tracked messages get auto-deleted
  let batch: FileRow[] = [];
  let batchBucket: "visual" | "filey" | null = null;
  for (const f of files) {
    const bucket = mediaGroupBucket(f.file_type);
    if (bucket === "single") {
      await flushMediaBatch(ctx, env, userId, chatId, archive, batch);
      batch = [];
      batchBucket = null;
      const sent = await sendStoredFile(ctx, chatId, f);
      if (sent && "message_id" in sent) {
        await trackSentMessage(env, userId, chatId, sent.message_id, archive.id, archive.delete_after_seconds);
      }
      continue;
    }
    if (batchBucket !== null && (batchBucket !== bucket || batch.length >= 10)) {
      await flushMediaBatch(ctx, env, userId, chatId, archive, batch);
      batch = [];
    }
    batchBucket = bucket;
    batch.push(f);
  }
  await flushMediaBatch(ctx, env, userId, chatId, archive, batch);

  // 3) the archive description, in the user's language — stays in chat
  const description = lang === "en" ? archive.description_en : archive.description;
  if (description) {
    await ctx.reply(description);
  }

  // 4) the promo ad, in the user's language, on every delivery — stays in chat
  await sendAdIfConfigured(ctx, env, lang);

  await incrementArchiveViews(env, archive.id);
  await logEvent(env, "archive_delivered", userId, archive.code);
}

/** Handles a message from an admin inside a group. Does absolutely nothing
 *  (costs zero AI quota) unless the message actually contains the "Shinkou"
 *  wake word and that admin has the "ai" permission and the master switch
 *  is on — this is what keeps ordinary group chatter from burning the
 *  free daily Workers AI quota. */
async function handleGroupAdminMessage(ctx: Context, env: Env, userId: number) {
  const text = ctx.message?.text ?? ctx.message?.caption;

  // Passive awareness log — happens regardless of whether Shinkou is being
  // summoned right now, so a later "catch me up" request sees everything.
  if (text && ctx.chat) {
    const from = ctx.from;
    const senderName = `${from?.first_name ?? ""} ${from?.last_name ?? ""}`.trim() || from?.username || null;
    await logGroupMessage(env, String(ctx.chat.id), ctx.message!.message_id, String(userId), senderName, text);
  }

  if (!text) return;
  const prompt = extractWakeWordPrompt(text);
  if (prompt === null) return; // wake word not present — stay silent, costs nothing

  const adminInfo = await getAdminInfo(env, userId);
  if (!adminInfo || !(adminInfo.isSuper || adminInfo.permissions.ai)) return;
  if (!(await isAiMasterEnabled(env))) return;
  if (!prompt) return; // wake word alone, no actual instruction — ignore rather than guess

  const chat = ctx.chat!;
  const chatIdStr = String(chat.id);
  const lang = await getUserLang(env, userId);

  // Best-effort acknowledgement react — failing silently is fine, since
  // reactions require the bot's webhook to actually subscribe to them.
  try {
    // @ts-ignore - reaction methods are newer than this project's pinned grammy types
    await ctx.api.setMessageReaction(chat.id, ctx.message!.message_id, [{ type: "emoji", emoji: "👀" }]);
  } catch {
    /* ignore */
  }

  const quotedMessage = await buildQuotedMessageContext(ctx, env, chatIdStr);

  let reply: string;
  try {
    reply = await runAiConversation(
      {
        env,
        ctx,
        adminId: userId,
        lang,
        isOwner: adminInfo.isSuper,
        chatContext: { kind: "group", chatId: chatIdStr, title: (chat as any).title ?? null },
        quotedMessage,
        triggerChatId: chatIdStr,
        triggerMessageId: ctx.message!.message_id,
      },
      prompt
    );
  } catch {
    reply = t(lang, "ai_error_generic");
  }

  try {
    await ctx.reply(reply, { reply_parameters: { message_id: ctx.message!.message_id } });
  } catch {
    await ctx.reply(reply);
  }
}

async function handleGroupMessage(ctx: Context, env: Env) {
  const userId = ctx.from?.id;
  const chat = ctx.chat;
  if (!userId || !chat) return;

  // Passive awareness log — read-only, never used to act on regular users.
  const text = (ctx.message as any)?.text ?? (ctx.message as any)?.caption ?? null;
  if (text) {
    const from = ctx.from;
    const senderName = `${from?.first_name ?? ""} ${from?.last_name ?? ""}`.trim() || from?.username || null;
    await logGroupMessage(env, String(chat.id), ctx.message!.message_id, String(userId), senderName, text);
  }

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
// AI assistant — publishing a due scheduled post (cron side, no ctx)
// =========================================================================

/** Sends one AI-created post to its channel, preserving the exact upload
 *  order and reusing the same album-grouping rules as archive delivery
 *  (mediaGroupBucket/SEND_METHOD above). Returns the chat id + every
 *  message id actually sent, so the caller can record them for the
 *  short self-edit window. */
async function publishAiScheduledPost(env: Env, bot: Bot, post: AiScheduledPostRow): Promise<{ chatId: string; messageIds: number[] } | null> {
  const channel = await getChannelById(env, post.channel_id);
  if (!channel) return null;
  const chatId = channel.channel_id;
  const files = post.content_session_id ? await getAiContentSessionFiles(env, post.content_session_id) : [];
  const messageIds: number[] = [];

  const sendSingle = async (f: AiContentFileRow, captionOverride?: string | null) => {
    const method = SEND_METHOD[f.file_type];
    if (!method) return;
    const caption = captionOverride ?? f.caption ?? undefined;
    // @ts-ignore - dynamic method dispatch on the Bot API
    const sent = await bot.api[method](chatId, f.file_id, caption ? { caption } : undefined);
    messageIds.push(sent.message_id);
  };

  if (files.length === 0) {
    if (!post.caption) return null;
    const sent = await bot.api.sendMessage(chatId, post.caption);
    messageIds.push(sent.message_id);
    return { chatId, messageIds };
  }

  if (files.length === 1) {
    await sendSingle(files[0], post.caption ?? files[0].caption);
    return messageIds.length > 0 ? { chatId, messageIds } : null;
  }

  // 2+ files: same visual/filey/single bucketing as archive delivery, so the
  // admin's original ordering and album grouping is always preserved.
  let batch: AiContentFileRow[] = [];
  let batchBucket: "visual" | "filey" | null = null;
  let captionUsed = false;

  const flush = async () => {
    if (batch.length === 0) return;
    if (batch.length === 1) {
      await sendSingle(batch[0], !captionUsed ? post.caption ?? batch[0].caption : batch[0].caption);
      captionUsed = true;
      batch = [];
      return;
    }
    const media = batch.map((f) => {
      const caption = !captionUsed ? post.caption ?? f.caption ?? undefined : f.caption ?? undefined;
      if (!captionUsed) captionUsed = true;
      return { type: f.file_type, media: f.file_id, caption };
    });
    try {
      // @ts-ignore - grammy's InputMedia union is stricter than our dynamic file_type
      const sentMessages = await bot.api.sendMediaGroup(chatId, media);
      for (const sm of sentMessages) messageIds.push(sm.message_id);
    } catch {
      for (const f of batch) await sendSingle(f);
    }
    batch = [];
  };

  for (const f of files) {
    const bucket = mediaGroupBucket(f.file_type);
    if (bucket === "single") {
      await flush();
      await sendSingle(f, !captionUsed ? post.caption ?? f.caption : f.caption);
      captionUsed = true;
      continue;
    }
    if (batchBucket !== null && (batchBucket !== bucket || batch.length >= 10)) await flush();
    batchBucket = bucket;
    batch.push(f);
  }
  await flush();

  return messageIds.length > 0 ? { chatId, messageIds } : null;
}

/** Cron entry point for AI posts — mirrors runDueDeletions. Does nothing at
 *  all while the master switch or the auto-post switch is off, and never
 *  touches anything except posts the admin already confirmed. */
async function runDueAiPosts(env: Env, bot: Bot): Promise<void> {
  if (!(await isAiMasterEnabled(env))) return;
  if (!(await isAiAutopostEnabled(env))) return;

  const due = await findDueAiScheduledPosts(env);
  for (const post of due) {
    try {
      const result = await publishAiScheduledPost(env, bot, post);
      if (!result) continue;
      await afterAiPostPublished(env, post, result.chatId, result.messageIds);
      await logAiActivity(env, "post_published", `post #${post.id} published`, post.channel_id);
    } catch {
      // one failing post must never block the rest of the due queue
    }
  }
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
    ctx.waitUntil(runDueAiPosts(env, bot));
  },
};
