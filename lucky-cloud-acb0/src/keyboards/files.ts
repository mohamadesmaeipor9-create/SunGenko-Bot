import { InlineKeyboard } from "grammy";


export function filesKeyboard() {

  return new InlineKeyboard()
    .text(
      "🔄 Refresh Files",
      "admin_files"
    );

}