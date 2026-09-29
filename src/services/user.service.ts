import { query } from "../config/database.config";
import { NotFoundException, BadRequestException, ForbiddenException } from "../utils/app-error";
import { UpdateUserInput, GetUsersQueryInput } from "../validators/user.validator";
import { UserModel } from "../@types/express";

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
      FROM users u
      LEFT JOIN security_roles sr ON u.role_id = sr.id
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
      FROM users u
      LEFT JOIN security_roles sr ON u.role_id = sr.id
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
       FROM users u
       LEFT JOIN security_roles sr ON u.role_id = sr.id
       WHERE u.id = $1
       LIMIT 1;`,
      [id]
    );

    if (result.rows.length === 0) {
      throw new NotFoundException("User not found");
    }

    return mapUserRowToModel(result.rows[0]);
  }

  /**
   * Updates an existing user with privilege escalation safeguards (Check 4: Fix 1)
   */
  async updateUser(id: string, data: UpdateUserInput, actor?: UserModel): Promise<UserModel> {
    // Check if target user exists
    const targetUser = await this.getUserById(id);

    // Security Fix 1A: Block self role changes (prevent users from elevating themselves)
    if (
      actor &&
      actor.id === id &&
      data.role_id !== undefined &&
      data.role_id !== targetUser.role_id
    ) {
      throw new ForbiddenException(
        "Privilege Escalation Prevention: You cannot modify your own security role"
      );
    }

    // Security Fix 1B: Prevent self-deactivation
    if (
      actor &&
      actor.id === id &&
      data.status !== undefined &&
      data.status.toLowerCase() !== "active"
    ) {
      throw new BadRequestException("You cannot deactivate or suspend your own account");
    }

    // Security Fix 1C: Prevent non-super-admins from editing a super admin account
    if (
      (targetUser.role_details?.key === "super_admin" || targetUser.isSuperAdmin) &&
      actor &&
      !actor.isSuperAdmin
    ) {
      throw new ForbiddenException(
        "Privilege Escalation Prevention: Only a Super Administrator can modify a Super Administrator account"
      );
    }

    // If email is being changed, ensure it's not taken by another user
    if (data.email) {
      const checkEmail = await query<{ id: string }>(
        "SELECT id FROM users WHERE email = $1 AND id != $2 LIMIT 1;",
        [data.email, id]
      );

      if (checkEmail.rows.length > 0) {
        throw new BadRequestException("This email address is already in use by another user");
      }
    }

    // Security Fix 1D: If role_id is provided, verify it exists and enforce power boundaries
    if (data.role_id) {
      const checkRole = await query<{ id: string; key: string; is_system: boolean }>(
        "SELECT id, key, is_system FROM security_roles WHERE id = $1 LIMIT 1;",
        [data.role_id]
      );
      if (checkRole.rows.length === 0) {
        throw new BadRequestException(`Security role with ID '${data.role_id}' does not exist`);
      }

      const assignedRole = checkRole.rows[0];
      // Disallow non-super-admins from assigning super_admin or system roles
      if (
        (assignedRole.key === "super_admin" || assignedRole.is_system) &&
        actor &&
        !actor.isSuperAdmin
      ) {
        throw new ForbiddenException(
          "Privilege Escalation Prevention: Only a Super Administrator can assign system or super admin roles"
        );
      }
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

    if (data.email !== undefined) {
      values.push(data.email.trim().toLowerCase());
      setClauses.push(`email = $${values.length}`);
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

    setClauses.push("updated_at = now()");

    values.push(id);
    const idIdx = values.length;

    const updateSql = `
      UPDATE users
      SET ${setClauses.join(", ")}
      WHERE id = $${idIdx}
      RETURNING id;
    `;

    const result = await query<{ id: string }>(updateSql, values);
    if (result.rows.length === 0) {
      throw new BadRequestException("Failed to update user");
    }

    // Return refreshed user model with joined security role
    return this.getUserById(id);
  }

  /**
   * Deletes a user by ID
   */
  async deleteUser(id: string): Promise<{ success: boolean; message: string }> {
    // Check if user exists
    await this.getUserById(id);

    await query("DELETE FROM users WHERE id = $1;", [id]);

    return {
      success: true,
      message: "User deleted successfully",
    };
  }
}

export const userService = new UserService();
