import { createBot } from "./bot";
import type { Env } from "./types/env";
import type { Update } from "grammy/types";

export default {
  async fetch(
    request: Request,
    env: Env
  ): Promise<Response> {

    const bot = createBot(env);

    if (request.method === "POST") {
      const update = await request.json() as Update;

      await bot.init();

      await bot.handleUpdate(update);

      return new Response("OK");
    }

    return new Response("SunGenko Bot is running!");
  },
};