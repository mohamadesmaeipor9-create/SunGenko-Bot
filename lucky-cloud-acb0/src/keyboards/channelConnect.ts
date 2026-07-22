import { InlineKeyboard } from "grammy";


export function channelConnectKeyboard() {


  return new InlineKeyboard()

    .text(
      "🔗 Connect Channel",
      "channel_connect"
    )

    .row()

    .text(
      "📢 Connected Channels",
      "admin_channels"
    )

    .row()

    .text(
      "🔙 Back",
      "admin_panel"
    );

}