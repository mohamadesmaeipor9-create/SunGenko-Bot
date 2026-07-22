import type { Env } from "../types/env";


export async function addUser(
  env: Env,
  telegramId: number
): Promise<void> {

  await env.DB
    .prepare(
      "INSERT INTO users (telegram_id, joined_at) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM users WHERE telegram_id = ?)"
    )
    .bind(
      String(telegramId),
      Date.now(),
      String(telegramId)
    )
    .run();

}



export async function getUsersCount(
  env: Env
): Promise<number> {

  const result = await env.DB
    .prepare(
      "SELECT COUNT(*) as total FROM users"
    )
    .first<{ total: number }>();

  return result?.total ?? 0;

}



export async function getLatestUsers(
  env: Env
) {

  const result = await env.DB
    .prepare(
      "SELECT telegram_id, joined_at FROM users ORDER BY id DESC LIMIT 5"
    )
    .all();

  return result.results;

}