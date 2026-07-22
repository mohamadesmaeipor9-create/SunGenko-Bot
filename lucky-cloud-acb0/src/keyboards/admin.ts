import { InlineKeyboard } from "grammy";

export function adminKeyboard() {
  return new InlineKeyboard()
    .text("⚙️ Admin Panel", "admin_panel");
}