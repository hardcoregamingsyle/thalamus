import { Hono } from "hono";
import type { CookieSession } from "./auth.js";

export interface AppEnv {
  Variables: { session: CookieSession };
}

export function createSessionHono(): Hono<AppEnv> {
  return new Hono<AppEnv>();
}
