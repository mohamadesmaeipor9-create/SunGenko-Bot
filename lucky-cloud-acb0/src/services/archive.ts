import type { Env } from "../types/env";


function generateArchiveCode(): string {

  return Math.random()
    .toString(36)
    .substring(2, 10)
    .toUpperCase();

}



export async function createArchiveFromSession(
  env: Env,
  sessionId: number
) {


  const session =
    await env.DB
      .prepare(
        "SELECT * FROM upload_sessions WHERE id = ? LIMIT 1"
      )
      .bind(
        sessionId
      )
      .first<any>();



  if (!session) {

    throw new Error(
      "Upload session not found."
    );

  }



  const files =
    await env.DB
      .prepare(
        "SELECT file_id, file_type FROM upload_files WHERE session_id = ?"
      )
      .bind(
        sessionId
      )
      .all<any>();



  if (files.results.length === 0) {

    throw new Error(
      "No files uploaded."
    );

  }



  const code =
    generateArchiveCode();



  const now =
    Math.floor(
      Date.now() / 1000
    );



  const result =
    await env.DB
      .prepare(
        "INSERT INTO archives (code, title, description, delete_after, created_at, is_active) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .bind(
  code,
  session.title ?? "Untitled Archive",
  session.description ?? "",
  0,
  now,
  1
)
      .run();



  const archiveId =
    Number(
      result.meta.last_row_id
    );



  for (const file of files.results) {


    await env.DB
      .prepare(
        "INSERT INTO files (archive_id, file_id, file_type, created_at) VALUES (?, ?, ?, ?)"
      )
      .bind(
        archiveId,
        file.file_id,
        file.file_type,
        now
      )
      .run();


  }



  await env.DB
    .prepare(
      "DELETE FROM upload_files WHERE session_id = ?"
    )
    .bind(
      sessionId
    )
    .run();



  return {

    archiveId,

    code

  };

}




export async function getArchiveByCode(
  env: Env,
  code: string
) {


  return await env.DB
    .prepare(
      "SELECT * FROM archives WHERE code = ? AND is_active = 1 LIMIT 1"
    )
    .bind(
      code
    )
    .first<any>();

}




export async function getArchiveFiles(
  env: Env,
  archiveId: number
) {


  const result =
    await env.DB
      .prepare(
        "SELECT file_id, file_type FROM files WHERE archive_id = ? ORDER BY id ASC"
      )
      .bind(
        archiveId
      )
      .all<any>();



  return result.results;

}