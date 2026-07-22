export function parseStartCode(
  text: string
): string | null {


  const parts =
    text
      .trim()
      .split(" ");



  if (
    parts.length < 2
  ) {

    return null;

  }



  const code =
    parts[1]
      .trim();



  if (
    !code
  ) {

    return null;

  }



  return code;

}



export function cleanUsername(
  username: string
): string {


  return username
    .replace(
      "@",
      ""
    )
    .replace(
      "https://t.me/",
      ""
    )
    .trim();

}



export function parseArchiveCode(
  code: string
): string | null {


  const clean =
    code.trim();



  if (
    clean.length < 4
  ) {

    return null;

  }



  return clean;

}