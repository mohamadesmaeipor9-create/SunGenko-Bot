import { InlineKeyboard } from "grammy";

export function usersKeyboard() {

  return new InlineKeyboard()
    .text("🔄 Refresh", "admin_users")
    .row()
    .text("⬅️ Back", "admin_panel");

}