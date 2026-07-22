import { InlineKeyboard } from "grammy";


export function settingsKeyboard() {


  return new InlineKeyboard()
    .text(
      "🔄 Refresh Settings",
      "admin_settings"
    );


}