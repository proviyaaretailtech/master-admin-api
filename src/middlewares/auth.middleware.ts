import { Request, Response, NextFunction } from "express";
import { UnauthorizedException, ForbiddenException } from "../utils/app-error";
import { supabaseClient } from "../config/supabase.config";
import { authService } from "../services/auth.service";

/**
 * Requires a valid Supabase access token belonging to an Active platform administrator.
 */
export const requireAuth = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : undefined;
    if (!token) {
      throw new UnauthorizedException("Authentication token is missing");
    }

    const { data, error } = await supabaseClient.auth.getUser(token);
    if (error || !data.user) {
      throw new UnauthorizedException("Invalid or expired authentication token");
    }

    const staff = await authService.findPlatformAdmin(data.user.id);
    if (!staff) {
      throw new ForbiddenException("This account does not have access to the control plane");
    }
    if ((staff.status ?? "").toLowerCase() !== "active") {
      throw new ForbiddenException("User account has been deactivated or suspended");
    }

    const user = await authService.hydrate(staff);
    req.user = user;
    req.token = token;
    req.permissions = user.permissions;
    req.userRole = user.role_details;
    req.isSuperAdmin = user.isSuperAdmin;
    next();
  } catch (error) {
    next(error);
  }
};
