import { query } from "../config/database.config";
import { supabaseClient, supabaseAdmin } from "../config/supabase.config";
import { Env } from "../config/env.config";
import { UnauthorizedException, ForbiddenException, BadRequestException } from "../utils/app-error";
import { LoginInput, ResetPasswordInput } from "../validators/auth.validator";
import { UserModel } from "../@types/express";

/** What the browser keeps: the short-lived access token (body) and the refresh token (httpOnly cookie). */
export interface IssuedSession {
  token: string;
  /** Access-token expiry, seconds since the epoch (Supabase's expires_at). */
  expiresAt: number | null;
  refreshToken: string | null;
}

const RESET_LINK_INVALID = "This reset link is invalid or has expired. Request a new one.";

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
    if ((staff.status ?? "").toLowerCase() !== "active") {
      throw new UnauthorizedException("User account has been deactivated or suspended");
    }

    await query("UPDATE platform_admins SET last_login_at = now() WHERE user_id = $1;", [staff.id]);

    const user = await this.hydrate(staff);
    return { user, ...issued(session.session) };
  }

  /**
   * Exchanges a refresh token for a new session (Supabase grant_type=refresh_token; the refresh token is
   * rotated) and re-checks that the account is still an Active platform administrator, exactly as every
   * request does (auth.middleware). A deactivated admin cannot keep a session alive by refreshing: the
   * new session is revoked at once.
   */
  async refresh(refreshToken: string | undefined): Promise<IssuedSession> {
    if (!refreshToken) {
      throw new UnauthorizedException("Your session has ended. Please sign in again.");
    }
    const { data, error } = await supabaseClient.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session || !data.user) {
      throw new UnauthorizedException("Your session has ended. Please sign in again.");
    }

    const staff = await this.findPlatformAdmin(data.user.id);
    if (!staff || (staff.status ?? "").toLowerCase() !== "active") {
      await this.logout(data.session.access_token, "local");
      throw staff
        ? new ForbiddenException("User account has been deactivated or suspended")
        : new ForbiddenException("This account does not have access to the control plane");
    }
    return issued(data.session);
  }

  /**
   * Ends the session behind an access token. "local" = this session only; "global" = every session of
   * the account (sign out everywhere). Best effort: a failure to revoke is logged, never surfaced.
   */
  async logout(token?: string, scope: "local" | "global" = "local"): Promise<boolean> {
    if (!token) return false;
    try {
      const { error } = (await supabaseAdmin.auth.admin.signOut(token, scope)) ?? {};
      if (error) {
        console.warn(`Could not revoke the session on logout (${scope}):`, error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.warn(`Could not revoke the session on logout (${scope}):`, (err as Error)?.message);
      return false;
    }
  }

  /**
   * Starts a password reset. Only an Active platform administrator gets an email; the caller cannot tell
   * the difference (the controller answers the same way, and the email is sent in the background so the
   * response time does not reveal it either). The link opens `<redirectTo>` with a recovery token.
   */
  async requestPasswordReset(email: string, redirectTo: string): Promise<void> {
    const res = await query<{ status: string }>(
      `SELECT pa.status
         FROM platform_admins pa
         JOIN auth.users au ON au.id = pa.user_id
        WHERE lower(au.email) = lower($1)
        LIMIT 1;`,
      [email]
    );
    const row = res.rows[0];
    if (!row || (row.status ?? "").toLowerCase() !== "active") return;

    // Not awaited: Supabase POST /auth/v1/recover (the implicit flow puts the token in the URL fragment).
    void supabaseClient.auth
      .resetPasswordForEmail(email, { redirectTo })
      .then(({ error }) => {
        if (error) console.warn("Password reset email could not be sent:", error.message);
      })
      .catch((err: unknown) => console.warn("Password reset email could not be sent:", (err as Error)?.message));
  }

  /**
   * Sets a new password with the recovery token from the reset link (Supabase PUT /auth/v1/user with
   * that token), then ends every session of the account so a stolen session cannot outlive the reset.
   */
  async resetPassword(data: ResetPasswordInput): Promise<void> {
    const { data: who, error } = await supabaseClient.auth.getUser(data.accessToken);
    if (error || !who.user) {
      throw new UnauthorizedException(RESET_LINK_INVALID);
    }
    const staff = await this.findPlatformAdmin(who.user.id);
    if (!staff || (staff.status ?? "").toLowerCase() !== "active") {
      throw new UnauthorizedException(RESET_LINK_INVALID);
    }

    const response = await fetch(`${Env.SUPABASE_URL.replace(/\/+$/, "")}/auth/v1/user`, {
      method: "PUT",
      headers: {
        apikey: Env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${data.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password: data.password }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error_code?: string; msg?: string; message?: string };
      if (response.status === 401 || response.status === 403) {
        throw new UnauthorizedException(RESET_LINK_INVALID);
      }
      if (body.error_code === "same_password") {
        throw new BadRequestException("Choose a password different from your current one", "same_password");
      }
      if (body.error_code === "weak_password") {
        throw new BadRequestException("This password is too weak. Choose a longer, less common password", "weak_password");
      }
      console.warn("Password update failed:", response.status, body.error_code ?? body.msg ?? body.message);
      throw new BadRequestException("The password could not be changed. Request a new reset link and try again.");
    }

    await this.logout(data.accessToken, "global");
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

function issued(session: { access_token: string; refresh_token?: string; expires_at?: number }): IssuedSession {
  return {
    token: session.access_token,
    expiresAt: typeof session.expires_at === "number" ? session.expires_at : null,
    refreshToken: session.refresh_token || null,
  };
}
