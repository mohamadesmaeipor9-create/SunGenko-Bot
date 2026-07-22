import type { Bot } from "grammy";
import type { Env } from "../types/env";

import {
  checkForceJoin
} from "../services/forceJoin";

import {
  handleArchiveStart
} from "./archive";



export function callbackHandler(
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
            "❌ You still haven't joined all channels.",
          show_alert: true
        });


        return;

      }



      await ctx.answerCallbackQuery({
        text:
          "✅ Verified"
      });



      await handleArchiveStart(
        ctx,
        env,
        code
      );


    }
  );


}