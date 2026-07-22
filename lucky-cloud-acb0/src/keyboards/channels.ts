import { InlineKeyboard } from "grammy";


export function channelsKeyboard(
  channels: any[]
) {

  const keyboard =
    new InlineKeyboard();


  keyboard.text(
    "➕ Add Channel",
    "channel_add"
  );

  keyboard.row();


  for (const channel of channels) {


    keyboard.text(
      "❌ " + channel.username,
      "channel_remove_" + channel.id
    );


    keyboard.row();

  }


  keyboard.text(
    "🔄 Refresh",
    "admin_channels"
  );


  return keyboard;

}