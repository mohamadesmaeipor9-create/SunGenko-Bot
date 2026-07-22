import type { Bot } from "grammy";
import type { Env } from "../types/env";

import {
  cleanupKeyboard
} from "../keyboards/cleanup";



export function cleanupHandler(
  bot: Bot,
  env: Env
) {


  bot.callbackQuery(
    "cleanup_set_time",
    async (ctx) => {


      await ctx.reply(
        "⏱️ Send delete time in seconds.\n\nExample:\n3600"
      );


      await ctx.answerCallbackQuery();


    }
  );





  bot.callbackQuery(
    "cleanup_status",
    async (ctx) => {


      await ctx.reply(
        "🗑 Cleanup system is active.\n\n" +
        "Only sent messages in user chats will be deleted.\n" +
        "Archive data and files will remain safe."
      );


      await ctx.answerCallbackQuery();


    }
  );





  bot.callbackQuery(
    "admin_cleanup",
    async (ctx) => {


      await ctx.reply(
        "🗑 Cleanup Settings",
        {
          reply_markup:
            cleanupKeyboard()
        }
      );


      await ctx.answerCallbackQuery();


    }
  );


}