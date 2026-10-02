import "dotenv/config";
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

  // JWT Configuration (mirroring TechWithEmma system)
  JWT_SECRET: getEnv("JWT_SECRET", "super-secret-jwt-pos-key-1234567890"),
  JWT_EXPIRES_IN: getEnv("JWT_EXPIRES_IN", "7d"),
} as const;
