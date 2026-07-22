import type { Env } from "../types/env";

function generateCode(): string {
  return Math.random()
    .toString(36)
    .substring(2, 10)
    .toUpperCase();
}


export async function createUploadSession(
  env: Env,
  adminId: number
) {

  const sessionCode = generateCode();

  const now = Math.floor(Date.now() / 1000);


  const result = await env.DB
    .prepare(
      "INSERT INTO upload_sessions (session_code, admin_id, status, created_at) VALUES (?, ?, ?, ?)"
    )
    .bind(
      sessionCode,
      adminId,
      0,
      now
    )
    .run();


  return {
    id: result.meta.last_row_id,
    code: sessionCode
  };
}