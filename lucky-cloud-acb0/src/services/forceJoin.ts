import type { Env } from "../types/env";


export async function checkForceJoin(
  ctx: any,
  env: Env
) {


  const userId =
    ctx.from?.id;



  if (!userId) {

    return {
      joined: false,
      missing: []
    };

  }



  const channels =
    await env.DB
      .prepare(
        "SELECT * FROM channels WHERE is_active = 1"
      )
      .all<any>();



  if (channels.results.length === 0) {


    return {
      joined: true,
      missing: []
    };

  }



  const missing: any[] = [];



  for (const channel of channels.results) {


    try {


      const member =
        await ctx.api.getChatMember(
          channel.channel_id,
          userId
        );



      const status =
        member.status;



      if (
        status === "left" ||
        status === "kicked"
      ) {


        missing.push(
          channel
        );


      }



    }
    catch {


      missing.push(
        channel
      );


    }


  }



  return {

    joined:
      missing.length === 0,

    missing

  };


}