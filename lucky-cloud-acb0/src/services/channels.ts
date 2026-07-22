import type { Env } from "../types/env";


export async function getActiveChannels(
  env: Env
) {


  const result =
    await env.DB
      .prepare(
        "SELECT * FROM channels WHERE is_active = 1 ORDER BY id ASC"
      )
      .all<any>();


  return result.results;


}



export async function addChannel(
  env: Env,
  channelId: string,
  username: string
) {


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


}



export async function removeChannel(
  env: Env,
  id: number
) {


  await env.DB
    .prepare(
      "DELETE FROM channels WHERE id = ?"
    )
    .bind(
      id
    )
    .run();


}