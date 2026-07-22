import { InlineKeyboard } from "grammy";

export function adminPanelKeyboard() {
  return new InlineKeyboard()
    .text("👥 Users", "admin_users")
    .row()
    .text("📢 Channels", "admin_channels")
    .row()
    .text("📦 Upload Archive", "admin_upload")
    .row()
    .text("📁 Files", "admin_files")
    .row()
    .text("⚙️ Settings", "admin_settings");
}