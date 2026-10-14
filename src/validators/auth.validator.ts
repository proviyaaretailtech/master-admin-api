import { z } from "zod";
import { passwordSchema } from "./common.validator";

export const loginSchema = z.object({
  email: z.string().trim().email("Please provide a valid email address").toLowerCase(),
  password: z.string().min(1, "Password is required"),
});

export type LoginInput = z.infer<typeof loginSchema>;

/** POST /auth/logout: "local" ends this session only, "global" ends every session of the account. */
export const logoutSchema = z.object({ scope: z.enum(["local", "global"]).default("local") });

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email("Please provide a valid email address").toLowerCase().max(255),
});

export const resetPasswordSchema = z.object({
  // The recovery access token Supabase put in the reset link (URL fragment). A JWT, so bounded.
  accessToken: z.string().trim().min(1, "This reset link is invalid or has expired").max(4096),
  password: passwordSchema,
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
