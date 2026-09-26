import { Request, Response, NextFunction } from "express";
import { UnauthorizedException } from "../utils/app-error";
import { verifyJwtToken } from "../utils/jwt";
import { query } from "../config/database.config";
import { UserModel } from "../@types/express";

export const requireAuth = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    let token: string | undefined;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    } else if (req.cookies && req.cookies["token"]) {
      token = req.cookies["token"];
    }

    if (!token) {
      throw new UnauthorizedException("Authentication token is missing");
    }

    let payload: { userId: string; email: string };
    try {
      payload = verifyJwtToken(token);
    } catch {
      throw new UnauthorizedException("Invalid or expired authentication token");
    }

    // Query user securely from Supabase users table using parameterized query
    const result = await query<UserModel>(
      `SELECT id, first_name, last_name, email, phone_number, created_at, updated_at
       FROM users
       WHERE id = $1
       LIMIT 1;`,
      [payload.userId]
    );

    if (result.rows.length === 0) {
      throw new UnauthorizedException("User account not found or deactivated");
    }

    req.user = result.rows[0];
    req.token = token;
    next();
  } catch (error) {
    next(error);
  }
};
