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

export const Env = {
  NODE_ENV: getEnv("NODE_ENV", "development"),
  PORT: Number(getEnv("PORT", "8000")),
  BASE_PATH: getEnv("BASE_PATH", "/api"),
  CLIENT_ORIGIN: getEnv("CLIENT_ORIGIN", "http://localhost:5173"),

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
if (process.env.NODE_ENV === "production") {
  const missing = [
    ["SUPABASE_URL", Env.SUPABASE_URL.includes("placeholder")],
    ["SUPABASE_ANON_KEY", Env.SUPABASE_ANON_KEY === "placeholder-anon-key"],
    ["DATABASE_URL", !Env.DATABASE_URL],
    ["SUPABASE_SERVICE_ROLE_KEY", !Env.SUPABASE_SERVICE_ROLE_KEY],
  ]
    .filter(([, bad]) => bad)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`Refusing to start in production without: ${missing.join(", ")}`);
  }
}
