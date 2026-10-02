import { isLocalDatabaseUrl, sslSettingFromEnv } from "./ssl.config";

/**
 * Secure by default: an UNSET (or blank) NODE_ENV means production, so a deployment that forgot the
 * variable still gets the production boot guards and never returns stack traces to clients. Local
 * development sets NODE_ENV=development explicitly (see .env.example); tests run with NODE_ENV=test.
 */
export function resolveNodeEnv(raw: string | undefined): string {
  return (raw || "").trim().toLowerCase() || "production";
}

export interface BootSettings {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  DATABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

/** Names of the settings a production deployment is missing (empty = fine to start). */
export function missingProductionSettings(settings: BootSettings, env: NodeJS.ProcessEnv): string[] {
  const remoteDb = !!settings.DATABASE_URL && !isLocalDatabaseUrl(settings.DATABASE_URL);
  return (
    [
      ["SUPABASE_URL", settings.SUPABASE_URL.includes("placeholder")],
      ["SUPABASE_ANON_KEY", settings.SUPABASE_ANON_KEY === "placeholder-anon-key"],
      ["DATABASE_URL", !settings.DATABASE_URL],
      ["SUPABASE_SERVICE_ROLE_KEY", !settings.SUPABASE_SERVICE_ROLE_KEY],
      // A remote database connection must be certificate-verified: provide the CA to trust
      // (DATABASE_SSL_CA / DATABASE_SSL_CA_FILE) or explicitly accept the risk with
      // DATABASE_SSL_REJECT_UNAUTHORIZED=false.
      [
        "DATABASE_SSL_CA (or DATABASE_SSL_CA_FILE; or DATABASE_SSL_REJECT_UNAUTHORIZED=false to knowingly accept an unverified database connection)",
        remoteDb && sslSettingFromEnv(env).mode === "unconfigured",
      ],
    ] as Array<[string, boolean]>
  )
    .filter(([, bad]) => bad)
    .map(([name]) => name);
}
