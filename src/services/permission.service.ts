import { query } from "../config/database.config";
import { UserModel } from "../@types/express";
import {
  FeaturePermission,
  AccessLevel,
  DEFAULT_FEATURES_TEMPLATE,
  deserializeFeaturesFromDb,
} from "../utils/permission-adapter";

export interface SecurityRoleRecord {
  id: string;
  name: string;
  key: string;
  scope: string;
  description: string;
  is_active: boolean;
  is_system: boolean;
  permissions: string;
}

export interface UserPermissionsResult {
  role: Omit<SecurityRoleRecord, "permissions"> | null;
  permissions: FeaturePermission[];
  isSuperAdmin: boolean;
}

export class PermissionService {
  /**
   * Resolves the user's role and associated feature permissions from the database.
   */
  async getUserPermissionsAndRole(user: UserModel): Promise<UserPermissionsResult> {
    // Permissions and access are resolved exclusively from user.role_id and security_roles
    if (user.role_id) {
      const res = await query<SecurityRoleRecord>(
        `SELECT id, name, key, scope, description, is_active, is_system, permissions
         FROM security_roles
         WHERE id = $1
         LIMIT 1;`,
        [user.role_id]
      );

      if (res.rows.length > 0) {
        const row = res.rows[0];
        const permissions = deserializeFeaturesFromDb(row.permissions);
        const isSuperAdmin = row.key === "super_admin";

        const { permissions: _, ...roleSummary } = row;
        return {
          role: roleSummary,
          permissions,
          isSuperAdmin,
        };
      }
    }

    // Default: restricted permissions when no valid role_id is assigned
    return {
      role: null,
      permissions: [],
      isSuperAdmin: false,
    };
  }

  /**
   * Helper function to check if a permission set authorizes a specific feature and action.
   */
  hasPermission(
    permissions: FeaturePermission[],
    featureId: string,
    actionKey?: string,
    minimumLevel: AccessLevel = "read_only",
    isSuperAdmin = false
  ): boolean {
    if (isSuperAdmin) {
      return true;
    }

    const feature = permissions.find((f) => f.id === featureId);
    if (!feature || feature.accessLevel === "none") {
      return false;
    }

    if (minimumLevel === "full" && feature.accessLevel !== "full") {
      return false;
    }

    if (actionKey) {
      const action = feature.actions?.find((a) => a.key === actionKey);
      return !!action?.enabled;
    }

    return true;
  }
}

export const permissionService = new PermissionService();
