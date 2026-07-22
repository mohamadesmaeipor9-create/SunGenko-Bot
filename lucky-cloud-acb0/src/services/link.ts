import type { Env } from "../types/env";


function generateCode(
  length = 8
): string {

  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";


  let code = "";


  for (let i = 0; i < length; i++) {

    code +=
      chars[
        Math.floor(
          Math.random() * chars.length
        )
      ];

  }


  return code;

}



export async function createArchiveCode(
  env: Env
): Promise<string> {


  let code = "";


  while (true) {


    code =
      generateCode();



    const exists =
      await env.DB
        .prepare(
          "SELECT id FROM archives WHERE code = ?"
        )
        .bind(
          code
        )
        .first();



    if (!exists) {

      break;

    }


  }



  return code;

}



export function createArchiveLink(
  botUsername: string,
  code: string
): string {


  return (
    "https://t.me/" +
    botUsername +
    "?start=" +
    code
  );


}