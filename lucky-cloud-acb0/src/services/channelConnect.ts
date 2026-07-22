import type { Env } from "../types/env";


export async function getChannelById(
  env: Env,
  channelId: string
) {

  const result =
    await env.DB
      .prepare(
        "SELECT * FROM channels WHERE channel_id = ?"
      )
      .bind(
        channelId
      )
      .first<any>();


  return result || null;

}



export async function connectChannel(
  env: Env,
  channelId: string,
  username: string
) {


  const exists =
    await getChannelById(
      env,
      channelId
    );


  if (exists) {

    return {
      success: false,
      message: "Channel already connected."
    };

  }



  const now =
    Math.floor(
      Date.now() / 1000
    );



  await env.DB
    .prepare(
      "INSERT INTO channels (channel_id, username, created_at, is_active) VALUES (?, ?, ?, ?)"
    )
    .bind(
      channelId,
      username,
      now,
      1
    )
    .run();



  return {
    success: true,
    message: "Channel connected successfully."
  };

}



export async function disconnectChannel(
  env: Env,
  channelId: string
) {


  await env.DB
    .prepare(
      "DELETE FROM channels WHERE channel_id = ?"
    )
    .bind(
      channelId
    )
    .run();



  return true;

}



export async function getConnectedChannels(
  env: Env
) {


  const result =
    await env.DB
      .prepare(
        "SELECT * FROM channels ORDER BY id DESC"
      )
      .all<any>();


  return result.results;

}