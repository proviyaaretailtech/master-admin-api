import { AppError } from "./app-error";
import { HTTPSTATUS, HttpStatusCodeType } from "../config/http.config";

/**
 * Database functions in this ecosystem raise "CODE: human message" (e.g. FINANCE_WRONG_STATE: settlement is paid).
 * This maps them to the API error shape {message, errorCode}: the code lower-cased, the status from its suffix.
 * Anything that is not such a coded business error (syntax errors, connection faults, SQL fragments) is
 * re-thrown untouched so the global handler answers a generic 500 and never leaks database text.
 */
const CODED = /^([A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+):\s*(.*)$/s;

function statusFor(code: string): HttpStatusCodeType {
  if (/(NOT_FOUND|MISSING)$/.test(code)) return HTTPSTATUS.NOT_FOUND;
  if (/(FORBIDDEN|DENIED|UNAUTHORIZED)$/.test(code)) return HTTPSTATUS.FORBIDDEN;
  if (/TOO_SOON$/.test(code)) return HTTPSTATUS.TOO_MANY_REQUESTS;
  if (/(WRONG_STATE|BAD_STATE|EXISTS|CONFLICT|BLOCKED|OPEN_ORDERS|IMMUTABLE|DUPLICATE|NOT_ALLOWED|ALREADY|TRANSITION|SUSPENDED|ARCHIVED|NOT_PENDING|TERMINAL|RIDER_BUSY|PLAN_LIMIT|KEY_LIMIT|DISABLED)/.test(code)) {
    return HTTPSTATUS.CONFLICT;
  }
  return HTTPSTATUS.BAD_REQUEST;
}

/** Converts a database error to an AppError when it is a coded business error or a constraint violation; else returns it as is. */
export function mapDbError(err: unknown): unknown {
  if (err instanceof AppError) return err;
  const e = err as { message?: string; code?: string; constraint?: string };
  const m = typeof e?.message === "string" ? CODED.exec(e.message) : null;
  if (m) return new AppError(m[2].trim() || m[1], statusFor(m[1]), m[1].toLowerCase());
  switch (e?.code) {
    case "23505":
      return new AppError("A record with these values already exists", HTTPSTATUS.CONFLICT, "duplicate");
    case "23503":
      return new AppError("A referenced record does not exist", HTTPSTATUS.BAD_REQUEST, "invalid_reference");
    case "23514":
      return new AppError("The values violate a business rule", HTTPSTATUS.BAD_REQUEST, "constraint_violation");
    case "22P02":
    case "22003":
    case "22007":
    case "22008":
      return new AppError("A value has an invalid format", HTTPSTATUS.BAD_REQUEST, "VALIDATION_ERROR");
    case "42501":
      return new AppError("This action is not permitted", HTTPSTATUS.FORBIDDEN, "forbidden");
    default:
      return err;
  }
}

/** Awaits a database call and maps coded errors. */
export async function db<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (err) {
    throw mapDbError(err);
  }
}
