import { InlineKeyboard } from "grammy";


export function archiveEditKeyboard(
  archiveId: number
) {


  return new InlineKeyboard()

    .text(
      "✏️ Edit Title",
      "archive_edit_title_" + archiveId
    )

    .row()

    .text(
      "📝 Edit Description",
      "archive_edit_description_" + archiveId
    )

    .row()

    .text(
      "📁 View Files",
      "archive_files_" + archiveId
    )

    .row()

    .text(
      "🗑 Delete Archive",
      "archive_delete_" + archiveId
    )

    .row()

    .text(
      "🔙 Back",
      "admin_archives"
    );

}