/**
 * Permission Adapter & Serializer
 * Converts between the frontend's rich FeaturePermission[] JSON array
 * and the database's compact multi-level delimited string:
 *   Format: module_id::access_level::action1$action2$$$module_id_2::access_level::action1
 */

import { BadRequestException } from "./app-error";

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
  category:
    | "commercials"
    | "partner_detail"
    | "organization"
    | "access_control"
    | "system"
    | "operations"
    | "finance"
    | "platform";
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
      {
        key: "manage_ordering",
        label: "Pause / Resume Ordering",
        description: "Stop or resume an organization accepting orders",
        enabled: true,
      },
      {
        key: "suspend_org",
        label: "Suspend / Reactivate Organization",
        description: "Suspend an organization (shuts it out) or reactivate it",
        enabled: true,
      },
      {
        key: "archive_org",
        label: "Archive / Restore Organization",
        description: "Archive an organization with no open orders, or restore it",
        enabled: true,
      },
    ],
  },
  {
    id: "feat_commercial_plans",
    name: "Commercials: Platform Plans & Modules",
    category: "commercials",
    pagePath: "/commercials/plans",
    description:
      "Control access to SaaS tier pricing, provisioning quotas (locations & user limits), platform module bundle selections, draft revisions, and live plan publishing.",
    accessLevel: "full",
    actions: [
      {
        key: "view_plans",
        label: "View Platform Plans",
        description:
          "Browse the SaaS plans table, inspect pricing, filter by currency/status, and view assigned tenant counts",
        enabled: true,
      },
      {
        key: "create_plan",
        label: "Create New Plan",
        description:
          "Access the plan creation wizard, configure initial tier name, billing cadence, and trial periods",
        enabled: true,
      },
      {
        key: "edit_plan",
        label: "Edit Plan & Limits",
        description:
          "Modify plan pricing, update hard provision limits (max locations, admin seats), and change effective dates",
        enabled: true,
      },
      {
        key: "manage_modules",
        label: "Configure Included Modules",
        description: "Select or deselect platform modules bundled into a plan",
        enabled: true,
      },
      {
        key: "publish_plan",
        label: "Publish Plan Impact",
        description:
          "Preview live tenant impact modal and request/publish plan drafts into active production tiers",
        enabled: true,
      },
      {
        key: "duplicate_plan",
        label: "Duplicate Plan",
        description: "Clone an existing published or retired plan into a new working draft version",
        enabled: true,
      },
      {
        key: "retire_plan",
        label: "Retire / Archive Plan",
        description:
          "Mark plans as Retired to grandfather existing tenants while restricting new organization assignments",
        enabled: true,
      },
    ],
  },
  {
    id: "feat_commercial_packs",
    name: "Commercials: Feature Packs",
    category: "commercials",
    pagePath: "/commercials/packs",
    description:
      "Control access to commercial feature add-on packs, pricing configuration, tier plan compatibility, and live pack publishing.",
    accessLevel: "full",
    actions: [
      {
        key: "view_packs",
        label: "View Feature Packs",
        description:
          "Browse the commercial feature packs table, inspect pricing and assigned tenant counts",
        enabled: true,
      },
      {
        key: "create_pack",
        label: "Create Feature Pack",
        description: "Configure new add-on feature packs with pricing and compatible tier plans",
        enabled: true,
      },
      {
        key: "edit_pack",
        label: "Edit Feature Pack",
        description:
          "Modify pack pricing, extended limits, effective dates, and plan compatibility",
        enabled: true,
      },
      {
        key: "publish_pack",
        label: "Publish Feature Pack",
        description: "Publish draft feature packs into active production availability",
        enabled: true,
      },
      {
        key: "retire_pack",
        label: "Retire Feature Pack",
        description: "Archive or retire feature packs to restrict new tenant adoption",
        enabled: true,
      },
      {
        key: "delete_pack",
        label: "Delete Draft Pack",
        description: "Permanently delete draft feature packs not assigned to any organizations",
        enabled: true,
      },
    ],
  },
  {
    id: "feat_commercial_addons",
    name: "Commercials: Optional Add-ons",
    category: "commercials",
    pagePath: "/commercials/add-ons",
    description:
      "Control access to SaaS optional commercial add-ons, pricing configuration, tier plan compatibility, and add-on publishing/retiring.",
    accessLevel: "full",
    actions: [
      {
        key: "view_addons",
        label: "View Optional Add-ons",
        description:
          "Browse commercial add-ons catalog, inspect pricing, category, compatibility and active allocations",
        enabled: true,
      },
      {
        key: "create_addon",
        label: "Create Add-on",
        description:
          "Access add-on creation editor, configure metadata, pricing, cadence and purchase limits",
        enabled: true,
      },
      {
        key: "edit_addon",
        label: "Edit Add-on",
        description:
          "Modify add-on metadata, description, pricing, purchase quantity limits and plan compatibility",
        enabled: true,
      },
      {
        key: "publish_addon",
        label: "Publish Add-on",
        description: "Publish draft add-on options into active catalog for tenant provisioning",
        enabled: true,
      },
      {
        key: "retire_addon",
        label: "Retire Add-on",
        description:
          "Retire active add-ons to restrict new purchases while preserving existing client subscriptions",
        enabled: true,
      },
      {
        key: "delete_addon",
        label: "Delete Draft Add-on",
        description:
          "Permanently remove unpublished draft add-ons not assigned to any organizations",
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
        description:
          "Modify authorization parameters, permissions matrix, and actions on existing roles",
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
  {
    id: "feat_riders",
    name: "Riders: Approval, KYC & Cash Deposits",
    category: "operations",
    pagePath: "/riders",
    description: "Review rider applications, suspend or reactivate riders and confirm cash deposits.",
    accessLevel: "full",
    actions: [
      {
        key: "view_riders",
        label: "View Riders",
        description: "Browse riders, their documents, earnings and cash position",
        enabled: true,
      },
      {
        key: "approve_rider",
        label: "Approve Rider",
        description: "Approve a rider application",
        enabled: true,
      },
      {
        key: "reject_rider",
        label: "Reject Rider",
        description: "Reject a rider application",
        enabled: true,
      },
      {
        key: "suspend_rider",
        label: "Suspend Rider",
        description: "Suspend an approved rider",
        enabled: true,
      },
      {
        key: "reactivate_rider",
        label: "Reactivate Rider",
        description: "Reactivate a suspended rider",
        enabled: true,
      },
      {
        key: "confirm_cash_deposit",
        label: "Confirm Cash Deposits",
        description: "Confirm or reject rider cash deposits",
        enabled: true,
      },
    ],
  },
  {
    id: "feat_rider_pay",
    name: "Rider Pay & Policy",
    category: "operations",
    pagePath: "/rider-pay",
    description: "Maintain rider rate cards and withdrawal / cash-limit policies per city.",
    accessLevel: "full",
    actions: [
      {
        key: "view_rider_pay",
        label: "View Rider Pay",
        description: "See rate cards and policies",
        enabled: true,
      },
      {
        key: "edit_rider_pay",
        label: "Edit Rider Pay",
        description: "Change rate cards and policies",
        enabled: true,
      },
    ],
  },
  {
    id: "feat_commission",
    name: "Commission Rules",
    category: "finance",
    pagePath: "/commission-rules",
    description: "Maintain versioned platform commission rules.",
    accessLevel: "full",
    actions: [
      {
        key: "view_commission",
        label: "View Commission Rules",
        description: "See commission rules and their history",
        enabled: true,
      },
      {
        key: "edit_commission",
        label: "Edit Commission Rules",
        description: "Create, replace and deactivate commission rules",
        enabled: true,
      },
    ],
  },
  {
    id: "feat_orders",
    name: "Orders & Order 360",
    category: "operations",
    pagePath: "/orders",
    description: "Read-only order search and order trace across organizations.",
    accessLevel: "full",
    actions: [
      {
        key: "view_orders",
        label: "View Orders",
        description: "Search orders and open the order trace",
        enabled: true,
      },
    ],
  },
  {
    id: "feat_dispatch",
    name: "Dispatch Board",
    category: "operations",
    pagePath: "/dispatch",
    description: "Watch delivery jobs and act on them through the dispatch service.",
    accessLevel: "full",
    actions: [
      {
        key: "view_dispatch",
        label: "View Dispatch Board",
        description: "See delivery jobs and exceptions",
        enabled: true,
      },
      {
        key: "manage_dispatch",
        label: "Manage Dispatch",
        description: "Reassign or cancel jobs and resolve exceptions",
        enabled: true,
      },
    ],
  },
  {
    id: "feat_finance",
    name: "Finance Control",
    category: "finance",
    pagePath: "/finance",
    description: "Platform money: payments, settlements, payouts, ledger and reconciliation.",
    accessLevel: "full",
    actions: [
      {
        key: "view_finance",
        label: "View Finance",
        description: "See overview, payments, settlements, payouts, ledger and reconciliation",
        enabled: true,
      },
      {
        key: "run_settlement",
        label: "Run Settlement",
        description: "Run a settlement for an organization period",
        enabled: true,
      },
      {
        key: "approve_settlement",
        label: "Approve Settlement",
        description: "Approve a draft settlement",
        enabled: true,
      },
      {
        key: "approve_payout",
        label: "Approve Payout",
        description: "Approve a pending payout",
        enabled: true,
      },
      {
        key: "mark_payout_paid",
        label: "Mark Payout Paid",
        description: "Record that an approved payout was paid",
        enabled: true,
      },
    ],
  },
  {
    id: "feat_dashboard",
    name: "Operations Dashboard",
    category: "platform",
    pagePath: "/dashboard",
    description: "Live operational summary for the platform.",
    accessLevel: "full",
    actions: [
      {
        key: "view_dashboard",
        label: "View Dashboard",
        description: "See the operational summary",
        enabled: true,
      },
    ],
  },
  {
    id: "feat_integrations",
    name: "Integration Centre (CRM / CMS)",
    category: "platform",
    pagePath: "/integrations",
    description: "Register and operate CRM, CMS and other integrations.",
    accessLevel: "full",
    actions: [
      {
        key: "view_integrations",
        label: "View Integrations",
        description: "See integrations, logs and mappings",
        enabled: true,
      },
      {
        key: "manage_integrations",
        label: "Manage Integrations",
        description: "Create, edit, test, sync, disable and rotate credentials",
        enabled: true,
      },
    ],
  },
  {
    id: "feat_api_webhooks",
    name: "API Apps & Webhooks",
    category: "platform",
    pagePath: "/api-webhooks",
    description: "Issue API keys and manage webhook endpoints and deliveries.",
    accessLevel: "full",
    actions: [
      {
        key: "view_api_webhooks",
        label: "View API & Webhooks",
        description: "See API apps, webhooks, deliveries and API logs",
        enabled: true,
      },
      {
        key: "manage_api_webhooks",
        label: "Manage API & Webhooks",
        description: "Create, rotate and revoke keys; manage webhooks and retries",
        enabled: true,
      },
    ],
  },
  {
    id: "feat_org_subscription",
    name: "Organization Subscription & Entitlements",
    category: "organization",
    pagePath: "/organizations/subscription",
    description: "See an organization's entitlements and change its plan.",
    accessLevel: "full",
    actions: [
      {
        key: "view_subscription",
        label: "View Entitlements",
        description: "See an organization's plan and entitlements",
        enabled: true,
      },
      {
        key: "change_plan",
        label: "Change Plan",
        description: "Move an organization to another plan",
        enabled: true,
      },
    ],
  },
  {
    id: "feat_invitations",
    name: "Invitations",
    category: "access_control",
    pagePath: "/invitations",
    description: "Invite people into organizations and manage pending invitations.",
    accessLevel: "full",
    actions: [
      {
        key: "view_invitations",
        label: "View Invitations",
        description: "See invitations and their status",
        enabled: true,
      },
      {
        key: "manage_invitations",
        label: "Manage Invitations",
        description: "Create, revoke and resend invitations",
        enabled: true,
      },
    ],
  },
];

const DELIMITERS = /[:$]/;

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
      const keys = (feat.actions || []).filter((a) => a.enabled).map((a) => a.key.trim());
      const level = feat.accessLevel || "none";
      // The DB format uses ':' and '$' as delimiters: an id or action key containing one would let a caller
      // smuggle extra features (and so extra permissions) into the stored string. Refuse, never escape.
      if (DELIMITERS.test(feat.id) || keys.some((k) => DELIMITERS.test(k))) {
        throw new BadRequestException("Permission ids and action keys must not contain ':' or '$'");
      }
      return `${feat.id}::${level}::${keys.join("$")}`;
    })
    .join("$$$");
}

