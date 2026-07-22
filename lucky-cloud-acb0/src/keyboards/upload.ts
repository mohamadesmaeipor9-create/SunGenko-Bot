import { InlineKeyboard } from "grammy";


export function uploadKeyboard() {


  return new InlineKeyboard()

    .text(
      "✅ Finish Upload",
      "upload_finish"
    )

    .row()

    .text(
      "❌ Cancel Upload",
      "upload_cancel"
    );

}