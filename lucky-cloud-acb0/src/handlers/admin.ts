import type { Context } from "grammy";
import { adminPanelKeyboard } from "../keyboards/panel";

export async function adminPanel(ctx: Context) {
  await ctx.reply(
    "⚙️ Admin Panel\n\nChoose an option:",
    {
      reply_markup: adminPanelKeyboard(),
    }
  );
}