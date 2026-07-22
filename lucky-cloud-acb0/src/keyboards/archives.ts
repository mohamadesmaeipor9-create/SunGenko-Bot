import { InlineKeyboard } from "grammy";


export function archivesKeyboard(
  archives: any[]
) {

  const keyboard =
    new InlineKeyboard();


  for (const archive of archives) {

    keyboard
      .text(
        "📦 " + archive.title,
        "archive_view_" + archive.id
      )
      .row();

  }


  keyboard
    .text(
      "🔙 Back",
      "admin_panel"
    );


  return keyboard;

}