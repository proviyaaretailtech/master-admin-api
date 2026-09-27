import { Request, Response, NextFunction } from "express";
import { UnauthorizedException, ForbiddenException } from "../utils/app-error";
import { verifyJwtToken } from "../utils/jwt";
import { query } from "../config/database.config";
import { UserModel } from "../@types/express";
import { permissionService } from "../services/permission.service";

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

    // Query user securely from Supabase users table
    const result = await query<UserModel>(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.phone_number,
              COALESCE(u.status, 'Active') as status,
              u.role_id,
              u.created_at, u.updated_at
       FROM users u
       WHERE u.id = $1
       LIMIT 1;`,
      [payload.userId]
    );

    if (result.rows.length === 0) {
      throw new UnauthorizedException("User account not found or deactivated");
    }

    const user = result.rows[0];

    // Verify account active status
    if (user.status && user.status.toLowerCase() !== "active") {
      throw new ForbiddenException("User account has been deactivated or suspended");
    }

    // Resolve user's role and permission matrix
    const { role, permissions, isSuperAdmin } =
      await permissionService.getUserPermissionsAndRole(user);
    user.role_details = role;
    user.permissions = permissions;
    user.isSuperAdmin = isSuperAdmin;

    req.user = user;
    req.token = token;
    req.permissions = permissions;
    req.userRole = role;
    req.isSuperAdmin = isSuperAdmin;

    next();
  } catch (error) {
    next(error);
  }
};
