import type { Env } from "../types/env";


export async function addUploadFile(
  env: Env,
  sessionId: number,
  fileId: string,
  fileType: string
) {

  const now =
    Math.floor(
      Date.now() / 1000
    );


  await env.DB
    .prepare(
      "INSERT INTO upload_files (session_id, file_id, file_type, created_at) VALUES (?, ?, ?, ?)"
    )
    .bind(
      sessionId,
      fileId,
      fileType,
      now
    )
    .run();

}