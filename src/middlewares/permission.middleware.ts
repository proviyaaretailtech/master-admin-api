import { Request, Response, NextFunction } from "express";
import { ForbiddenException, UnauthorizedException } from "../utils/app-error";
import { AccessLevel, FeaturePermission } from "../utils/permission-adapter";
import { permissionService } from "../services/permission.service";
import { requireAuth } from "./auth.middleware";

export interface PermissionCheckOption {
  featureId: string;
  action?: string;
  minimumLevel?: AccessLevel;
}

/**
 * Middleware that ensures the authenticated user has permission to access a specific feature and action.
 * If requireAuth hasn't already been run on the request, it invokes requireAuth first.
 */
export const requirePermission = (
  featureId: string,
  requiredAction?: string,
  minimumLevel: AccessLevel = "read_only"
) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        await new Promise<void>((resolve, reject) => {
          requireAuth(req, res, (err) => {
            if (err) return reject(err);
            resolve();
          });
        });
      }

      if (!req.user) {
        throw new UnauthorizedException("Authentication required to access this resource");
      }

      // Check if permissions are already resolved and attached
      let permissions = req.permissions;
      let isSuperAdmin = false;

      if (!permissions) {
        const result = await permissionService.getUserPermissionsAndRole(req.user);
        permissions = result.permissions;
        isSuperAdmin = result.isSuperAdmin;
        req.permissions = permissions;
        req.userRole = result.role;
        req.isSuperAdmin = isSuperAdmin;
      } else {
        isSuperAdmin = req.isSuperAdmin ?? req.userRole?.key === "super_admin";
      }

      // Super Admins possess unrestricted bypass
      if (isSuperAdmin) {
        return next();
      }

      // Evaluate permission against feature and granular action
      const hasAccess = permissionService.hasPermission(
        permissions,
        featureId,
        requiredAction,
        minimumLevel,
        isSuperAdmin
      );

      if (!hasAccess) {
        const actionMsg = requiredAction ? ` (action '${requiredAction}')` : "";
        throw new ForbiddenException(
          `Access Denied: Missing required permission for feature '${featureId}'${actionMsg}`
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Middleware that allows access if the authenticated user has ANY of the specified permission options.
 */
export const requireAnyPermission = (requirements: PermissionCheckOption[]) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        await new Promise<void>((resolve, reject) => {
          requireAuth(req, res, (err) => {
            if (err) return reject(err);
            resolve();
          });
        });
      }

      if (!req.user) {
        throw new UnauthorizedException("Authentication required to access this resource");
      }

      let permissions = req.permissions;
      let isSuperAdmin = false;

      if (!permissions) {
        const result = await permissionService.getUserPermissionsAndRole(req.user);
        permissions = result.permissions;
        isSuperAdmin = result.isSuperAdmin;
        req.permissions = permissions;
        req.userRole = result.role;
        req.isSuperAdmin = isSuperAdmin;
      } else {
        isSuperAdmin = req.isSuperAdmin ?? req.userRole?.key === "super_admin";
      }

      if (isSuperAdmin) {
        return next();
      }

      const hasAny = requirements.some((reqOption) =>
        permissionService.hasPermission(
          permissions!,
          reqOption.featureId,
          reqOption.action,
          reqOption.minimumLevel || "read_only",
          isSuperAdmin
        )
      );

      if (!hasAny) {
        throw new ForbiddenException(
          "Access Denied: You do not possess the required permissions to access this endpoint"
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Resolves the required partner review action for a given organization status.
 * - 'Approved' / 'Active' -> 'approve_partner'
 * - 'Rejected' / 'Suspended' / 'Inactive' -> 'reject_partner'
 * - 'Pending' / 'Draft':
 *     - on update: 'mark_under_review'
 *     - on create: null (allowed by default for users with create_org permission)
 */
export const getRequiredPartnerReviewActionForStatus = (
  status: string,
  isCreate: boolean = false
): string | null => {
  const statusLower = String(status).toLowerCase();
  if (statusLower === "approved" || statusLower === "active") {
    return "approve_partner";
  }
  if (statusLower === "rejected" || statusLower === "suspended" || statusLower === "inactive") {
    return "reject_partner";
  }
  if (statusLower === "pending" || statusLower === "draft") {
    return isCreate ? null : "mark_under_review";
  }
  return isCreate ? null : "mark_under_review";
};

/**
 * Validates that the user's permissions allow transitioning or creating an organization with the given status.
 * Reused across requireOrganizationUpdatePermission and requireOrganizationCreatePermission.
 */
export const validateOrganizationStatusPermission = (
  permissions: FeaturePermission[],
  status: string,
  isCreate: boolean = false
): void => {
  const requiredAction = getRequiredPartnerReviewActionForStatus(status, isCreate);
  if (!requiredAction) {
    return;
  }

  const hasAction = permissionService.hasPermission(
    permissions,
    "feat_partner_review",
    requiredAction,
    "full",
    false
  );

  if (!hasAction) {
    throw new ForbiddenException(
      `Access Denied: Missing required permission for partner review action '${requiredAction}'`
    );
  }
};

/**
 * Middleware that strictly validates permissions when creating an organization.
 * - Requires feat_org_360 -> 'create_org' (full access).
 * - If a status other than 'Draft' or 'Pending' is sent on create, requires the same
 *   permission as on update:
 *     - 'Approved' / 'Active' -> 'approve_partner'
 *     - 'Rejected' / 'Suspended' / 'Inactive' -> 'reject_partner'
 * - Super Admins bypass checks.
 */
export const requireOrganizationCreatePermission = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      await new Promise<void>((resolve, reject) => {
        requireAuth(req, res, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
    }

    if (!req.user) {
      throw new UnauthorizedException("Authentication required to access this resource");
    }

    let permissions = req.permissions;
    let isSuperAdmin = false;

    if (!permissions) {
      const result = await permissionService.getUserPermissionsAndRole(req.user);
      permissions = result.permissions;
      isSuperAdmin = result.isSuperAdmin;
      req.permissions = permissions;
      req.userRole = result.role;
      req.isSuperAdmin = isSuperAdmin;
    } else {
      isSuperAdmin = req.isSuperAdmin ?? req.userRole?.key === "super_admin";
    }

    if (isSuperAdmin) {
      return next();
    }

    // 1. Must possess feat_org_360 -> create_org
    const hasCreateOrg = permissionService.hasPermission(
      permissions!,
      "feat_org_360",
      "create_org",
      "full",
      false
    );

    if (!hasCreateOrg) {
      throw new ForbiddenException(
        "Access Denied: Missing required permission for feature 'feat_org_360' (action 'create_org')"
      );
    }

    // 2. Validate status permission if status is specified on create
    const body = req.body || {};
    if (body.status !== undefined) {
      validateOrganizationStatusPermission(permissions!, body.status, true);
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Middleware that strictly validates permissions when modifying an organization.
 * - Changing status requires corresponding feat_partner_review actions:
 *   - 'Approved' / 'Active' -> 'approve_partner'
 *   - 'Rejected' / 'Suspended' / 'Inactive' -> 'reject_partner'
 *   - 'Pending' / 'Draft' -> 'mark_under_review'
 * - Changing business info (business_name, domain, email, phone_number) requires:
 *   - feat_partner_docs -> 'edit_contact_info' (full access)
 * - Super Admins bypass checks.
 */
export const requireOrganizationUpdatePermission = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      await new Promise<void>((resolve, reject) => {
        requireAuth(req, res, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
    }

    if (!req.user) {
      throw new UnauthorizedException("Authentication required to access this resource");
    }

    let permissions = req.permissions;
    let isSuperAdmin = false;

    if (!permissions) {
      const result = await permissionService.getUserPermissionsAndRole(req.user);
      permissions = result.permissions;
      isSuperAdmin = result.isSuperAdmin;
      req.permissions = permissions;
      req.userRole = result.role;
      req.isSuperAdmin = isSuperAdmin;
    } else {
      isSuperAdmin = req.isSuperAdmin ?? req.userRole?.key === "super_admin";
    }

    if (isSuperAdmin) {
      return next();
    }

    const body = req.body || {};

    // 1. Validate status transition permission
    if (body.status !== undefined) {
      validateOrganizationStatusPermission(permissions!, body.status, false);
    }

    // 2. Validate contact / profile info modification permission
    const hasContactFields =
      body.business_name !== undefined ||
      body.domain !== undefined ||
      body.email !== undefined ||
      body.phone_number !== undefined;

    if (hasContactFields) {
      const hasEditContact = permissionService.hasPermission(
        permissions!,
        "feat_partner_docs",
        "edit_contact_info",
        "full",
        false
      );

      if (!hasEditContact) {
        throw new ForbiddenException(
          "Access Denied: Missing required permission for feature 'feat_partner_docs' (action 'edit_contact_info')"
        );
      }
    }

    // 3. If neither status nor contact fields provided in body, require at least one edit privilege
    if (body.status === undefined && !hasContactFields) {
      const canEditContact = permissionService.hasPermission(
        permissions!,
        "feat_partner_docs",
        "edit_contact_info",
        "full",
        false
      );
      const canReview =
        permissionService.hasPermission(
          permissions!,
          "feat_partner_review",
          "approve_partner",
          "full",
          false
        ) ||
        permissionService.hasPermission(
          permissions!,
          "feat_partner_review",
          "reject_partner",
          "full",
          false
        ) ||
        permissionService.hasPermission(
          permissions!,
          "feat_partner_review",
          "mark_under_review",
          "full",
          false
        );

      if (!canEditContact && !canReview) {
        throw new ForbiddenException(
          "Access Denied: You do not possess permission to update this organization"
        );
      }
    }

    next();
  } catch (error) {
    next(error);
  }
};
