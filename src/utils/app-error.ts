import { HTTPSTATUS, HttpStatusCodeType } from "../config/http.config";
import { ErrorCodeEnum, ErrorCodeEnumType } from "../enums/error-code.enum";

/** Enum codes plus snake_case domain codes (e.g. provider_not_configured, finance_wrong_state). */
export type ErrorCodeValue = ErrorCodeEnumType | (string & Record<never, never>);

export class AppError extends Error {
  public statusCode: HttpStatusCodeType;
  public errorCode?: ErrorCodeValue;

  constructor(
    message: string,
    statusCode: HttpStatusCodeType = HTTPSTATUS.INTERNAL_SERVER_ERROR,
    errorCode?: ErrorCodeValue
  ) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class HttpException extends AppError {
  constructor(
    message = "Http Exception Error",
    statusCode: HttpStatusCodeType,
    errorCode?: ErrorCodeValue
  ) {
    super(message, statusCode, errorCode);
  }
}

export class InternalServerException extends AppError {
  constructor(
    message = "Internal Server Error",
    errorCode: ErrorCodeEnumType = ErrorCodeEnum.INTERNAL_SERVER_ERROR
  ) {
    super(message, HTTPSTATUS.INTERNAL_SERVER_ERROR, errorCode);
  }
}

export class NotFoundException extends AppError {
  constructor(
    message = "Resource not found",
    errorCode: ErrorCodeValue = ErrorCodeEnum.RESOURCE_NOT_FOUND
  ) {
    super(message, HTTPSTATUS.NOT_FOUND, errorCode);
  }
}

export class BadRequestException extends AppError {
  constructor(
    message = "Bad Request",
    errorCode: ErrorCodeValue = ErrorCodeEnum.VALIDATION_ERROR
  ) {
    super(message, HTTPSTATUS.BAD_REQUEST, errorCode);
  }
}

export class UnauthorizedException extends AppError {
  constructor(
    message = "Unauthorized Access",
    errorCode: ErrorCodeEnumType = ErrorCodeEnum.AUTH_UNAUTHORIZED_ACCESS
  ) {
    super(message, HTTPSTATUS.UNAUTHORIZED, errorCode);
  }
}

export class ForbiddenException extends AppError {
  constructor(
    message = "Forbidden: Insufficient Permissions",
    errorCode: ErrorCodeValue = ErrorCodeEnum.ACCESS_UNAUTHORIZED
  ) {
    super(message, HTTPSTATUS.FORBIDDEN, errorCode);
  }
}

export class ConflictException extends AppError {
  constructor(message = "Conflict", errorCode: ErrorCodeValue = "conflict") {
    super(message, HTTPSTATUS.CONFLICT, errorCode);
  }
}

/** The external provider (CRM, CMS, gateway, dispatch service) is not configured or not reachable: 503. */
export class ProviderNotConfiguredException extends AppError {
  constructor(message = "This provider is not configured in this environment") {
    super(message, HTTPSTATUS.SERVICE_UNAVAILABLE, "provider_not_configured");
  }
}
