import { query } from "../config/database.config";
import { NotFoundException, BadRequestException } from "../utils/app-error";
import { CreateRoleInput, UpdateRoleInput, GetRolesQuery } from "../validators/role.validator";
import {
  serializeFeaturesToDb,
  deserializeFeaturesFromDb,
  FeaturePermission,
} from "../utils/permission-adapter";

export interface RoleDto {
  id: string;
  name: string;
  key: string;
  scope: string;
  description: string;
  status: "Active" | "Inactive";
  isActive: boolean;
  isSystem: boolean;
  assignedCount: number;
  assignedText: string;
  features: FeaturePermission[];
  createdAt: string;
  updatedAt: string;
}

interface RoleDbRow {
  id: string;
  name: string;
  key: string;
  scope: string;
  description: string | null;
  is_active: boolean;
  is_system: boolean;
  permissions: string;
  assigned_count: number;
  created_at: string;
  updated_at: string;
}

function mapRowToDto(row: RoleDbRow): RoleDto {
  const count = Number(row.assigned_count) || 0;
  return {
    id: row.id,
    name: row.name,
    key: row.key,
    scope: row.scope,
    description: row.description || "",
    status: row.is_active ? "Active" : "Inactive",
    isActive: row.is_active,
    isSystem: row.is_system,
    assignedCount: count,
    assignedText: `${count} staff assigned`,
    features: deserializeFeaturesFromDb(row.permissions),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class RoleService {
  /**
   * Retrieves all security roles with search and scope filtering
   */
  async getRoles(queryInput: GetRolesQuery): Promise<{ roles: RoleDto[]; total: number }> {
    const whereConditions: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    // Search query
    if (queryInput.search && queryInput.search.trim()) {
      const q = `%${queryInput.search.trim()}%`;
      whereConditions.push(
        `(r.name ILIKE $${paramIndex} OR r.key ILIKE $${paramIndex} OR r.description ILIKE $${paramIndex} OR r.scope ILIKE $${paramIndex})`
      );
      values.push(q);
      paramIndex++;
    }

    // Scope filter
    if (queryInput.scope && queryInput.scope !== "All Scopes" && queryInput.scope.trim()) {
      whereConditions.push(`LOWER(r.scope) = LOWER($${paramIndex})`);
      values.push(queryInput.scope.trim());
      paramIndex++;
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : "";

    const sql = `
      SELECT 
        r.id, 
        r.name, 
        r.key, 
        r.scope, 
        r.description, 
        r.is_active, 
        r.is_system, 
        r.permissions, 
        r.created_at, 
        r.updated_at,
        COUNT(u.id)::int AS assigned_count
      FROM security_roles r
      LEFT JOIN users u ON u.role_id = r.id
      ${whereClause}
      GROUP BY r.id
      ORDER BY r.is_system DESC, r.created_at ASC;
    `;

    const result = await query<RoleDbRow>(sql, values);
    const roles = result.rows.map(mapRowToDto);

    return {
      roles,
      total: roles.length,
    };
  }

  /**
   * Retrieves a single role by UUID
   */
  async getRoleById(id: string): Promise<RoleDto> {
    const sql = `
      SELECT 
        r.id, 
        r.name, 
        r.key, 
        r.scope, 
        r.description, 
        r.is_active, 
        r.is_system, 
        r.permissions, 
        r.created_at, 
        r.updated_at,
        COUNT(u.id)::int AS assigned_count
      FROM security_roles r
      LEFT JOIN users u ON u.role_id = r.id
      WHERE r.id = $1
      GROUP BY r.id
      LIMIT 1;
    `;

    const result = await query<RoleDbRow>(sql, [id]);
    if (result.rows.length === 0) {
      throw new NotFoundException(`Security role with ID '${id}' was not found`);
    }

    return mapRowToDto(result.rows[0]);
  }

  /**
   * Creates a new role and serializes features into the delimited DB string
   */
  async createRole(data: CreateRoleInput): Promise<RoleDto> {
    const keyNormalized = data.key.trim().toLowerCase();
    const nameTrimmed = data.name.trim();

    // Check unique key
    const existing = await query<{ id: string }>(
      "SELECT id FROM security_roles WHERE key = $1 LIMIT 1;",
      [keyNormalized]
    );
    if (existing.rows.length > 0) {
      throw new BadRequestException(`A security role with key '${keyNormalized}' already exists`);
    }

    // Check unique role name (case-insensitive)
    const existingName = await query<{ id: string }>(
      "SELECT id FROM security_roles WHERE LOWER(name) = LOWER($1) LIMIT 1;",
      [nameTrimmed]
    );
    if (existingName.rows.length > 0) {
      throw new BadRequestException(`A security role with name '${nameTrimmed}' already exists`);
    }

    // Serialize features to $$$::format
    const permissionsString = serializeFeaturesToDb(data.features);

    const insertSql = `
      INSERT INTO security_roles (name, key, scope, description, is_active, is_system, permissions)
      VALUES ($1, $2, $3, $4, $5, false, $6)
      RETURNING 
        id, 
        name, 
        key, 
        scope, 
        description, 
        is_active, 
        is_system, 
        permissions, 
        created_at, 
        updated_at,
        0 AS assigned_count;
    `;

    const result = await query<RoleDbRow>(insertSql, [
      data.name.trim(),
      keyNormalized,
      data.scope.trim(),
      data.description?.trim() || "",
      data.isActive !== undefined ? data.isActive : true,
      permissionsString,
    ]);

    return mapRowToDto(result.rows[0]);
  }

  /**
   * Updates an existing role
   */
  async updateRole(id: string, data: UpdateRoleInput): Promise<RoleDto> {
    // Check if role exists
    const existing = await query<RoleDbRow>("SELECT * FROM security_roles WHERE id = $1 LIMIT 1;", [
      id,
    ]);
    if (existing.rows.length === 0) {
      throw new NotFoundException(`Security role with ID '${id}' was not found`);
    }

    const current = existing.rows[0];

    if (data.name !== undefined) {
      const nameTrimmed = data.name.trim();
      const existingName = await query<{ id: string }>(
        "SELECT id FROM security_roles WHERE LOWER(name) = LOWER($1) AND id != $2 LIMIT 1;",
        [nameTrimmed, id]
      );
      if (existingName.rows.length > 0) {
        throw new BadRequestException(`A security role with name '${nameTrimmed}' already exists`);
      }
    }

    const updatedName = data.name !== undefined ? data.name.trim() : current.name;
    const updatedScope = data.scope !== undefined ? data.scope.trim() : current.scope;
    const updatedDescription =
      data.description !== undefined ? data.description.trim() : current.description || "";
    const updatedIsActive = data.isActive !== undefined ? data.isActive : current.is_active;

    const updatedPermissions =
      data.features !== undefined ? serializeFeaturesToDb(data.features) : current.permissions;

    const updateSql = `
      UPDATE security_roles
      SET 
        name = $1,
        scope = $2,
        description = $3,
        is_active = $4,
        permissions = $5,
        updated_at = now()
      WHERE id = $6
      RETURNING 
        id, 
        name, 
        key, 
        scope, 
        description, 
        is_active, 
        is_system, 
        permissions, 
        created_at, 
        updated_at;
    `;

    const result = await query<RoleDbRow>(updateSql, [
      updatedName,
      updatedScope,
      updatedDescription,
      updatedIsActive,
      updatedPermissions,
      id,
    ]);

    // Fetch assigned count
    const countResult = await query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM users WHERE role_id = $1;",
      [id]
    );
    const assignedCount = countResult.rows[0]?.count || 0;

    return mapRowToDto({
      ...result.rows[0],
      assigned_count: assignedCount,
    });
  }

  /**
   * Deletes a role (blocks deletion of is_system baseline roles)
   */
  async deleteRole(id: string): Promise<{ id: string; name: string }> {
    const existing = await query<RoleDbRow>(
      "SELECT id, name, is_system FROM security_roles WHERE id = $1 LIMIT 1;",
      [id]
    );
    if (existing.rows.length === 0) {
      throw new NotFoundException(`Security role with ID '${id}' was not found`);
    }

    if (existing.rows[0].is_system) {
      throw new BadRequestException("System baseline roles are protected and cannot be deleted");
    }

    // Unassign any users currently assigned to this role before deleting
    await query("UPDATE users SET role_id = NULL WHERE role_id = $1;", [id]);

    await query("DELETE FROM security_roles WHERE id = $1;", [id]);

    return { id, name: existing.rows[0].name };
  }
}

export const roleService = new RoleService();
