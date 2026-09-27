/**
 * Permission Adapter & Serializer
 * Converts between the frontend's rich FeaturePermission[] JSON array
 * and the database's compact multi-level delimited string:
 *   Format: module_id::access_level::action1$action2$$$module_id_2::access_level::action1
 */

export type AccessLevel = "none" | "read_only" | "full";

export interface GranularAction {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
}

export interface FeaturePermission {
  id: string;
  name: string;
  category: "partner_detail" | "organization" | "access_control" | "system";
  pagePath: string;
  description: string;
  accessLevel: AccessLevel;
  actions: GranularAction[];
}

export const DEFAULT_FEATURES_TEMPLATE: FeaturePermission[] = [
  {
    id: "feat_partner_review",
    name: "Partner Detail: Review Lifecycle Actions",
    category: "partner_detail",
    pagePath: "/organizations/:org_id",
    description:
      "Control whether this user can approve, reject, flag under review, or permanently delete partner organizations.",
    accessLevel: "full",
    actions: [
      {
        key: "approve_partner",
        label: "Approve Partner",
        description: "Authorize and approve onboarding application",
        enabled: true,
      },
      {
        key: "reject_partner",
        label: "Reject Partner",
        description: "Decline and reject onboarding application",
        enabled: true,
      },
      {
        key: "mark_under_review",
        label: "Mark Under Review",
        description: "Change status to Pending review",
        enabled: true,
      },
      {
        key: "delete_partner",
        label: "Delete Partner",
        description: "Permanently delete partner and all records",
        enabled: true,
      },
    ],
  },
  {
    id: "feat_partner_locations",
    name: "Partner Detail: Locations Management Table",
    category: "partner_detail",
    pagePath: "/organizations/:org_id",
    description:
      "Control access to the locations table in partner detail. Choose if it is read-only or if user can create/delete branches.",
    accessLevel: "full",
    actions: [
      {
        key: "view_locations",
        label: "View Locations Table",
        description: "Read-only access to outlets list and last sync status",
        enabled: true,
      },
      {
        key: "create_location",
        label: "Add New Location",
        description: "Create outlet records with auto-generated location codes",
        enabled: true,
      },
      {
        key: "edit_location",
        label: "Edit Location Details",
        description: "Update location area, type, timezone, and currency",
        enabled: true,
      },
      {
        key: "delete_location",
        label: "Delete Location",
        description: "Permanently remove a branch or operational outlet",
        enabled: true,
      },
    ],
  },
  {
    id: "feat_partner_docs",
    name: "Partner Detail: Documents & Verification",
    category: "partner_detail",
    pagePath: "/organizations/:org_id",
    description:
      "Manage access to PAN, Aadhaar, GST certificate, and license verification documents.",
    accessLevel: "full",
    actions: [
      {
        key: "view_docs",
        label: "View Uploaded Documents",
        description: "Inspect uploaded verification files and certificates",
        enabled: true,
      },
      {
        key: "verify_docs",
        label: "Verify & Approve Documents",
        description: "Mark KYC documents as approved or rejected",
        enabled: true,
      },
      {
        key: "edit_contact_info",
        label: "Edit Contact Information",
        description: "Modify partner email, phone number, and city details",
        enabled: true,
      },
    ],
  },
  {
    id: "feat_org_360",
    name: "Organization 360: Directory & Search",
    category: "organization",
    pagePath: "/organizations/360",
    description:
      "Access the global directory of partners, search by domain/status, and register new organizations.",
    accessLevel: "full",
    actions: [
      {
        key: "view_directory",
        label: "View Organizations Directory",
        description: "Browse partner directory with search and status filters",
        enabled: true,
      },
      {
        key: "create_org",
        label: "Register Organization",
        description: "Create new partner records via onboarding modal",
        enabled: true,
      },
      {
        key: "export_org_csv",
        label: "Export Organization Records",
        description: "Download filtered partner listings as CSV/Excel",
        enabled: true,
      },
    ],
  },
  {
    id: "feat_users_mgmt",
    name: "Access Control: Users Management",
    category: "access_control",
    pagePath: "/users",
    description:
      "Administer system accounts, invite staff members, and modify panel assignments and statuses.",
    accessLevel: "full",
    actions: [
      {
        key: "view_users",
        label: "View Staff Accounts",
        description: "Browse user accounts, panels, and activity states",
        enabled: true,
      },
      {
        key: "invite_user",
        label: "Invite / Add Staff",
        description: "Issue onboarding invitations for new staff users",
        enabled: true,
      },
      {
        key: "edit_user",
        label: "Edit Roles & Panels",
        description: "Change user access panel, role tier, and active status",
        enabled: true,
      },
      {
        key: "delete_user",
        label: "Delete Staff Account",
        description: "Revoke credentials and delete system accounts",
        enabled: true,
      },
    ],
  },
  {
    id: "feat_roles_templates",
    name: "Access Control: Roles & Permissions (Security Policies)",
    category: "access_control",
    pagePath: "/access-control/roles",
    description:
      "Configure role definitions, customize security policies, and manage feature-by-feature permission matrices.",
    accessLevel: "full",
    actions: [
      {
        key: "view_roles",
        label: "View Roles & Permissions",
        description: "Inspect role profiles, permissions matrix, and security policies",
        enabled: true,
      },
      {
        key: "create_roles",
        label: "Create Roles & Permissions",
        description: "Configure new role templates with customized permission matrix",
        enabled: true,
      },
      {
        key: "edit_roles",
        label: "Edit Roles & Permissions",
        description: "Modify authorization parameters, permissions matrix, and actions on existing roles",
        enabled: true,
      },
      {
        key: "delete_roles",
        label: "Delete Roles & Permissions",
        description: "Permanently delete custom role definitions",
        enabled: true,
      },
    ],
  },

  {
    id: "feat_audit_compliance",
    name: "Audit Trails & Security Logs",
    category: "system",
    pagePath: "/access-control/audit-logs",
    description:
      "Review platform audit logs, security authentication events, and data modification timestamps.",
    accessLevel: "full",
    actions: [
      {
        key: "view_audit_logs",
        label: "View Audit Event Logs",
        description: "Browse chronological security and change events",
        enabled: true,
      },
      {
        key: "export_audit_logs",
        label: "Export Security Audit CSV",
        description: "Download immutable audit logs for compliance review",
        enabled: true,
      },
    ],
  },
];

