import type { Env } from "../types/env";


export async function getAllArchives(
  env: Env
) {

  const result =
    await env.DB
      .prepare(
        "SELECT * FROM archives ORDER BY id DESC"
      )
      .all<any>();

  return result.results;

}



export async function getArchiveById(
  env: Env,
  id: number
) {

  const result =
    await env.DB
      .prepare(
        "SELECT * FROM archives WHERE id = ?"
      )
      .bind(
        id
      )
      .first<any>();

  return result || null;

}



export async function updateArchiveInfo(
  env: Env,
  id: number,
  title: string,
  description: string
) {

  await env.DB
    .prepare(
      "UPDATE archives SET title = ?, description = ? WHERE id = ?"
    )
    .bind(
      title,
      description,
      id
    )
    .run();

}



export async function deleteArchive(
  env: Env,
  id: number
) {

  await env.DB
    .prepare(
      "DELETE FROM archive_files WHERE archive_id = ?"
    )
    .bind(
      id
    )
    .run();


  await env.DB
    .prepare(
      "DELETE FROM archives WHERE id = ?"
    )
    .bind(
      id
    )
    .run();

}



export async function getArchiveFiles(
  env: Env,
  archiveId: number
) {

  const result =
    await env.DB
      .prepare(
        "SELECT * FROM archive_files WHERE archive_id = ? ORDER BY id ASC"
      )
      .bind(
        archiveId
      )
      .all<any>();

  return result.results;

}