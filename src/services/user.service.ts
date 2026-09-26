import { query } from "../config/database.config";
import { NotFoundException, BadRequestException } from "../utils/app-error";
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

export class UserService {
  /**
   * Retrieves paginated users with search and filtering
   */
  async getUsers(params: GetUsersQueryInput = { page: 1, limit: 9 }): Promise<PaginatedUsersResult> {
    const page = params.page && params.page > 0 ? params.page : 1;
    const limit = params.limit && params.limit > 0 ? params.limit : 9;
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const values: any[] = [];

    // Search filter across multiple columns
    if (params.search && params.search.trim().length > 0) {
      values.push(`%${params.search.trim()}%`);
      const idx = values.length;
      conditions.push(
        `(first_name ILIKE $${idx} OR last_name ILIKE $${idx} OR email ILIKE $${idx} OR phone_number ILIKE $${idx} OR panel ILIKE $${idx} OR role ILIKE $${idx})`
      );
    }

    // Role / Panel filter
    if (params.panel && params.panel !== "All Panels / Roles") {
      values.push(`%${params.panel.trim()}%`);
      const idx = values.length;
      conditions.push(`(panel ILIKE $${idx} OR role ILIKE $${idx})`);
    }

    // Status filter
    if (params.status && params.status !== "All Statuses") {
      values.push(params.status.trim());
      const idx = values.length;
      conditions.push(`status = $${idx}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Query total count
    const countSql = `SELECT COUNT(*)::int as total FROM users ${whereClause};`;
    const countResult = await query<{ total: number }>(countSql, values);
    const total = countResult.rows[0]?.total || 0;

    // Query paginated users
    values.push(limit);
    const limitIdx = values.length;
    values.push(offset);
    const offsetIdx = values.length;

    const dataSql = `
      SELECT id, first_name, last_name, email, phone_number,
             COALESCE(panel, 'admin') as panel,
             COALESCE(role, 'admin') as role,
             COALESCE(status, 'Active') as status,
             created_at, updated_at
      FROM users
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx};
    `;

    const result = await query<UserModel>(dataSql, values);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      users: result.rows,
      pagination: {
        total,
        page,
        limit,
        totalPages,
      },
    };
  }

  /**
   * Retrieves single user by ID
   */
  async getUserById(id: string): Promise<UserModel> {
    const result = await query<UserModel>(
      `SELECT id, first_name, last_name, email, phone_number,
              COALESCE(panel, 'admin') as panel,
              COALESCE(role, 'admin') as role,
              COALESCE(status, 'Active') as status,
              created_at, updated_at
       FROM users
       WHERE id = $1
       LIMIT 1;`,
      [id]
    );

    if (result.rows.length === 0) {
      throw new NotFoundException("User not found");
    }

    return result.rows[0];
  }

  /**
   * Updates an existing user
   */
  async updateUser(id: string, data: UpdateUserInput): Promise<UserModel> {
    // Check if user exists
    await this.getUserById(id);

    // If email is being changed, ensure it's not taken by another user
    if (data.email) {
      const checkEmail = await query<UserModel>(
        "SELECT id FROM users WHERE email = $1 AND id != $2 LIMIT 1;",
        [data.email, id]
      );

      if (checkEmail.rows.length > 0) {
        throw new BadRequestException("This email address is already in use by another user");
      }
    }

    const result = await query<UserModel>(
      `UPDATE users
       SET
         first_name = COALESCE($1, first_name),
         last_name = COALESCE($2, last_name),
         email = COALESCE($3, email),
         phone_number = COALESCE($4, phone_number),
         panel = COALESCE($5, panel),
         role = COALESCE($6, role),
         status = COALESCE($7, status),
         updated_at = now()
       WHERE id = $8
       RETURNING id, first_name, last_name, email, phone_number,
                 COALESCE(panel, 'admin') as panel,
                 COALESCE(role, 'admin') as role,
                 COALESCE(status, 'Active') as status,
                 created_at, updated_at;`,
      [
        data.first_name || null,
        data.last_name || null,
        data.email || null,
        data.phone_number || null,
        data.panel || null,
        data.role || null,
        data.status || null,
        id,
      ]
    );

    if (result.rows.length === 0) {
      throw new BadRequestException("Failed to update user");
    }

    return result.rows[0];
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
