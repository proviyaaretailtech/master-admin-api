import { query } from "../config/database.config";
import { supabaseClient } from "../config/supabase.config";
import { UnauthorizedException, ForbiddenException } from "../utils/app-error";
import { LoginInput } from "../validators/auth.validator";
import { UserModel } from "../@types/express";

/**
 * Platform staff are Supabase auth users with an Active row in platform_admins. Sign-in is done by
 * Supabase Auth (passwords never touch this app); the access token it returns is the bearer token.
 * There is no public registration: accounts are created by an existing administrator (user.service)
 * or by the bootstrap script.
 */
export class AuthService {
  async login(data: LoginInput) {
    const { data: session, error } = await supabaseClient.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    });
    if (error || !session.session || !session.user) {
      throw new UnauthorizedException("Invalid email or password");
    }

    const staff = await this.findPlatformAdmin(session.user.id);
    if (!staff) {
      throw new ForbiddenException("This account does not have access to the control plane");
    }
    if (staff.status !== "Active") {
      throw new UnauthorizedException("User account has been deactivated or suspended");
    }

    await query("UPDATE platform_admins SET last_login_at = now() WHERE user_id = $1;", [staff.id]);

    const user = await this.hydrate(staff);
    return { user, token: session.session.access_token };
  }

  /** Returns the authenticated user's profile with permissions. */
  async getMe(user: UserModel) {
    if (!user.permissions || !user.role_details || user.isSuperAdmin === undefined) {
      return this.hydrate(user);
    }
    return user;
  }

  /** Loads a platform admin (joined with the auth user's email and role) by auth user id. */
  async findPlatformAdmin(userId: string): Promise<UserModel | null> {
    const res = await query<UserModel>(
      `SELECT pa.user_id AS id, COALESCE(pa.first_name, '') AS first_name, COALESCE(pa.last_name, '') AS last_name,
              au.email, COALESCE(pa.phone_number, '') AS phone_number, pa.status, pa.role_id,
              pa.created_at, pa.updated_at
         FROM platform_admins pa
         JOIN auth.users au ON au.id = pa.user_id
        WHERE pa.user_id = $1
        LIMIT 1;`,
      [userId]
    );
    return res.rows[0] ?? null;
  }

  async hydrate(user: UserModel): Promise<UserModel> {
    const { permissionService } = await import("./permission.service");
    const { role, permissions, isSuperAdmin } = await permissionService.getUserPermissionsAndRole(user);
    return { ...user, role_details: role, permissions, isSuperAdmin };
  }
}

export const authService = new AuthService();
