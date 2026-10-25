import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Every caller of the Master server is one of our own servers, and each has its own key (one key per
 * server, never shared): a leaked key is rotated for that server alone, and every request is attributed
 * to the server that made it. Browsers never call the Master server; they call their own app's server,
 * which forwards here with its key in `x-internal-key`.
 *
 *  - admin-web: the Master Admin panel's own proxy (master-admin-web, /_s/*). Staff routes only.
 *  - customer / partner / rider / pos: the app servers. /internal/* routes only.
 *
 * Only SHA-256 digests are kept in memory; comparison is constant time against every configured key.
 */
export const INTERNAL_CALLERS = ["admin-web", "customer", "partner", "rider", "pos"] as const;
export type InternalCaller = (typeof INTERNAL_CALLERS)[number];

export const INTERNAL_KEY_ENV: Record<InternalCaller, string> = {
  "admin-web": "INTERNAL_KEY_ADMIN_WEB",
  customer: "INTERNAL_KEY_CUSTOMER",
  partner: "INTERNAL_KEY_PARTNER",
  rider: "INTERNAL_KEY_RIDER",
  pos: "INTERNAL_KEY_POS",
};

/** A key shorter than this is treated as unset (generate with `openssl rand -hex 32`). */
export const MIN_INTERNAL_KEY_LENGTH = 32;

export interface InternalKey {
  caller: InternalCaller;
  digest: Buffer;
}

const digestOf = (value: string): Buffer => createHash("sha256").update(value, "utf8").digest();

export function internalKeysFromEnv(env: NodeJS.ProcessEnv): InternalKey[] {
  const keys: InternalKey[] = [];
  for (const caller of INTERNAL_CALLERS) {
    const value = (env[INTERNAL_KEY_ENV[caller]] || "").trim();
    if (value.length >= MIN_INTERNAL_KEY_LENGTH) keys.push({ caller, digest: digestOf(value) });
  }
  return keys;
}

/** The caller a presented key belongs to, or null. Every configured key is compared, match or not. */
export function identifyCaller(presented: string | undefined, keys: InternalKey[]): InternalCaller | null {
  if (!presented || presented.length > 512) return null;
  const digest = digestOf(presented.trim());
  let found: InternalCaller | null = null;
  for (const key of keys) {
    if (timingSafeEqual(digest, key.digest) && found === null) found = key.caller;
  }
  return found;
}
