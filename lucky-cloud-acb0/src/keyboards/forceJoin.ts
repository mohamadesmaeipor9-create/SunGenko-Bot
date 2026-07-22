import { InlineKeyboard } from "grammy";


export function forceJoinKeyboard(
  channels: any[],
  code: string
) {


  const keyboard =
    new InlineKeyboard();



  for (const channel of channels) {


    if (channel.username) {


      keyboard.url(
        "📢 Join Channel",
        "https://t.me/" + channel.username
      );


      keyboard.row();


    }


  }



  keyboard.text(
    "✅ I Joined",
    "check_join_" + code
  );



  return keyboard;


}