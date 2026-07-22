import type { Bot } from "grammy";
import type { Env } from "../types/env";

import {
  checkForceJoin
} from "../services/forceJoin";

import {
  forceJoinKeyboard
} from "../keyboards/forceJoin";


export function forceJoinHandler(
  bot: Bot,
  env: Env
) {


  bot.callbackQuery(
    /^check_join_(.+)$/,
    async (ctx) => {


      const code =
        ctx.match[1];



      const result =
        await checkForceJoin(
          ctx,
          env
        );



      if (!result.joined) {


        await ctx.answerCallbackQuery({
          text:
            "❌ You still need to join channels.",
          show_alert: true
        });



        await ctx.reply(
          "Please join all required channels.",
          {
            reply_markup:
              forceJoinKeyboard(
                result.missing,
                code
              )
          }
        );



        return;

      }



      await ctx.answerCallbackQuery({
        text:
          "✅ Verified"
      });



      await ctx.reply(
        "✅ Membership confirmed.\n\nOpen your archive link again."
      );


    }
  );


}