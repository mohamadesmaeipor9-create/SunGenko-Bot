import type { Context } from "grammy";
import type { Env } from "../types/env";

import {
  getUsersCount,
  getLatestUsers
} from "../services/users";

import { usersKeyboard } from "../keyboards/users";


export async function usersPanel(
  ctx: Context,
  env: Env
) {

  const totalUsers = await getUsersCount(env);

  const latestUsers = await getLatestUsers(env);


  let text =
    "👥 Users Management\n\n" +
    "Total Users: " +
    totalUsers +
    "\n\nLatest Users:\n";


  if (latestUsers.length === 0) {

    text += "No users yet.";

  } else {

    for (const user of latestUsers) {

      text +=
        "- " +
        user.telegram_id +
        "\n";

    }

  }


  await ctx.reply(
    text,
    {
      reply_markup: usersKeyboard()
    }
  );
}