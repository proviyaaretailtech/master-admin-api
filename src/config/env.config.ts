if (process.env.NODE_ENV !== "production") {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const dotenv = require("dotenv");
    dotenv.config();
  } catch {
    // ignore
  }
}
import { getEnv } from "../utils/get-env";
import { resolveNodeEnv, missingProductionSettings } from "./boot-guard";

const NODE_ENV = resolveNodeEnv(process.env.NODE_ENV);

export const Env = {
  NODE_ENV,
  PORT: Number(getEnv("PORT", "8000")),
  BASE_PATH: getEnv("BASE_PATH", "/api"),
  // Comma separated list of browser origins allowed to call the API cross-origin. Requests from the
  // same origin as the API (the normal Vercel deployment) need no entry here.
  CLIENT_ORIGIN: getEnv("CLIENT_ORIGIN", "http://localhost:5173"),
  // Number of reverse-proxy hops in front of the app (Vercel = 1). Needed so the rate limiter sees each
  // client's own IP instead of the proxy's. 0 = not behind a proxy.
  TRUST_PROXY: getEnv("TRUST_PROXY", process.env.VERCEL ? "1" : "0"),

  // Supabase REST credentials
  SUPABASE_URL: getEnv("SUPABASE_URL", "https://placeholder.supabase.co"),
  SUPABASE_ANON_KEY: getEnv("SUPABASE_ANON_KEY", "placeholder-anon-key"),

  // Direct PostgreSQL Connection (used for migrations)
  DATABASE_URL: getEnv("DATABASE_URL", ""),

  // Server-side only. Used to create platform staff accounts (Supabase Admin API). Never sent to a browser.
  SUPABASE_SERVICE_ROLE_KEY: getEnv("SUPABASE_SERVICE_ROLE_KEY", ""),
} as const;

// Sign-in is handled by Supabase Auth (access tokens are verified with Supabase), so there is no
// app-level JWT secret any more. In production the settings below must be real.
if (Env.NODE_ENV === "production") {
  const missing = missingProductionSettings(Env, process.env);
  if (missing.length > 0) {
    throw new Error(`Refusing to start in production without: ${missing.join(", ")}`);
  }
}
