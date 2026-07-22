import type { Bot } from "grammy";
import type { Env } from "../types/env";

import {
  getAllArchives,
  getArchiveById,
  deleteArchive
} from "../services/archiveManager";

import {
  archivesKeyboard
} from "../keyboards/archives";

import {
  archiveEditKeyboard
} from "../keyboards/archiveEdit";



export function archiveManagerHandler(
  bot: Bot,
  env: Env
) {



  bot.callbackQuery(
    "admin_archives",
    async (ctx) => {


      const archives =
        await getAllArchives(
          env
        );


      if (
        archives.length === 0
      ) {


        await ctx.reply(
          "📦 No archives found."
        );


        await ctx.answerCallbackQuery();

        return;

      }



      await ctx.reply(
        "📦 Archives:",
        {
          reply_markup:
            archivesKeyboard(
              archives
            )
        }
      );


      await ctx.answerCallbackQuery();

    }
  );





  bot.callbackQuery(
    /^archive_view_(\d+)$/,
    async (ctx) => {


      const id =
        Number(
          ctx.match[1]
        );



      const archive =
        await getArchiveById(
          env,
          id
        );



      if (!archive) {


        await ctx.answerCallbackQuery({
          text:
            "Archive not found."
        });


        return;

      }



      await ctx.reply(
        "📦 " +
        archive.title +
        "\n\n" +
        (
          archive.description ||
          "No description."
        ),
        {
          reply_markup:
            archiveEditKeyboard(
              id
            )
        }
      );



      await ctx.answerCallbackQuery();

    }
  );





  bot.callbackQuery(
    /^archive_delete_(\d+)$/,
    async (ctx) => {


      const id =
        Number(
          ctx.match[1]
        );



      await deleteArchive(
        env,
        id
      );



      await ctx.answerCallbackQuery({
        text:
          "Archive deleted."
      });



      await ctx.reply(
        "🗑 Archive removed."
      );


    }
  );



}