import type { Bot } from "grammy";
import type { Env } from "../types/env";

import {
  connectChannel,
  getConnectedChannels
} from "../services/channelConnect";

import {
  channelConnectKeyboard
} from "../keyboards/channelConnect";



export function channelConnectHandler(
  bot: Bot,
  env: Env
) {



  bot.callbackQuery(
    "channel_connect",
    async (ctx) => {


      await ctx.reply(
        "🔗 Send channel post link.\n\n" +
        "Example:\n" +
        "https://t.me/channel/123"
      );


      await ctx.answerCallbackQuery();


    }
  );





  bot.on(
    "message:text",
    async (ctx) => {


      const text =
        ctx.message.text;



      if (
        !text.startsWith(
          "https://t.me/"
        )
      ) {

        return;

      }



      try {


        const url =
          new URL(
            text
          );


        const parts =
          url.pathname
            .split("/")
            .filter(Boolean);



        if (
          parts.length < 2
        ) {


          await ctx.reply(
            "❌ Invalid channel link."
          );


          return;

        }



        const username =
          parts[0];



        const channelId =
          "@" + username;



        const result =
          await connectChannel(
            env,
            channelId,
            username
          );



        await ctx.reply(
          result.message,
          {
            reply_markup:
              channelConnectKeyboard()
          }
        );


      } catch {


        await ctx.reply(
          "❌ Invalid link."
        );


      }


    }
  );





  bot.callbackQuery(
    "admin_channels",
    async (ctx) => {


      const channels =
        await getConnectedChannels(
          env
        );



      let text =
        "📢 Connected Channels:\n\n";



      if (
        channels.length === 0
      ) {

        text +=
          "No channels connected.";

      } else {


        for (
          const channel of channels
        ) {


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
            channelConnectKeyboard()
        }
      );



      await ctx.answerCallbackQuery();


    }
  );



}