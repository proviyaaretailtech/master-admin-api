import { ErrorRequestHandler, Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { HTTPSTATUS } from "../config/http.config";
import { AppError } from "../utils/app-error";
import { ErrorCodeEnum } from "../enums/error-code.enum";
import { Env } from "../config/env.config";

const formatZodError = (res: Response, error: ZodError) => {
  const errors = error.issues.map((err) => ({
    field: err.path.join("."),
    message: err.message,
  }));

  return res.status(HTTPSTATUS.BAD_REQUEST).json({
    message: "Validation failed",
    errors,
    errorCode: ErrorCodeEnum.VALIDATION_ERROR,
  });
};

export const errorHandler: ErrorRequestHandler = (
  error: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  if (error instanceof ZodError) {
    formatZodError(res, error);
    return;
  }

  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      message: error.message,
      errorCode: error.errorCode,
    });
    return;
  }

  // Handle malformed JSON bodies (body-parser) as a client error, not a server fault
  if ((error as unknown as { type?: string }).type === "entity.parse.failed") {
    res.status(HTTPSTATUS.BAD_REQUEST).json({
      message: "Malformed JSON request body",
      errorCode: ErrorCodeEnum.VALIDATION_ERROR,
    });
    return;
  }

  // Handle body-parser entity too large (payload limit exceeded)
  if (
    (error as unknown as { type?: string; status?: number }).type === "entity.too.large" ||
    (error as unknown as { status?: number }).status === 413
  ) {
    res.status(HTTPSTATUS.PAYLOAD_TOO_LARGE).json({
      message: "Request payload too large. Maximum allowed size is 1MB.",
      errorCode: "PAYLOAD_TOO_LARGE",
    });
    return;
  }

  // Unexpected fault. The client only ever gets a generic message (database errors, SQL fragments and
  // stack traces stay on the server); the detail goes to the server log, except while testing.
  if (Env.NODE_ENV !== "test") {
    console.error("Unhandled error:", error);
  }
  res.status(HTTPSTATUS.INTERNAL_SERVER_ERROR).json({
    message: "Internal Server Error",
    errorCode: ErrorCodeEnum.INTERNAL_SERVER_ERROR,
    ...(Env.NODE_ENV === "development" ? { error: error.message, stack: error.stack } : {}),
  });
};