/**
 * Serializes frontend FeaturePermission[] into the compact DB string
 * e.g. "feat_partner_review::full::approve_partner$reject_partner$$$feat_locations::read_only::view_locations"
 */
export function serializeFeaturesToDb(features: FeaturePermission[]): string {
  if (!Array.isArray(features) || features.length === 0) {
    return "";
  }

  return features
    .map((feat) => {
      const enabledActions = (feat.actions || [])
        .filter((a) => a.enabled)
        .map((a) => a.key.trim())
        .join("$");
      const level = feat.accessLevel || "none";
      return `${feat.id}::${level}::${enabledActions}`;
    })
    .join("$$$");
}

/**
 * Deserializes the compact DB string back into the complete FeaturePermission[] array
 * with full UI labels and descriptions preserved.
 */
export function deserializeFeaturesFromDb(rawDbString: string): FeaturePermission[] {
  const savedState: Record<string, { level: AccessLevel; enabledActions: Set<string> }> = {};

  if (rawDbString && typeof rawDbString === "string") {
    const sections = rawDbString.split("$$$");
    for (const section of sections) {
      if (!section.trim()) continue;
      const [id, level, actionsStr] = section.split("::");
      if (id) {
        const actionKeys = actionsStr ? actionsStr.split("$").filter(Boolean) : [];
        savedState[id.trim()] = {
          level: (level?.trim() as AccessLevel) || "none",
          enabledActions: new Set(actionKeys),
        };
      }
    }
  }

  // Hydrate over the template so that UI labels and descriptions are always up-to-date
  return DEFAULT_FEATURES_TEMPLATE.map((baseFeat) => {
    const saved = savedState[baseFeat.id];
    if (!saved) {
      // Default to none if not configured in the role
      return {
        ...baseFeat,
        accessLevel: "none",
        actions: baseFeat.actions.map((act) => ({ ...act, enabled: false })),
      };
    }

    return {
      ...baseFeat,
      accessLevel: saved.level,
      actions: baseFeat.actions.map((act) => ({
        ...act,
        enabled: saved.enabledActions.has(act.key),
      })),
    };
  });
}
