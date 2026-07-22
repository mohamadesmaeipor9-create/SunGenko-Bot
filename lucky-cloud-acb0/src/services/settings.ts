import type { Env } from "../types/env";


export async function getSettings(
  env: Env
) {


  const result =
    await env.DB
      .prepare(
        "SELECT * FROM settings LIMIT 1"
      )
      .first<any>();


  return result || null;

}



export async function getSetting(
  env: Env,
  key: string
) {


  const result =
    await env.DB
      .prepare(
        "SELECT * FROM settings WHERE key = ?"
      )
      .bind(
        key
      )
      .first<any>();


  return result || null;

}



export async function setSetting(
  env: Env,
  key: string,
  value: string
) {


  const exists =
    await getSetting(
      env,
      key
    );



  if (exists) {


    await env.DB
      .prepare(
        "UPDATE settings SET value = ? WHERE key = ?"
      )
      .bind(
        value,
        key
      )
      .run();


  } else {


    await env.DB
      .prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?)"
      )
      .bind(
        key,
        value
      )
      .run();


  }


}



export async function deleteSetting(
  env: Env,
  key: string
) {


  await env.DB
    .prepare(
      "DELETE FROM settings WHERE key = ?"
    )
    .bind(
      key
    )
    .run();


}