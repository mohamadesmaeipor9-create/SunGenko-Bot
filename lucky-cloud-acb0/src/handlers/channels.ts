import type { Bot } from "grammy";
import type { Env } from "../types/env";


import {
  getActiveChannels,
  removeChannel
} from "../services/channels";


import {
  channelsKeyboard
} from "../keyboards/channels";



export function channelsHandler(
  bot: Bot,
  env: Env
) {



  bot.callbackQuery(
    "admin_channels",
    async (ctx) => {


      const channels =
        await getActiveChannels(
          env
        );



      let text =
        "📢 Channels Management\n\n";



      if (channels.length === 0) {


        text +=
          "No channels added.";


      } else {


        for (const channel of channels) {


          text +=
            "• @" +
            channel.username +
            "\n";


        }

      }



      await ctx.reply(
        text,
        {
          reply_markup:
            channelsKeyboard(
              channels
            )
        }
      );



      await ctx.answerCallbackQuery();


    }
  );





  bot.callbackQuery(
    /^channel_remove_(\d+)$/,
    async (ctx) => {


      const id =
        Number(
          ctx.match[1]
        );



      await removeChannel(
        env,
        id
      );



      await ctx.answerCallbackQuery({
        text:
          "Channel removed."
      });



      const channels =
        await getActiveChannels(
          env
        );



      await ctx.reply(
        "📢 Channels updated.",
        {
          reply_markup:
            channelsKeyboard(
              channels
            )
        }
      );


    }
  );



}