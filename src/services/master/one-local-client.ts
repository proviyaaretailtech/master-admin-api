import { randomUUID } from "crypto";
import { AppError, ProviderNotConfiguredException } from "../../utils/app-error";
import { HttpStatusCodeType } from "../../config/http.config";

/**
 * Client for the One Local admin API (/api/admin/*, One Local backend server/admin.ts, contract docs/MASTER_CONTRACT_V1.md).
 * The Master calls it server to server with the signed-in staff member's own Supabase access token (same Supabase
 * project), so every change goes through One Local's own checks: One Local accepts an Active platform_admins row whose
 * role is super_admin, and refuses everyone else with 403.
 * Environment (name only): ONE_LOCAL_API_URL, the One Local backend origin. Missing or unreachable -> 503 provider_not_configured.
 */
export function oneLocalBaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const url = (env.ONE_LOCAL_API_URL ?? "").trim().replace(/\/+$/, "");
  return url || null;
}

const TIMEOUT_MS = 15000;

export async function oneLocalAdminRequest<T = Record<string, unknown>>(
  method: "GET" | "POST" | "PUT",
  path: string,
  accessToken: string,
  body?: Record<string, unknown>
): Promise<T> {
  const base = oneLocalBaseUrl();
  if (!base) throw new ProviderNotConfiguredException("One Local is not connected in this environment (ONE_LOCAL_API_URL)");
  if (!accessToken) throw new AppError("Sign in again to continue", 401 as HttpStatusCodeType, "session_expired");

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-Request-Id": randomUUID(),
        ...(method !== "GET" ? { "Content-Type": "application/json" } : {}),
      },
      body: method !== "GET" ? JSON.stringify(body ?? {}) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ProviderNotConfiguredException("One Local is unreachable right now");
  }

  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = {};
  }
  if (res.ok) return json as T;

  // One Local errors are { detail, code } (server/admin.ts); `detail` is the sentence for people.
  const detail = typeof json.detail === "string" ? json.detail : "One Local refused the request";
  if (res.status === 401) throw new AppError("One Local did not accept your session. Sign in again.", 502 as HttpStatusCodeType, "one_local_session_rejected");
  if (res.status === 403) throw new AppError(detail, 403 as HttpStatusCodeType, "one_local_forbidden");
  if (res.status === 404) throw new AppError(detail, 404 as HttpStatusCodeType, "one_local_not_found");
  if (res.status === 409) throw new AppError(detail, 409 as HttpStatusCodeType, "one_local_conflict");
  if (res.status === 429) throw new AppError(detail, 429 as HttpStatusCodeType, "one_local_rate_limited");
  if (res.status >= 500) {
    if (res.status === 503) throw new ProviderNotConfiguredException(detail);
    throw new AppError("One Local failed to complete the request", 502 as HttpStatusCodeType, "one_local_upstream_error");
  }
  throw new AppError(detail, 400 as HttpStatusCodeType, "one_local_bad_request");
}
