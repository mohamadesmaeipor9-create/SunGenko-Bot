import type { Context } from "grammy";
import type { Env } from "../types/env";

import {
  getArchiveByCode,
  getArchiveFiles
} from "../services/archive";

import {
  checkForceJoin
} from "../services/forceJoin";

import {
  forceJoinKeyboard
} from "../keyboards/forceJoin";



export async function handleArchiveStart(
  ctx: Context,
  env: Env,
  code: string
) {


  const joinStatus =
    await checkForceJoin(
      ctx,
      env
    );



  if (!joinStatus.joined) {


    await ctx.reply(
      "🔒 To access this archive, join required channels first.",
      {
        reply_markup:
          forceJoinKeyboard(
            joinStatus.missing,
            code
          )
      }
    );


    return;

  }




  const archive =
    await getArchiveByCode(
      env,
      code
    );



  if (!archive) {


    await ctx.reply(
      "❌ Archive not found or expired."
    );


    return;

  }



  const files =
    await getArchiveFiles(
      env,
      Number(archive.id)
    );



  if (files.length === 0) {


    await ctx.reply(
      "❌ No files found."
    );


    return;

  }



  await ctx.reply(
    "📦 " +
    archive.title +
    "\n\n" +
    (archive.description || "")
  );



  for (const file of files) {


    if (file.file_type === "document") {


      await ctx.replyWithDocument(
        file.file_id
      );


    }
    else if (file.file_type === "video") {


      await ctx.replyWithVideo(
        file.file_id
      );


    }
    else if (file.file_type === "photo") {


      await ctx.replyWithPhoto(
        file.file_id
      );


    }


  }


}