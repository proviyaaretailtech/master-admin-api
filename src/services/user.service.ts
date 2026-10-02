import { query, queryAs } from "../config/database.config";
import { supabaseAdmin } from "../config/supabase.config";
import { NotFoundException, BadRequestException, ForbiddenException } from "../utils/app-error";
import { UpdateUserInput, GetUsersQueryInput, CreateUserInput } from "../validators/user.validator";
import { UserModel } from "../@types/express";
import { Actor, assertWithinActorPermissions } from "../utils/authz";
import { deserializeFeaturesFromDb, FeaturePermission } from "../utils/permission-adapter";

interface RoleRow {
  id: string;
  key: string;
  is_system: boolean;
  is_active: boolean;
  permissions: string;
}

/** Supabase client-class errors (4xx) are safe to show; anything else becomes a generic message. */
function safeAuthMessage(error: { message?: string; status?: number } | null | undefined, fallback: string): string {
  const status = error?.status;
  return error?.message && typeof status === "number" && status >= 400 && status < 500 ? error.message : fallback;
}

/**
 * Tables whose rows hang off an auth login (cascading or nulling on delete). A login that appears in any of
 * them is shared with another application (restaurant POS, rider app, customer app): it must not be
 * deleted or have its email rewritten from the control plane.
 */
const IDENTITY_USAGE: Array<[table: string, column: string]> = [
  ["org_users", "user_id"],
  ["riders", "user_id"],
  ["ol_partner_devices", "user_id"],
  ["ol_orders", "user_id"],
];

