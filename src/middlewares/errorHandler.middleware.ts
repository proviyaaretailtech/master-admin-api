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
  if (Env.NODE_ENV === "development") {
    console.error("Error caught by errorHandler middleware:", error);
  }

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

  res.status(HTTPSTATUS.INTERNAL_SERVER_ERROR).json({
    message: "Internal Server Error",
    errorCode: ErrorCodeEnum.INTERNAL_SERVER_ERROR,
    ...(Env.NODE_ENV === "development" ? { error: error.message, stack: error.stack } : {}),
  });
};
