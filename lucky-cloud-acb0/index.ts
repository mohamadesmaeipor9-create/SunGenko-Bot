/**
 * SunGenko Force-Join + Archive (file-store) Bot
 * Built with grammy, running on Cloudflare Workers + D1.
 *
 * Matches the existing schema.sql:
 *  - admins            : who can manage the bot
 *  - channels          : known channels (added via /addchannel)
 *  - archives          : a "link" — title/description/is_active/delete_after_seconds
 *  - archive_channels  : which channels are required to unlock a given archive
 *  - files             : files belonging to a finalized archive
 *  - upload_sessions / upload_session_files : in-progress admin upload
 *  - users             : for stats
 *  - sent_messages     : bot-sent messages eligible for auto-delete
 *  - settings          : key/value config (default auto-delete seconds, etc.)
 *  - admin_state       : what the bot is waiting to hear from an admin next
 *
 * This file additionally expects one small addendum table not in the
 * original schema.sql — see schema_addendum.sql — used to debounce the
 * "please join" prompt in group chats (replaces what used to be a
 * temp-file/KV based debounce).
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

type FileRow = {
  file_id: string;
  file_unique_id: string | null;
  file_type: string;
  file_name: string | null;
  caption: string | null;
  order_index: number;
};

type ChannelRow = { id: number; channel_id: string; username: string | null; title: string | null };

// ---------- small helpers ----------

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

// ---------- D1 data access ----------

async function isAdmin(env: Env, telegramId: number): Promise<boolean> {
  const row = await env.DB.prepare("SELECT 1 FROM admins WHERE telegram_id = ?").bind(String(telegramId)).first();
  return !!row;
}

async function adminCount(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) as c FROM admins").first<{ c: number }>();
  return row?.c ?? 0;
}

async function upsertUser(env: Env, telegramId: number) {
  const t = now();
  await env.DB.prepare(
    `INSERT INTO users (telegram_id, first_seen_at, last_seen_at) VALUES (?, ?, ?)
     ON CONFLICT(telegram_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`
  ).bind(String(telegramId), t, t).run();
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

function joinKeyboard(missing: ChannelRow[], checkCallbackData?: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const ch of missing) {
    const handle = ch.username ? ch.username.replace("@", "") : null;
    if (handle) {
      kb.url(`🔑 Join ${ch.title ?? ch.username}`, `https://t.me/${handle}`).row();
    }
  }
  if (checkCallbackData) {
    kb.text("✅ I've joined", checkCallbackData);
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
  const t = now();
  const res = await env.DB.prepare(
    "INSERT INTO upload_sessions (admin_telegram_id, status, created_at, updated_at) VALUES (?, 'collecting', ?, ?)"
  ).bind(String(adminId), t, t).run();
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
  const t = now();
  const defaultDelete = parseInt(await getSetting(env, "auto_delete_seconds", String(DEFAULT_AUTO_DELETE_SECONDS)), 10);

  const archiveRes = await env.DB.prepare(
    `INSERT INTO archives (code, title, description, delete_after_seconds, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)`
  ).bind(code, title, description, defaultDelete, t, t).run();
  const archiveId = archiveRes.meta.last_row_id as number;

  const statements = [
    ...channelIds.map((cid) =>
      env.DB.prepare("INSERT INTO archive_channels (archive_id, channel_id, created_at) VALUES (?, ?, ?)").bind(archiveId, cid, t)
    ),
    ...files.map((f) =>
      env.DB.prepare(
        `INSERT INTO files (archive_id, file_id, file_unique_id, file_type, file_name, caption, order_index, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(archiveId, f.file_id, f.file_unique_id, f.file_type, f.file_name, f.caption, f.order_index, t)
    ),
    env.DB.prepare("DELETE FROM upload_session_files WHERE session_id = ?").bind(sessionId),
    env.DB.prepare("UPDATE upload_sessions SET status = 'finished', updated_at = ? WHERE id = ?").bind(t, sessionId),
  ];
  if (statements.length > 0) await env.DB.batch(statements);
  return code;
}

async function getArchiveByCode(env: Env, code: string) {
  return env.DB.prepare("SELECT id, title, is_active, delete_after_seconds FROM archives WHERE code = ?")
    .bind(code).first<{ id: number; title: string; is_active: number; delete_after_seconds: number | null }>();
}

async function getArchiveFiles(env: Env, archiveId: number): Promise<FileRow[]> {
  const res = await env.DB.prepare(
    "SELECT file_id, file_unique_id, file_type, file_name, caption, order_index FROM files WHERE archive_id = ? ORDER BY order_index ASC"
  ).bind(archiveId).all<FileRow>();
  return res.results ?? [];
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

// ---------- bot construction ----------

function buildBot(env: Env): Bot {
  const bot = new Bot(env.BOT_TOKEN);

  // ----- /start (deep link or plain) -----
  bot.command("start", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    await upsertUser(env, userId);

    const payload = ctx.match?.toString().trim();
    if (payload) {
      await deliverArchive(ctx, env, userId, payload);
      return;
    }
    await ctx.reply("Hello!\nSend a command or message to use the bot.");
  });

  // ----- admin: channel management -----
  bot.command("addchannel", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId || !(await isAdmin(env, userId))) return;
    const args = ctx.match?.toString().trim().split(/\s+/) ?? [];
    const username = args[0];
    if (!username || !username.startsWith("@")) {
      await ctx.reply("Usage: /addchannel @channelusername");
      return;
    }
    try {
      const chat = await ctx.api.getChat(username);
      const title = "title" in chat ? chat.title ?? null : null;
      await env.DB.prepare(
        `INSERT INTO channels (channel_id, username, title, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(channel_id) DO UPDATE SET username = excluded.username, title = excluded.title`
      ).bind(String(chat.id), username, title, now()).run();
      await ctx.reply(`Channel ${username} added. Make sure the bot is an admin there.`);
    } catch {
      await ctx.reply(`Couldn't find ${username}. Make sure the bot is already added to that channel (even as a member) and the username is correct.`);
    }
  });

  bot.command("removechannel", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId || !(await isAdmin(env, userId))) return;
    const username = ctx.match?.toString().trim();
    if (!username) {
      await ctx.reply("Usage: /removechannel @channelusername");
      return;
    }
    await env.DB.prepare("DELETE FROM channels WHERE username = ?").bind(username).run();
    await ctx.reply(`Channel ${username} removed.`);
  });

  bot.command("listchannels", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId || !(await isAdmin(env, userId))) return;
    const channels = await getAllChannels(env);
    if (channels.length === 0) {
      await ctx.reply("No channels registered yet.");
      return;
    }
    const list = channels.map((c) => `#${c.id} • ${c.username ?? c.channel_id}${c.title ? ` (${c.title})` : ""}`).join("\n");
    await ctx.reply(`Channels:\n${list}`);
  });

  // ----- admin: stats -----
  bot.command("stats", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId || !(await isAdmin(env, userId))) return;
    const [users, archives, files, channels] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) as c FROM users").first<{ c: number }>(),
      env.DB.prepare("SELECT COUNT(*) as c FROM archives").first<{ c: number }>(),
      env.DB.prepare("SELECT COUNT(*) as c FROM files").first<{ c: number }>(),
      env.DB.prepare("SELECT COUNT(*) as c FROM channels").first<{ c: number }>(),
    ]);
    await ctx.reply(
      `📊 Stats\nUsers: ${users?.c ?? 0}\nChannels: ${channels?.c ?? 0}\nLinks (archives): ${archives?.c ?? 0}\nFiles stored: ${files?.c ?? 0}`
    );
  });

  // ----- admin: auto-delete setting -----
  bot.command("setautodelete", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId || !(await isAdmin(env, userId))) return;
    const arg = ctx.match?.toString().trim();
    const seconds = parseInt(arg ?? "", 10);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      const current = await getSetting(env, "auto_delete_seconds", String(DEFAULT_AUTO_DELETE_SECONDS));
      await ctx.reply(`Usage: /setautodelete <seconds>\nCurrent default: ${current}s\n(Applies to newly created links.)`);
      return;
    }
    await setSetting(env, "auto_delete_seconds", String(seconds));
    await ctx.reply(`Default auto-delete delay set to ${seconds}s for new links.`);
  });

  // ----- admin: manage other admins -----
  bot.command("addadmin", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId || !(await isAdmin(env, userId))) return;
    const target = ctx.match?.toString().trim();
    if (!target || !/^\d+$/.test(target)) {
      await ctx.reply("Usage: /addadmin <numeric_telegram_id>");
      return;
    }
    await env.DB.prepare("INSERT OR IGNORE INTO admins (telegram_id, created_at) VALUES (?, ?)").bind(target, now()).run();
    await ctx.reply(`User ${target} is now an admin.`);
  });

  // ----- admin: upload flow -----
  bot.command("upload", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId || !(await isAdmin(env, userId))) return;
    const sessionId = await startSession(env, userId);
    await clearAdminState(env, userId);
    await ctx.reply(
      `Upload mode started (session #${sessionId}). Send the files you want in this link, one by one. When done, send /done. To cancel, send /cancel.`
    );
  });

  bot.command("cancel", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId || !(await isAdmin(env, userId))) return;
    const session = await getActiveSession(env, userId);
    if (session) {
      await env.DB.prepare("UPDATE upload_sessions SET status = 'cancelled', updated_at = ? WHERE id = ?").bind(now(), session.id).run();
      await env.DB.prepare("DELETE FROM upload_session_files WHERE session_id = ?").bind(session.id).run();
    }
    await clearAdminState(env, userId);
    await ctx.reply("Cancelled.");
  });

  bot.command("done", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId || !(await isAdmin(env, userId))) return;
    const session = await getActiveSession(env, userId);
    if (!session) {
      await ctx.reply("No active upload session. Send /upload first, then send files.");
      return;
    }
    const files = await getSessionFiles(env, session.id);
    if (files.length === 0) {
      await ctx.reply("You haven't sent any files yet. Send some files, or /cancel.");
      return;
    }
    await setAdminState(env, userId, "awaiting_title", { sessionId: session.id });
    await ctx.reply(`Got ${files.length} file(s). Now send a title for this link.`);
  });

  // ----- callback queries: channel selection + membership re-check -----
  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    const userId = ctx.from.id;

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
      await ctx.editMessageReplyMarkup({ reply_markup: buildChannelPickerKeyboard(channels, selected, sessionIdStr) });
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
        await ctx.answerCallbackQuery({ text: "Select at least one channel." });
        return;
      }
      const title = state.context.title as string;
      const description = (state.context.description as string | null) ?? null;
      const code = await finalizeArchive(env, sessionId, title, description, selected);
      await clearAdminState(env, userId);
      await ctx.answerCallbackQuery({ text: "Link created!" });
      await ctx.editMessageText(`✅ Link created:\nhttps://t.me/${env.BOT_USERNAME}?start=${code}`);
      return;
    }

    if (data.startsWith("check:")) {
      const code = data.slice("check:".length);
      const archive = await getArchiveByCode(env, code);
      if (!archive) {
        await ctx.answerCallbackQuery({ text: "This link is invalid." });
        return;
      }
      const channels = await getArchiveChannels(env, archive.id);
      const membership = await checkMembership(ctx, channels, userId);
      if (!membership.ok) {
        await ctx.answerCallbackQuery({ text: "Couldn't verify — try again shortly." });
        return;
      }
      if (membership.missing.length > 0) {
        await ctx.answerCallbackQuery({ text: "You haven't joined everything yet." });
        await ctx.editMessageReplyMarkup({ reply_markup: joinKeyboard(membership.missing, `check:${code}`) });
        return;
      }
      await ctx.answerCallbackQuery({ text: "Verified! Sending your files..." });
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

    const admin = await isAdmin(env, userId);

    // Admin: receiving files for an active upload session
    if (admin) {
      const session = await getActiveSession(env, userId);
      if (session) {
        const file = detectFile(ctx.message);
        if (file) {
          const position = await addFileToSession(env, session.id, file);
          await ctx.reply(`File #${position} added. Send more, or /done to finish.`);
          return;
        }
      }

      // Admin: conversation steps (title / description)
      const state = await getAdminState(env, userId);
      if (state && ctx.message.text) {
        const text = ctx.message.text.trim();
        if (state.state === "awaiting_title") {
          await setAdminState(env, userId, "awaiting_description", { ...state.context, title: text });
          await ctx.reply("Got it. Now send a description, or /skip to leave it empty.");
          return;
        }
        if (state.state === "awaiting_description") {
          const description = text === "/skip" ? null : text;
          const channels = await getAllChannels(env);
          if (channels.length === 0) {
            await ctx.reply("No channels are registered yet — add one with /addchannel before creating a link.");
            await clearAdminState(env, userId);
            return;
          }
          await setAdminState(env, userId, "awaiting_channels", { ...state.context, description, selected: [] });
          await ctx.reply("Which channel(s) should be required for this link? Tap to toggle, then Confirm.", {
            reply_markup: buildChannelPickerKeyboard(channels, [], String(state.context.sessionId)),
          });
          return;
        }
      }
    }

    // Everyone else: normal commands / force-join gate
    if (ctx.message.text) {
      const text = ctx.message.text.trim();
      if (text.toLowerCase() === "testbit") {
        await ctx.reply("Bot is active ✔️");
        return;
      }
      if (text.toLowerCase() === "creator") {
        await ctx.reply("This bot was built with a custom grammy + Cloudflare Workers setup.");
        return;
      }
    }

    if (!admin) {
      const channels = await getAllChannels(env);
      if (channels.length > 0) {
        const membership = await checkMembership(ctx, channels, userId);
        if (!membership.ok) {
          await ctx.reply("An error occurred while checking your membership. Please try again later.");
          return;
        }
        if (membership.missing.length > 0) {
          await ctx.reply("Hi there! To use this bot, please join our official channel(s) first:", {
            reply_markup: joinKeyboard(membership.missing),
          });
          return;
        }
      }
    }
  });

  return bot;
}

function buildChannelPickerKeyboard(channels: ChannelRow[], selected: number[], sessionId: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const ch of channels) {
    const mark = selected.includes(ch.id) ? "✅ " : "";
    kb.text(`${mark}${ch.title ?? ch.username ?? ch.channel_id}`, `chsel:${sessionId}:${ch.id}`).row();
  }
  kb.text("Confirm ✅", `chconfirm:${sessionId}`);
  return kb;
}

async function deliverArchive(ctx: Context, env: Env, userId: number, code: string) {
  const archive = await getArchiveByCode(env, code);
  if (!archive || !archive.is_active) {
    await ctx.reply("This link is invalid or no longer active.");
    return;
  }

  const admin = await isAdmin(env, userId);
  if (!admin) {
    const channels = await getArchiveChannels(env, archive.id);
    const membership = await checkMembership(ctx, channels, userId);
    if (!membership.ok) {
      await ctx.reply("An error occurred while checking your membership. Please try again later.");
      return;
    }
    if (membership.missing.length > 0) {
      await ctx.reply("To get these files, please join the required channel(s) first:", {
        reply_markup: joinKeyboard(membership.missing, `check:${code}`),
      });
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
  const files = await getArchiveFiles(env, archive.id);
  if (files.length === 0) {
    await ctx.reply("This link has no files.");
    return;
  }
  const chatId = ctx.chat!.id;
  for (const f of files) {
    const sent = await sendStoredFile(ctx, chatId, f);
    if (sent && "message_id" in sent) {
      await trackSentMessage(env, userId, chatId, sent.message_id, archive.id, archive.delete_after_seconds);
    }
  }
}

async function handleGroupMessage(ctx: Context, env: Env) {
  const userId = ctx.from?.id;
  const chat = ctx.chat;
  if (!userId || !chat) return;

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
    `${mention},\nTo use this group, please join our official channel(s) first:\nOnce you've joined, come back to this group.`,
    { parse_mode: "HTML", reply_markup: joinKeyboard(membership.missing) }
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
