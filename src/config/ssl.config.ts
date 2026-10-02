import fs from "fs";
import type { ConnectionOptions } from "tls";

/**
 * Database TLS settings, with no side effects so scripts and tests can reuse them.
 *
 * The control plane connects as the database owner, so a network attacker who can impersonate the
 * database would capture the owner credentials. Certificates are therefore VERIFIED by default:
 *   - DATABASE_SSL_CA            PEM text (literal "\n" sequences are accepted) of the CA to trust
 *   - DATABASE_SSL_CA_FILE       or a path to a PEM file (Supabase publishes its root CA for download)
 *   - DATABASE_SSL_REJECT_UNAUTHORIZED=false   explicit, logged opt-out (unverified connection)
 */
export type SslSetting =
  | { mode: "off"; ssl: false }
  | { mode: "pinned"; ssl: ConnectionOptions }
  | { mode: "verified"; ssl: ConnectionOptions }
  | { mode: "insecure"; ssl: ConnectionOptions }
  | { mode: "unconfigured"; ssl: ConnectionOptions };

export const isLocalDatabaseUrl = (url: string): boolean =>
  /@(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//.test(url) || /^postgres(?:ql)?:\/\/(localhost|127\.0\.0\.1)/.test(url);

export function sslSettingFromEnv(env: NodeJS.ProcessEnv): SslSetting {
  let ca = (env.DATABASE_SSL_CA || "").trim();
  if (ca) ca = ca.replace(/\\n/g, "\n");
  const caFile = (env.DATABASE_SSL_CA_FILE || "").trim();
  if (!ca && caFile) ca = fs.readFileSync(caFile, "utf8");
  if (ca) return { mode: "pinned", ssl: { ca, rejectUnauthorized: true } };
  if ((env.DATABASE_SSL_REJECT_UNAUTHORIZED || "").trim().toLowerCase() === "false") {
    return { mode: "insecure", ssl: { rejectUnauthorized: false } };
  }
  // No CA supplied: verify against the system trust store (works for CAs that are publicly trusted).
  return { mode: "unconfigured", ssl: { rejectUnauthorized: true } };
}

export function sslForDatabaseUrl(url: string, env: NodeJS.ProcessEnv = process.env): false | ConnectionOptions {
  if (isLocalDatabaseUrl(url)) return false;
  const setting = sslSettingFromEnv(env);
  if (setting.mode === "insecure") {
    console.warn(
      "WARNING: DATABASE_SSL_REJECT_UNAUTHORIZED=false - the database certificate is NOT verified. Provide DATABASE_SSL_CA instead."
    );
  }
  return setting.ssl;
}

/** Removes sslmode= / ssl= query parameters from a connection string. */
export function stripSslParams(url: string): string {
  const at = url.indexOf("?");
  if (at < 0) return url;
  const base = url.slice(0, at);
  const kept = url
    .slice(at + 1)
    .split("&").filter((kv) => !/^(sslmode|ssl|sslrootcert|sslcert|sslkey)=/i.test(kv));
  return kept.length > 0 ? `${base}?${kept.join("&")}` : base;
}