export interface PaginatedUsersResult {
  users: UserModel[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

interface UserDbRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone_number: string;
  status: string;
  role_id: string | null;
  role_name?: string | null;
  role_key?: string | null;
  role_scope?: string | null;
  role_description?: string | null;
  role_is_active?: boolean | null;
  role_is_system?: boolean | null;
  created_at: string;
  updated_at: string;
}

function mapUserRowToModel(row: UserDbRow): UserModel {
  return {
    id: row.id,
    first_name: row.first_name,
    last_name: row.last_name,
    email: row.email,
    phone_number: row.phone_number,
    status: row.status,
    role_id: row.role_id,
    role_name: row.role_name || undefined,
    role_key: row.role_key || undefined,
    role_scope: row.role_scope || undefined,
    role_details:
      row.role_id && row.role_name
        ? {
            id: row.role_id,
            name: row.role_name,
            key: row.role_key || "",
            scope: row.role_scope || "",
            description: row.role_description || "",
            is_active: row.role_is_active ?? true,
            is_system: row.role_is_system ?? false,
          }
        : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class UserService {
  /**
   * Retrieves paginated users with search and filtering by security role
   */
  async getUsers(
    params: GetUsersQueryInput = { page: 1, limit: 9 }
  ): Promise<PaginatedUsersResult> {
    const page = params.page && params.page > 0 ? params.page : 1;
    const limit = params.limit && params.limit > 0 ? params.limit : 9;
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const values: any[] = [];

    // Search filter across first name, last name, email, phone, and role name
    if (params.search && params.search.trim().length > 0) {
      values.push(`%${params.search.trim()}%`);
      const idx = values.length;
      conditions.push(
        `(u.first_name ILIKE $${idx} OR u.last_name ILIKE $${idx} OR u.email ILIKE $${idx} OR u.phone_number ILIKE $${idx} OR sr.name ILIKE $${idx})`
      );
    }

    // Role filter
    if (
      params.role_id &&
      params.role_id !== "All Roles" &&
      params.role_id !== "All Security Roles" &&
      params.role_id !== "All Panels / Roles"
    ) {
      values.push(params.role_id.trim());
      const idx = values.length;
      conditions.push(`(u.role_id::text = $${idx} OR sr.key = $${idx} OR sr.name ILIKE $${idx})`);
    }

    // Status filter
    if (params.status && params.status !== "All Statuses" && params.status !== "All") {
      values.push(params.status.trim());
      const idx = values.length;
      conditions.push(`u.status = $${idx}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Total count query
    const countSql = `
      SELECT COUNT(u.id)::int as total
      FROM (SELECT pa.user_id AS id, pa.first_name, pa.last_name, au.email, pa.phone_number, pa.status, pa.role_id, pa.created_at, pa.updated_at
              FROM platform_admins pa JOIN auth.users au ON au.id = pa.user_id) u
      LEFT JOIN platform_roles sr ON u.role_id = sr.id
      ${whereClause};
    `;
    const countResult = await query<{ total: number }>(countSql, values);
    const total = countResult.rows[0]?.total || 0;

    // Paginated users query
    values.push(limit);
    const limitIdx = values.length;
    values.push(offset);
    const offsetIdx = values.length;

    const dataSql = `
      SELECT u.id, u.first_name, u.last_name, u.email, u.phone_number,
             COALESCE(u.status, 'Active') as status,
             u.role_id,
             sr.name as role_name,
             sr.key as role_key,
             sr.scope as role_scope,
             sr.description as role_description,
             sr.is_active as role_is_active,
             sr.is_system as role_is_system,
             u.created_at, u.updated_at
      FROM (SELECT pa.user_id AS id, COALESCE(pa.first_name, '') AS first_name, COALESCE(pa.last_name, '') AS last_name, au.email,
                   COALESCE(pa.phone_number, '') AS phone_number, pa.status, pa.role_id, pa.created_at, pa.updated_at
              FROM platform_admins pa JOIN auth.users au ON au.id = pa.user_id) u
      LEFT JOIN platform_roles sr ON u.role_id = sr.id
      ${whereClause}
      ORDER BY u.created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx};
    `;

    const result = await query<UserDbRow>(dataSql, values);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      users: result.rows.map(mapUserRowToModel),
      pagination: {
        total,
        page,
        limit,
        totalPages,
      },
    };
  }

  /**
   * Retrieves single user by ID joined with security role details
   */
  async getUserById(id: string): Promise<UserModel> {
    const result = await query<UserDbRow>(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.phone_number,
              COALESCE(u.status, 'Active') as status,
              u.role_id,
              sr.name as role_name,
              sr.key as role_key,
              sr.scope as role_scope,
              sr.description as role_description,
              sr.is_active as role_is_active,
              sr.is_system as role_is_system,
              u.created_at, u.updated_at
       FROM (SELECT pa.user_id AS id, COALESCE(pa.first_name, '') AS first_name, COALESCE(pa.last_name, '') AS last_name, au.email,
                    COALESCE(pa.phone_number, '') AS phone_number, pa.status, pa.role_id, pa.created_at, pa.updated_at
               FROM platform_admins pa JOIN auth.users au ON au.id = pa.user_id) u
       LEFT JOIN platform_roles sr ON u.role_id = sr.id
       WHERE u.id = $1
       LIMIT 1;`,
      [id]
    );

    if (result.rows.length === 0) {
      throw new NotFoundException("User not found");
    }

    return mapUserRowToModel(result.rows[0]);
  }

  private async loadRole(roleId: string): Promise<RoleRow | null> {
    const r = await query<RoleRow>(
      "SELECT id, key, is_system, is_active, permissions FROM platform_roles WHERE id = $1 LIMIT 1;",
      [roleId]
    );
    return r.rows[0] ?? null;
  }

  /** The permissions a staff member's role grants (empty when they have no role). */
  private async permissionsOfRole(roleId: string | null | undefined): Promise<FeaturePermission[]> {
    if (!roleId) return [];
    const role = await this.loadRole(roleId);
    return role ? deserializeFeaturesFromDb(role.permissions) : [];
  }

  /**
   * A role may be assigned only if it exists, is active, is not a system / Super Admin role (unless the
   * actor is a Super Admin) and grants no more than the actor holds themselves.
   */
  private async assertRoleAssignable(actor: Actor, roleId: string): Promise<void> {
    const role = await this.loadRole(roleId);
    if (!role) {
      throw new BadRequestException(`Security role with ID '${roleId}' does not exist`);
    }
    if ((role.key === "super_admin" || role.is_system) && !actor.isSuperAdmin) {
      throw new ForbiddenException(
        "Privilege Escalation Prevention: Only a Super Administrator can assign system or super admin roles"
      );
    }
    if (!role.is_active) {
      throw new BadRequestException("This security role is inactive and cannot be assigned");
    }
    assertWithinActorPermissions(actor, deserializeFeaturesFromDb(role.permissions), "assign this role");
  }

  /**
   * Staff administration is hierarchical: a non-super actor can only modify or delete a staff account whose
   * role grants no more than the actor's own (so edit_user / delete_user cannot be used against a stronger
   * administrator). Only a Super Administrator can touch a Super Administrator.
   */
  private async assertCanManage(actor: Actor, target: UserModel): Promise<void> {
    if (actor.isSuperAdmin) return;
    if (target.role_details?.key === "super_admin") {
      throw new ForbiddenException(
        "Privilege Escalation Prevention: Only a Super Administrator can modify a Super Administrator account"
      );
    }
    if (target.id === actor.id) return;
    assertWithinActorPermissions(
      actor,
      await this.permissionsOfRole(target.role_id),
      "modify a staff account whose role grants more than you hold"
    );
  }

  private async otherActiveSuperCount(excludingUserId: string): Promise<number> {
    const supers = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM platform_admins pa JOIN platform_roles r ON r.id = pa.role_id
        WHERE r.key = 'super_admin' AND r.is_active AND pa.status = 'Active' AND pa.user_id <> $1;`,
      [excludingUserId]
    );
    return supers.rows[0]?.n ?? 0;
  }

  /** True when this login is also used by another application (see IDENTITY_USAGE). */
  private async isSharedIdentity(userId: string): Promise<boolean> {
    for (const [table, column] of IDENTITY_USAGE) {
      try {
        const r = await query(`SELECT 1 FROM ${table} WHERE ${column} = $1 LIMIT 1;`, [userId]);
        if (r.rows.length > 0) return true;
      } catch (err) {
        if ((err as { code?: string })?.code !== "42P01") throw err; // table absent in this deployment
      }
    }
    return false;
  }

  /**
   * Creates a platform staff account (Supabase auth user + platform_admins row). Only an administrator
   * who may manage users reaches this; the assigned role must be active, must not be a system / Super Admin
   * role unless the actor is a Super Administrator, and may not grant more than the actor holds.
   */
  async createUser(data: CreateUserInput, actor: Actor): Promise<UserModel> {
    if (data.role_id) {
      await this.assertRoleAssignable(actor, data.role_id);
    }

    const email = data.email.trim().toLowerCase();
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
    });
    if (error || !created.user) {
      throw new BadRequestException(safeAuthMessage(error, "Could not create the account"));
    }

    try {
      await queryAs(
        actor.id,
        `INSERT INTO platform_admins (user_id, role_id, first_name, last_name, phone_number, status)
         VALUES ($1, $2, $3, $4, $5, 'Active');`,
        [created.user.id, data.role_id ?? null, data.first_name.trim(), data.last_name.trim(), data.phone_number?.trim() ?? null]
      );
    } catch (err) {
      await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      throw err;
    }
    return this.getUserById(created.user.id);
  }

  /**
   * Updates an existing user with privilege escalation safeguards.
   */
  async updateUser(id: string, data: UpdateUserInput, actor: Actor): Promise<UserModel> {
    // Check if target user exists
    const targetUser = await this.getUserById(id);
    const isSelf = actor.id === id;

    // Block self role changes (prevent users from elevating themselves)
    if (isSelf && data.role_id !== undefined && data.role_id !== targetUser.role_id) {
      throw new ForbiddenException(
        "Privilege Escalation Prevention: You cannot modify your own security role"
      );
    }

    // Prevent self-deactivation
    if (isSelf && data.status !== undefined && data.status.toLowerCase() !== "active") {
      throw new BadRequestException("You cannot deactivate or suspend your own account");
    }

    // Hierarchy: only a Super Administrator can edit a Super Administrator, and nobody can edit a staff
    // account whose role grants more than their own.
    await this.assertCanManage(actor, targetUser);

    // The platform must never be left without an active Super Administrator.
    if (
      data.status !== undefined &&
      data.status.toLowerCase() !== "active" &&
      targetUser.role_details?.key === "super_admin" &&
      (targetUser.status ?? "").toLowerCase() === "active" &&
      (await this.otherActiveSuperCount(id)) === 0
    ) {
      throw new ForbiddenException("The last active Super Administrator cannot be deactivated");
    }

    // Email change: the login is a global identity confirmed without a mail to the old address, so it is
    // only allowed within the hierarchy above and never for a login shared with another application.
    const emailChanging =
      data.email !== undefined && data.email.trim().toLowerCase() !== (targetUser.email ?? "").toLowerCase();
    if (emailChanging) {
      const taken = await query<{ id: string }>(
        "SELECT id FROM auth.users WHERE lower(email) = lower($1) AND id != $2 LIMIT 1;",
        [data.email, id]
      );
      if (taken.rows.length > 0) {
        throw new BadRequestException("This email address is already in use by another user");
      }
      if (await this.isSharedIdentity(id)) {
        throw new ForbiddenException(
          "This login is also used by another application, so its email cannot be changed from the control plane"
        );
      }
    }

    // Role assignment (only when it actually changes)
    if (data.role_id && data.role_id !== targetUser.role_id) {
      await this.assertRoleAssignable(actor, data.role_id);
    }

    // Build dynamic UPDATE query
    const setClauses: string[] = [];
    const values: any[] = [];

    if (data.first_name !== undefined) {
      values.push(data.first_name.trim());
      setClauses.push(`first_name = $${values.length}`);
    }

    if (data.last_name !== undefined) {
      values.push(data.last_name.trim());
      setClauses.push(`last_name = $${values.length}`);
    }

    if (data.phone_number !== undefined) {
      values.push(data.phone_number.trim());
      setClauses.push(`phone_number = $${values.length}`);
    }

    if (data.status !== undefined) {
      values.push(data.status);
      setClauses.push(`status = $${values.length}`);
    }

    if (data.role_id !== undefined) {
      values.push(data.role_id);
      setClauses.push(`role_id = $${values.length}`);
    }

    if (emailChanging) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(id, {
        email: data.email!.trim().toLowerCase(),
        email_confirm: true,
      });
      if (error) {
        throw new BadRequestException(safeAuthMessage(error, "Could not change the email"));
      }
    }

    if (setClauses.length > 0) {
      setClauses.push("updated_at = now()");
      values.push(id);
      const result = await queryAs<{ user_id: string }>(
        actor.id,
        `UPDATE platform_admins SET ${setClauses.join(", ")} WHERE user_id = $${values.length} RETURNING user_id;`,
        values
      );
      if (result.rows.length === 0) {
        throw new BadRequestException("Failed to update user");
      }
    }

    // Return refreshed user model with joined security role
    return this.getUserById(id);
  }

  /**
   * Deletes a staff account. Nobody can delete themselves; only a Super Administrator can delete a Super
   * Administrator (and never the last active one); a non-super actor can only delete staff whose role grants
   * no more than their own. A login that is also used by another application (restaurant, rider, customer)
   * is NOT deleted - only its platform access is removed.
   */
  async deleteUser(id: string, actor: Actor): Promise<{ success: boolean; message: string }> {
    const target = await this.getUserById(id);

    if (actor.id === id) {
      throw new ForbiddenException("You cannot delete your own account");
    }
    await this.assertCanManage(actor, target);

    if (
      target.role_details?.key === "super_admin" &&
      (target.status ?? "").toLowerCase() === "active" &&
      (await this.otherActiveSuperCount(id)) === 0
    ) {
      throw new ForbiddenException("The last active Super Administrator cannot be deleted");
    }

    if (await this.isSharedIdentity(id)) {
      await queryAs(actor.id, "DELETE FROM platform_admins WHERE user_id = $1;", [id]);
      return {
        success: true,
        message:
          "Platform access removed. The login itself was kept because it is also used by another application.",
      };
    }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
    if (error) throw new BadRequestException(safeAuthMessage(error, "Could not delete the user"));

    return {
      success: true,
      message: "User deleted successfully",
    };
  }
}

export const userService = new UserService();
