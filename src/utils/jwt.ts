import jwt, { JwtPayload, SignOptions } from "jsonwebtoken";
import { Env } from "../config/env.config";

export interface AccessTokenPayload {
  userId: string;
  email: string;
}

export const signJwtToken = (
  payload: AccessTokenPayload,
  options?: SignOptions
): string => {
  return jwt.sign(payload, Env.JWT_SECRET, {
    expiresIn: (Env.JWT_EXPIRES_IN as any) || "7d",
    ...options,
  });
};

export const verifyJwtToken = (token: string): AccessTokenPayload => {
  return jwt.verify(token, Env.JWT_SECRET) as AccessTokenPayload;
};
