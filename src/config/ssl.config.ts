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

const PEM_BLOCK = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g;

/**
 * Rebuilds PEM text that a dashboard flattened (line breaks turned into spaces, or literal "\n").
 * Each certificate's base64 body is re-wrapped at 64 characters; text without a certificate is returned as is.
 */
export function normalizePem(raw: string): string {
  const text = raw.replace(/\\n/g, "\n").trim();
  const blocks = [...text.matchAll(PEM_BLOCK)].map((m) => {
    const body = m[1].replace(/\s+/g, "");
    return `-----BEGIN CERTIFICATE-----\n${body.match(/.{1,64}/g)?.join("\n") ?? ""}\n-----END CERTIFICATE-----`;
  });
  return blocks.length ? blocks.join("\n") + "\n" : text;
}

const looksLikePem = (v: string) => v.includes("-----BEGIN CERTIFICATE-----");

function readCaFile(path: string): string {
  try {
    return fs.readFileSync(path, "utf8");
  } catch {
    // Hosted builds do not ship certs/ (it is gitignored): say what to set instead of a bare ENOENT.
    throw new Error(
      `DATABASE_SSL_CA_FILE points to ${path}, which is not in this deployment. Put the certificate text in DATABASE_SSL_CA instead.`
    );
  }
}

export function sslSettingFromEnv(env: NodeJS.ProcessEnv): SslSetting {
  let ca = (env.DATABASE_SSL_CA || "").trim();
  const caFile = (env.DATABASE_SSL_CA_FILE || "").trim();
  // The certificate pasted into the path setting is accepted as the certificate itself.
  if (!ca && caFile) ca = looksLikePem(caFile) ? caFile : readCaFile(caFile);
  if (ca) ca = normalizePem(ca);
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
