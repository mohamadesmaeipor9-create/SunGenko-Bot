import { Bot } from "grammy";
import type { Env } from "./types/env";


import { adminKeyboard } from "./keyboards/admin";


import { adminPanel } from "./handlers/admin";
import { usersPanel } from "./handlers/users";
import { uploadHandler } from "./handlers/upload";
import { forceJoinHandler } from "./handlers/forceJoin";
import { callbackHandler } from "./handlers/callbacks";
import { handleArchiveStart } from "./handlers/archive";


import { channelsHandler } from "./handlers/channels";
import { filesHandler } from "./handlers/files";
import { settingsHandler } from "./handlers/settings";



export function createBot(
  env: Env
) {


  const bot =
    new Bot(
      env.BOT_TOKEN
    );



  /*
    START COMMAND
  */


  bot.command(
    "start",
    async (ctx) => {


      const text =
        ctx.message?.text || "";


      const parts =
        text.split(" ");



      if (parts.length > 1) {


        const code =
          parts[1];


        await handleArchiveStart(
          ctx,
          env,
          code
        );


        return;

      }



      await ctx.reply(
        "Welcome Admin 👑\n\n" +
        "SunGenko Bot is ready.",
        {
          reply_markup:
            adminKeyboard()
        }
      );


    }
  );





  /*
    ADMIN PANEL
  */


  bot.callbackQuery(
    "admin_panel",
    async (ctx) => {


      await adminPanel(
        ctx
      );


      await ctx.answerCallbackQuery();


    }
  );





  /*
    USERS
  */


  bot.callbackQuery(
    "admin_users",
    async (ctx) => {


      await usersPanel(
        ctx,
        env
      );


      await ctx.answerCallbackQuery();


    }
  );





  /*
    MODULES
  */


  uploadHandler(
    bot,
    env
  );


  forceJoinHandler(
    bot,
    env
  );


  callbackHandler(
    bot,
    env
  );


  channelsHandler(
    bot,
    env
  );


  filesHandler(
    bot,
    env
  );


  settingsHandler(
    bot,
    env
  );



  return bot;

}