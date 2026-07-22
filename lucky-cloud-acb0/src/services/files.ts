import type { Env } from "../types/env";


export async function getFilesCount(
  env: Env
) {

  const result =
    await env.DB
      .prepare(
        "SELECT COUNT(*) as count FROM files"
      )
      .first<any>();


  return Number(
    result?.count || 0
  );

}