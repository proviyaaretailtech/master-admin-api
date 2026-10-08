import { createHash, createHmac, randomUUID } from "crypto";
import { AppError, ProviderNotConfiguredException } from "../../utils/app-error";
import { HttpStatusCodeType } from "../../config/http.config";

/**
 * Client for the One Local dispatch API (server to server). Requests are signed exactly as
 * RIDER_DISPATCH_API.md section 2 describes:
 *   Authorization: Bearer <DISPATCH_SERVICE_TOKEN>
 *   X-Timestamp:   unix seconds
 *   X-Signature:   hex HMAC-SHA256(DISPATCH_SIGNING_SECRET, METHOD "\n" path-and-query "\n" timestamp "\n" sha256hex(body))
 *   Idempotency-Key on every POST
 * Environment (names only; values are never logged or returned):
 *   DISPATCH_API_URL, DISPATCH_SERVICE_TOKEN, DISPATCH_SIGNING_SECRET
 * Missing configuration or an unreachable service answers 503 provider_not_configured.
 */
export interface DispatchConfig {
  baseUrl: string;
  token: string;
  secret: string;
}

export function dispatchConfig(env: NodeJS.ProcessEnv = process.env): DispatchConfig | null {
  const baseUrl = (env.DISPATCH_API_URL ?? "").trim().replace(/\/+$/, "");
  const token = (env.DISPATCH_SERVICE_TOKEN ?? "").trim();
  const secret = (env.DISPATCH_SIGNING_SECRET ?? "").trim();
  return baseUrl && token && secret ? { baseUrl, token, secret } : null;
}

/** The string that is signed: method, path with query exactly as called, timestamp, sha256 of the raw body. */
export function signingString(method: string, pathAndQuery: string, timestamp: string, rawBody: string): string {
  return `${method.toUpperCase()}\n${pathAndQuery}\n${timestamp}\n${createHash("sha256").update(rawBody).digest("hex")}`;
}

export function sign(secret: string, method: string, pathAndQuery: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", secret).update(signingString(method, pathAndQuery, timestamp, rawBody)).digest("hex");
}

const TIMEOUT_MS = 8000;

export async function dispatchRequest<T = Record<string, unknown>>(
  method: "GET" | "POST",
  pathAndQuery: string,
  body?: Record<string, unknown>,
  idempotencyKey?: string
): Promise<T> {
  const cfg = dispatchConfig();
  if (!cfg) throw new ProviderNotConfiguredException("The dispatch service is not configured in this environment");

  const rawBody = method === "GET" ? "" : JSON.stringify(body ?? {});
  const timestamp = String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.token}`,
    "X-Request-Id": randomUUID(),
    "X-Timestamp": timestamp,
    "X-Signature": sign(cfg.secret, method, pathAndQuery, timestamp, rawBody),
  };
  if (method === "POST") {
    headers["Content-Type"] = "application/json";
    headers["Idempotency-Key"] = idempotencyKey && /^[\w:.-]{8,200}$/.test(idempotencyKey) ? idempotencyKey : `master:${randomUUID()}`;
  }

  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}${pathAndQuery}`, {
      method,
      headers,
      body: method === "GET" ? undefined : rawBody,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ProviderNotConfiguredException("The dispatch service is unreachable");
  }

  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = {};
  }
  if (res.ok) return json as T;

  const code = typeof json.code === "string" ? json.code : "dispatch_error";
  const detail = typeof json.detail === "string" ? json.detail : typeof json.message === "string" ? json.message : "The dispatch service refused the request";
  if (res.status >= 500) {
    if (code === "not_configured") throw new ProviderNotConfiguredException("The dispatch service is not configured");
    throw new AppError("The dispatch service failed", 502 as HttpStatusCodeType, "dispatch_upstream_error");
  }
  if (res.status === 401) throw new AppError("The dispatch service rejected the control-plane credential", 502 as HttpStatusCodeType, "dispatch_credential_rejected");
  throw new AppError(detail, (res.status === 404 ? 404 : res.status === 409 ? 409 : res.status === 403 ? 403 : 400) as HttpStatusCodeType, code);
}
