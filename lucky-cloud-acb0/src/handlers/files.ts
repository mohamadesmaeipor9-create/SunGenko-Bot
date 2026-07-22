import type { Bot } from "grammy";
import type { Env } from "../types/env";


import {
  getFilesCount
} from "../services/files";


import {
  filesKeyboard
} from "../keyboards/files";



export function filesHandler(
  bot: Bot,
  env: Env
) {


  bot.callbackQuery(
    "admin_files",
    async (ctx) => {


      const count =
        await getFilesCount(
          env
        );



      await ctx.reply(
        "📁 Files Management\n\n" +
        "Total Files: " +
        count,
        {
          reply_markup:
            filesKeyboard()
        }
      );



      await ctx.answerCallbackQuery();


    }
  );


}