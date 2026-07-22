import { InlineKeyboard } from "grammy";


export function cleanupKeyboard() {


  return new InlineKeyboard()

    .text(
      "⏱️ Set Delete Time",
      "cleanup_set_time"
    )

    .row()

    .text(
      "🗑 Cleanup Status",
      "cleanup_status"
    )

    .row()

    .text(
      "🔙 Back",
      "admin_panel"
    );

}