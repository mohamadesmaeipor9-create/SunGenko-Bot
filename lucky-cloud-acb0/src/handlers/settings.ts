import type { Bot } from "grammy";
import type { Env } from "../types/env";

import {
  getSettings
} from "../services/settings";

import {
  settingsKeyboard
} from "../keyboards/settings";


export function settingsHandler(
  bot: Bot,
  env: Env
) {


  bot.callbackQuery(
    "admin_settings",
    async (ctx) => {


      const settings =
        await getSettings(
          env
        );


      let text =
        "⚙️ Settings\n\n";


      if (!settings) {


        text +=
          "No settings configured.";


      } else {


        text +=
          "Current Settings:\n\n" +
          "Key: " +
          settings.key +
          "\n" +
          "Value: " +
          settings.value;


      }



      await ctx.reply(
        text,
        {
          reply_markup:
            settingsKeyboard()
        }
      );


      await ctx.answerCallbackQuery();


    }
  );


}