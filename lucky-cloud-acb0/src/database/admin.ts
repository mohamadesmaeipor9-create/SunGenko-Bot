import type { Env } from "../types/env";

export async function isAdmin(
  env: Env,
  telegramId: number
): Promise<boolean> {
  const result = await env.DB
    .prepare(
      "SELECT id FROM admins WHERE telegram_id = ?"
    )
    .bind(telegramId)
    .first();

  return !!result;
}


export async function addAdmin(
  env: Env,
  telegramId: number
): Promise<void> {
  await env.DB
    .prepare(
      "INSERT INTO admins (telegram_id) VALUES (?)"
    )
    .bind(telegramId)
    .run();
}