const LEVEL_RANK: Record<AccessLevel, number> = { none: 0, read_only: 1, full: 2 };

/**
 * Validates a submitted permission matrix against the known feature template and returns the
 * canonical, complete matrix: every known feature present, unknown ids/actions rejected, duplicates
 * rejected, and a feature with access level "none" carrying no enabled actions (they would be inert
 * but could later be revived by raising the level).
 */
export function canonicalizeFeatures(input: Array<Partial<FeaturePermission> & { id: string }>): FeaturePermission[] {
  const seen = new Set<string>();
  const byId = new Map<string, FeaturePermission>();
  for (const f of input) {
    const template = DEFAULT_FEATURES_TEMPLATE.find((t) => t.id === f.id);
    if (!template) {
      throw new BadRequestException(`Unknown permission feature '${f.id}'`);
    }
    if (seen.has(f.id)) {
      throw new BadRequestException(`Permission feature '${f.id}' is listed more than once`);
    }
    seen.add(f.id);
    const level: AccessLevel = (f.accessLevel as AccessLevel) ?? "none";
    if (!(level in LEVEL_RANK)) {
      throw new BadRequestException(`Invalid access level '${String(f.accessLevel)}' for '${f.id}'`);
    }
    const enabledKeys = new Set<string>();
    for (const a of f.actions ?? []) {
      if (!template.actions.some((ta) => ta.key === a.key)) {
        throw new BadRequestException(`Unknown permission action '${a.key}' for feature '${f.id}'`);
      }
      if (a.enabled) enabledKeys.add(a.key);
    }
    byId.set(f.id, {
      ...template,
      accessLevel: level,
      actions: template.actions.map((ta) => ({ ...ta, enabled: level !== "none" && enabledKeys.has(ta.key) })),
    });
  }
  return DEFAULT_FEATURES_TEMPLATE.map(
    (t) =>
      byId.get(t.id) ?? {
        ...t,
        accessLevel: "none" as const,
        actions: t.actions.map((a) => ({ ...a, enabled: false })),
      }
  );
}

/**
 * Lists what `granted` would give beyond what `held` already gives (empty = granted is a subset of held).
 * Compared per feature: the access level may not be higher, and every enabled action must also be
 * enabled in the holder's matrix.
 */
export function permissionsBeyond(held: FeaturePermission[], granted: FeaturePermission[]): string[] {
  const beyond: string[] = [];
  for (const g of granted) {
    const h = held.find((x) => x.id === g.id);
    const heldRank = LEVEL_RANK[h?.accessLevel ?? "none"];
    if (LEVEL_RANK[g.accessLevel] > heldRank) {
      beyond.push(`${g.id} (${g.accessLevel})`);
    }
    for (const a of g.actions ?? []) {
      if (!a.enabled) continue;
      const holds = !!h?.actions?.some((x) => x.key === a.key && x.enabled);
      if (!holds) beyond.push(`${g.id}.${a.key}`);
    }
  }
  return beyond;
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
