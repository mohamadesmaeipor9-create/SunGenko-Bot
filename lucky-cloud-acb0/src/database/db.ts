import type { Env } from "../types/env";

export function getDatabase(env: Env) {
  return env.DB;
}