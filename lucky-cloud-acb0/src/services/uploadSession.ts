import type { Env } from "../types/env";

function generateCode(): string {
  return Math.random()
    .toString(36)
    .substring(2, 10)
    .toUpperCase();
}

export async function createSession(
  env: Env,
  adminId: number
) {
  const code = generateCode();
  const now = Math.floor(Date.now() / 1000);

  const result = await env.DB
    .prepare(
      "INSERT INTO upload_sessions (session_code, admin_id, status, title, description, created_at, finished_at, step) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(
      code,
      adminId,
      0,
      "",
      "",
      now,
      0,
      "UPLOAD"
    )
    .run();

  return {
    id: Number(result.meta.last_row_id),
    code
  };
}

export async function getActiveSession(
  env: Env,
  adminId: number
) {
  return await env.DB
    .prepare(
      "SELECT * FROM upload_sessions WHERE admin_id = ? AND status = 0 ORDER BY id DESC LIMIT 1"
    )
    .bind(adminId)
    .first();
}

export async function updateStep(
  env: Env,
  sessionId: number,
  step: string
) {
  await env.DB
    .prepare(
      "UPDATE upload_sessions SET step = ? WHERE id = ?"
    )
    .bind(
      step,
      sessionId
    )
    .run();
}

export async function updateTitle(
  env: Env,
  sessionId: number,
  title: string
) {
  await env.DB
    .prepare(
      "UPDATE upload_sessions SET title = ? WHERE id = ?"
    )
    .bind(
      title,
      sessionId
    )
    .run();
}

export async function updateDescription(
  env: Env,
  sessionId: number,
  description: string
) {
  await env.DB
    .prepare(
      "UPDATE upload_sessions SET description = ? WHERE id = ?"
    )
    .bind(
      description,
      sessionId
    )
    .run();
}

export async function finishSession(
  env: Env,
  sessionId: number
) {
  await env.DB
    .prepare(
      "UPDATE upload_sessions SET status = ?, finished_at = ?, step = ? WHERE id = ?"
    )
    .bind(
      1,
      Math.floor(Date.now() / 1000),
      "FINISHED",
      sessionId
    )
    .run();
}