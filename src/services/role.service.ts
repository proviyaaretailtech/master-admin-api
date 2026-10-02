import { query, queryAs } from "../config/database.config";
import { NotFoundException, BadRequestException, ForbiddenException } from "../utils/app-error";
import { Actor, assertWithinActorPermissions } from "../utils/authz";
import { CreateRoleInput, UpdateRoleInput, GetRolesQuery } from "../validators/role.validator";
import {
  serializeFeaturesToDb,
  deserializeFeaturesFromDb,
  canonicalizeFeatures,
  FeaturePermission,
} from "../utils/permission-adapter";

/** Only the permissions that are actually granted are stored (a "none" feature is the default). */
const serializeGranted = (features: FeaturePermission[]): string =>
  serializeFeaturesToDb(features.filter((f) => f.accessLevel !== "none"));

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
        COUNT(u.user_id)::int AS assigned_count
      FROM platform_roles r
      LEFT JOIN platform_admins u ON u.role_id = r.id
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
        COUNT(u.user_id)::int AS assigned_count
      FROM platform_roles r
      LEFT JOIN platform_admins u ON u.role_id = r.id
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
   * Creates a new role and serializes features into the delimited DB string.
   * A non-super actor can only create roles whose permissions are a subset of their own.
   */
  async createRole(data: CreateRoleInput, actor: Actor): Promise<RoleDto> {
    const keyNormalized = data.key.trim().toLowerCase();
    const nameTrimmed = data.name.trim();

    const features = canonicalizeFeatures(data.features);
    assertWithinActorPermissions(actor, features, "create a role");

    // Check unique key
    const existing = await query<{ id: string }>(
      "SELECT id FROM platform_roles WHERE key = $1 LIMIT 1;",
      [keyNormalized]
    );
    if (existing.rows.length > 0) {
      throw new BadRequestException(`A security role with key '${keyNormalized}' already exists`);
    }

    // Check unique role name (case-insensitive)
    const existingName = await query<{ id: string }>(
      "SELECT id FROM platform_roles WHERE LOWER(name) = LOWER($1) LIMIT 1;",
      [nameTrimmed]
    );
    if (existingName.rows.length > 0) {
      throw new BadRequestException(`A security role with name '${nameTrimmed}' already exists`);
    }

    // Serialize features to $$$::format
    const permissionsString = serializeGranted(features);

    const insertSql = `
      INSERT INTO platform_roles (name, key, scope, description, is_active, is_system, permissions)
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

    let result;
    try {
      result = await queryAs<RoleDbRow>(actor.id, insertSql, [
        data.name.trim(),
        keyNormalized,
        data.scope.trim(),
        data.description?.trim() || "",
        data.isActive !== undefined ? data.isActive : true,
        permissionsString,
      ]);
    } catch (err) {
      // Two concurrent requests can both pass the checks above; the unique indexes are the final word.
      if ((err as { code?: string })?.code === "23505") {
        throw new BadRequestException("A security role with this key or name already exists");
      }
      throw err;
    }

    return mapRowToDto(result.rows[0]);
  }

  /**
   * Updates an existing role.
   *  - the Super Admin role is immutable, and system roles can only be edited by a Super Admin;
   *  - nobody edits their own role;
   *  - a non-super actor may only touch a role whose current permissions AND new permissions are a
   *    subset of their own (so edit_roles can never be used to grant oneself or others more power,
   *    or to rename/deactivate a role stronger than the actor's).
   */
  async updateRole(id: string, data: UpdateRoleInput, actor: Actor): Promise<RoleDto> {
    // Check if role exists
    const existing = await query<RoleDbRow>("SELECT * FROM platform_roles WHERE id = $1 LIMIT 1;", [
      id,
    ]);
    if (existing.rows.length === 0) {
      throw new NotFoundException(`Security role with ID '${id}' was not found`);
    }

    const current = existing.rows[0];

    if (current.key === "super_admin") {
      throw new ForbiddenException("The Super Admin role is protected and cannot be edited");
    }
    if (actor.roleId && actor.roleId === id) {
      throw new ForbiddenException("Privilege Escalation Prevention: you cannot edit your own role");
    }
    if (current.is_system && !actor.isSuperAdmin) {
      throw new ForbiddenException("Only a Super Administrator can edit a system role");
    }
    assertWithinActorPermissions(
      actor,
      deserializeFeaturesFromDb(current.permissions),
      "edit a role that grants more than you hold"
    );
    const newFeatures = data.features !== undefined ? canonicalizeFeatures(data.features) : undefined;
    if (newFeatures) {
      assertWithinActorPermissions(actor, newFeatures, "grant these permissions");
    }

    if (data.name !== undefined) {
      const nameTrimmed = data.name.trim();
      const existingName = await query<{ id: string }>(
        "SELECT id FROM platform_roles WHERE LOWER(name) = LOWER($1) AND id != $2 LIMIT 1;",
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

    const updatedPermissions = newFeatures ? serializeGranted(newFeatures) : current.permissions;

    const updateSql = `
      UPDATE platform_roles
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

    const result = await queryAs<RoleDbRow>(actor.id, updateSql, [
      updatedName,
      updatedScope,
      updatedDescription,
      updatedIsActive,
      updatedPermissions,
      id,
    ]);

    // Fetch assigned count
    const countResult = await query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM platform_admins WHERE role_id = $1;",
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
  async deleteRole(id: string, actor: Actor): Promise<{ id: string; name: string }> {
    const existing = await query<RoleDbRow>(
      "SELECT id, name, key, is_system, permissions FROM platform_roles WHERE id = $1 LIMIT 1;",
      [id]
    );
    if (existing.rows.length === 0) {
      throw new NotFoundException(`Security role with ID '${id}' was not found`);
    }

    if (existing.rows[0].is_system || existing.rows[0].key === "super_admin") {
      throw new BadRequestException("System baseline roles are protected and cannot be deleted");
    }
    if (actor.roleId && actor.roleId === id) {
      throw new ForbiddenException("Privilege Escalation Prevention: you cannot delete your own role");
    }
    // Deleting a role strips every holder of it: only someone who holds at least that much may do so.
    assertWithinActorPermissions(
      actor,
      deserializeFeaturesFromDb(existing.rows[0].permissions),
      "delete a role that grants more than you hold"
    );

    // Unassign any users currently assigned to this role before deleting
    await queryAs(actor.id, "UPDATE platform_admins SET role_id = NULL WHERE role_id = $1;", [id]);

    await queryAs(actor.id, "DELETE FROM platform_roles WHERE id = $1;", [id]);

    return { id, name: existing.rows[0].name };
  }
}

export const roleService = new RoleService();
