import type { Env } from "../types/env";



export async function saveUserMessage(
  env: Env,
  userId: number,
  chatId: number,
  messageId: number,
  deleteAt: number
) {


  await env.DB
    .prepare(
      "INSERT INTO cleanup_messages (user_id, chat_id, message_id, delete_at) VALUES (?, ?, ?, ?)"
    )
    .bind(
      userId,
      chatId,
      messageId,
      deleteAt
    )
    .run();


}



export async function getExpiredMessages(
  env: Env
) {


  const now =
    Math.floor(
      Date.now() / 1000
    );



  const result =
    await env.DB
      .prepare(
        "SELECT * FROM cleanup_messages WHERE delete_at <= ?"
      )
      .bind(
        now
      )
      .all<any>();


  return result.results;

}



export async function removeCleanupRecord(
  env: Env,
  id: number
) {


  await env.DB
    .prepare(
      "DELETE FROM cleanup_messages WHERE id = ?"
    )
    .bind(
      id
    )
    .run();


}