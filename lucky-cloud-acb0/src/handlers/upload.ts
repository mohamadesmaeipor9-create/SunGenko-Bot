import type { Bot } from "grammy";
import type { Env } from "../types/env";

import {
  createSession,
  getActiveSession,
  updateStep,
  updateTitle,
  updateDescription,
  finishSession
} from "../services/uploadSession";

import { addUploadFile } from "../services/uploadFiles";
import { createArchiveFromSession } from "../services/archive";


export function uploadHandler(
  bot: Bot,
  env: Env
) {


  bot.callbackQuery(
    "admin_upload",
    async (ctx) => {


      const adminId =
        ctx.from?.id;


      if (!adminId) {

        await ctx.answerCallbackQuery();

        return;

      }



      const session =
        await createSession(
          env,
          adminId
        );



      await ctx.reply(
        "📦 Upload Started\n\n" +
        "Session: " +
        session.code +
        "\n\n" +
        "Send your files now.\n\n" +
        "When finished use /done"
      );



      await ctx.answerCallbackQuery();

    }
  );



  bot.command(
    "done",
    async (ctx) => {


      const adminId =
        ctx.from?.id;



      if (!adminId) {

        return;

      }



      const session =
        await getActiveSession(
          env,
          adminId
        );



      if (!session) {


        await ctx.reply(
          "❌ No active upload session found."
        );


        return;

      }



      await updateStep(
        env,
        Number(session.id),
        "TITLE"
      );



      await ctx.reply(
        "✅ Upload finished.\n\n" +
        "Send archive title."
      );


    }
  );



  bot.on(
    "message",
    async (ctx) => {


      const adminId =
        ctx.from?.id;



      if (!adminId) {

        return;

      }



      const session =
        await getActiveSession(
          env,
          adminId
        );



      if (!session) {

        return;

      }



      const step =
        session.step;
      if (step === "TITLE") {


        if (!ctx.message.text) {

          return;

        }



        await updateTitle(
          env,
          Number(session.id),
          ctx.message.text
        );



        await updateStep(
          env,
          Number(session.id),
          "DESCRIPTION"
        );



        await ctx.reply(
          "📝 Send archive description."
        );



        return;

      }





      if (step === "DESCRIPTION") {


        if (!ctx.message.text) {

          return;

        }



        await updateDescription(
          env,
          Number(session.id),
          ctx.message.text
        );



        const archive =
          await createArchiveFromSession(
            env,
            Number(session.id)
          );



        await finishSession(
          env,
          Number(session.id)
        );



        await ctx.reply(
          "✅ Archive created.\n\n" +
          "Your link:\n" +
          "https://t.me/" +
          env.BOT_USERNAME +
          "?start=" +
          archive.code
        );



        return;

      }





      let fileId = "";

      let fileType = "";





      if (ctx.message.document) {


        fileId =
          ctx.message.document.file_id;


        fileType =
          "document";


      }
      else if (ctx.message.video) {


        fileId =
          ctx.message.video.file_id;


        fileType =
          "video";


      }
      else if (ctx.message.photo) {


        fileId =
          ctx.message.photo[
            ctx.message.photo.length - 1
          ].file_id;


        fileType =
          "photo";


      }





      if (!fileId) {

        return;

      }





      await addUploadFile(
        env,
        Number(session.id),
        fileId,
        fileType
      );



    }
  );


}