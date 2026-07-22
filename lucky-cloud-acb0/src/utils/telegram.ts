import type { Context } from "grammy";



export function getUserId(
  ctx: Context
): number | null {

  if (!ctx.from) {
    return null;
  }


  return ctx.from.id;

}



export function getChatId(
  ctx: Context
): number | null {

  if (!ctx.chat) {
    return null;
  }


  return ctx.chat.id;

}



export function getMessageId(
  ctx: Context
): number | null {

  if (!ctx.message) {
    return null;
  }


  return ctx.message.message_id;

}



export function extractChannelUsername(
  link: string
): string | null {


  try {


    const url =
      new URL(link);



    const parts =
      url.pathname
        .split("/")
        .filter(Boolean);



    if (parts.length < 1) {
      return null;
    }



    return parts[0].replace(
      "@",
      ""
    );


  } catch {

    return null;

  }

}



export function extractChannelPostId(
  link: string
): number | null {


  try {


    const url =
      new URL(link);



    const parts =
      url.pathname
        .split("/")
        .filter(Boolean);



    if (
      parts.length < 2
    ) {

      return null;

    }



    const id =
      Number(
        parts[1]
      );



    if (
      Number.isNaN(id)
    ) {

      return null;

    }



    return id;


  } catch {

    return null;

  }

}