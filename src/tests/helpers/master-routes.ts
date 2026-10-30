/**
 * Every endpoint added by the Master immediate build, with the permission it needs. master-guards.test.ts
 * derives its 401 / 403 / wrong-action / read-only-on-write cases from this table, and route-guards.test.ts
 * checks the table against the router so a new endpoint cannot ship without a guard test.
 */
export type Method = "get" | "post" | "put" | "patch" | "delete";
export interface MRoute {
  method: Method;
  path: string;
  /** undefined = any signed-in staff member (no feature permission) */
  feature?: string;
  action?: string;
  /** write routes need access level "full" on the feature */
  write?: boolean;
}

export const ID = "00000000-0000-0000-0000-000000000001";
const g = (path: string, feature: string, action: string): MRoute => ({ method: "get", path, feature, action });
const w = (method: Method, path: string, feature: string, action: string): MRoute => ({ method, path, feature, action, write: true });

export const MASTER_ROUTES: MRoute[] = [
  // shell
  { method: "get", path: "/api/me/context" },
  { method: "get", path: "/api/system/status" },
  { method: "get", path: "/api/search?q=ab" },
  { method: "get", path: "/api/cities" },
  g("/api/dashboard/summary", "feat_dashboard", "view_dashboard"),
  // organizations
  w("patch", `/api/organizations/${ID}/ordering`, "feat_org_360", "manage_ordering"),
  w("post", `/api/organizations/${ID}/suspend`, "feat_org_360", "suspend_org"),
  w("post", `/api/organizations/${ID}/reactivate`, "feat_org_360", "suspend_org"),
  w("post", `/api/organizations/${ID}/archive`, "feat_org_360", "archive_org"),
  w("post", `/api/organizations/${ID}/restore`, "feat_org_360", "archive_org"),
  g(`/api/organizations/${ID}/360`, "feat_org_360", "view_directory"),
  w("post", `/api/organizations/${ID}/subscription`, "feat_org_subscription", "change_plan"),
  g(`/api/organizations/${ID}/entitlements`, "feat_org_subscription", "view_subscription"),
  // invitations
  g("/api/invitations", "feat_invitations", "view_invitations"),
  w("post", "/api/invitations", "feat_invitations", "manage_invitations"),
  w("post", `/api/invitations/${ID}/revoke`, "feat_invitations", "manage_invitations"),
  w("post", `/api/invitations/${ID}/resend`, "feat_invitations", "manage_invitations"),
  // riders
  g("/api/riders", "feat_riders", "view_riders"),
  g(`/api/riders/${ID}`, "feat_riders", "view_riders"),
  w("post", `/api/riders/${ID}/approve`, "feat_riders", "approve_rider"),
  w("post", `/api/riders/${ID}/reject`, "feat_riders", "reject_rider"),
  w("post", `/api/riders/${ID}/suspend`, "feat_riders", "suspend_rider"),
  w("post", `/api/riders/${ID}/reactivate`, "feat_riders", "reactivate_rider"),
  g("/api/rider-cash-deposits", "feat_riders", "view_riders"),
  w("post", `/api/rider-cash-deposits/${ID}/confirm`, "feat_riders", "confirm_cash_deposit"),
  w("post", `/api/rider-cash-deposits/${ID}/reject`, "feat_riders", "confirm_cash_deposit"),
  // rider pay
  g("/api/rider-pay/rate-cards/latur", "feat_rider_pay", "view_rider_pay"),
  w("put", "/api/rider-pay/rate-cards/latur", "feat_rider_pay", "edit_rider_pay"),
  g("/api/rider-pay/policies/latur", "feat_rider_pay", "view_rider_pay"),
  w("put", "/api/rider-pay/policies/latur", "feat_rider_pay", "edit_rider_pay"),
  // commission
  g("/api/commission-rules", "feat_commission", "view_commission"),
  w("post", "/api/commission-rules", "feat_commission", "edit_commission"),
  w("put", `/api/commission-rules/${ID}`, "feat_commission", "edit_commission"),
  w("post", `/api/commission-rules/${ID}/deactivate`, "feat_commission", "edit_commission"),
  // orders
  g("/api/orders", "feat_orders", "view_orders"),
  g(`/api/orders/${ID}`, "feat_orders", "view_orders"),
  // partner applications
  g("/api/partner-applications", "feat_partner_review", "view_applications"),
  g(`/api/partner-applications/${ID}`, "feat_partner_review", "view_applications"),
  w("post", `/api/partner-applications/${ID}/approve`, "feat_partner_review", "approve_partner"),
  w("post", `/api/partner-applications/${ID}/reject`, "feat_partner_review", "reject_partner"),
  w("post", `/api/partner-applications/${ID}/checks/business_identity`, "feat_partner_review", "verify_checks"),
  w("post", `/api/partner-applications/${ID}/documents/${ID}/review`, "feat_partner_review", "review_documents"),
  { method: "post", path: `/api/partner-applications/${ID}/documents/${ID}/view`, feature: "feat_partner_review", action: "view_documents" },
  w("post", `/api/partner-applications/${ID}/hold`, "feat_partner_review", "hold_partner"),
  g("/api/customers", "feat_customers", "view_customers"),
  g("/api/role-sets", "feat_role_sets", "view_role_sets"),
  w("put", `/api/role-sets/store/biller`, "feat_role_sets", "manage_role_sets"),
  w("delete", `/api/role-sets/store/biller`, "feat_role_sets", "manage_role_sets"),
  g(`/api/organizations/${ID}/staff-roles`, "feat_role_sets", "view_role_sets"),
  w("post", `/api/organizations/${ID}/staff-roles/apply`, "feat_role_sets", "manage_role_sets"),
  w("post", `/api/organizations/${ID}/test-login`, "feat_role_sets", "create_test_login"),
  g("/api/support", "feat_support", "view_support"),
  g(`/api/support/customer/${ID}`, "feat_support", "view_support"),
  w("post", `/api/support/customer/${ID}`, "feat_support", "handle_support"),
  // order holds
  g("/api/order-holds", "feat_orders", "view_orders"),
  g(`/api/order-holds/${ID}`, "feat_orders", "view_orders"),
  w("post", `/api/order-holds/${ID}/release`, "feat_orders", "decide_order_holds"),
  w("post", `/api/order-holds/${ID}/reject`, "feat_orders", "decide_order_holds"),
  // customer-app pop-ups, relayed to One Local
  g("/api/popups", "feat_customer_popups", "view_popups"),
  g(`/api/popups/${ID}`, "feat_customer_popups", "view_popups"),
  g(`/api/popups/${ID}/results`, "feat_customer_popups", "view_popups"),
  w("post", "/api/popups", "feat_customer_popups", "manage_popups"),
  w("put", `/api/popups/${ID}`, "feat_customer_popups", "manage_popups"),
  w("post", `/api/popups/${ID}/status`, "feat_customer_popups", "manage_popups"),
  w("post", "/api/popups/media/upload-url", "feat_customer_popups", "manage_popups"),
  // pipeline (event log follower)
  g("/api/pipeline/status", "feat_orders", "view_orders"),
  w("post", "/api/pipeline/follow", "feat_orders", "run_pipeline"),
  // dispatch
  g("/api/dispatch/jobs", "feat_dispatch", "view_dispatch"),
  g(`/api/dispatch/jobs/${ID}`, "feat_dispatch", "view_dispatch"),
  w("post", `/api/dispatch/jobs/${ID}/reassign`, "feat_dispatch", "manage_dispatch"),
  w("post", `/api/dispatch/jobs/${ID}/cancel`, "feat_dispatch", "manage_dispatch"),
  w("post", `/api/dispatch/exceptions/${ID}/resolve`, "feat_dispatch", "manage_dispatch"),
  // finance
  g("/api/finance/overview", "feat_finance", "view_finance"),
  g("/api/finance/payments", "feat_finance", "view_finance"),
  g("/api/finance/settlements", "feat_finance", "view_finance"),
  w("post", "/api/finance/settlements/run", "feat_finance", "run_settlement"),
  w("post", `/api/finance/settlements/${ID}/approve`, "feat_finance", "approve_settlement"),
  g("/api/finance/payouts", "feat_finance", "view_finance"),
  w("post", `/api/finance/payouts/${ID}/approve`, "feat_finance", "approve_payout"),
  w("post", `/api/finance/payouts/${ID}/mark-paid`, "feat_finance", "mark_payout_paid"),
  g("/api/finance/ledger", "feat_finance", "view_finance"),
  g("/api/finance/reconciliation", "feat_finance", "view_finance"),
  g("/api/finance/rider-earnings", "feat_finance", "view_finance"),
  // audit
  g("/api/audit-logs", "feat_audit_compliance", "view_audit_logs"),
  // integrations
  g("/api/integrations", "feat_integrations", "view_integrations"),
  w("post", "/api/integrations", "feat_integrations", "manage_integrations"),
  g(`/api/integrations/${ID}`, "feat_integrations", "view_integrations"),
  w("put", `/api/integrations/${ID}`, "feat_integrations", "manage_integrations"),
  w("post", `/api/integrations/${ID}/test`, "feat_integrations", "manage_integrations"),
  w("post", `/api/integrations/${ID}/sync`, "feat_integrations", "manage_integrations"),
  w("post", `/api/integrations/${ID}/disable`, "feat_integrations", "manage_integrations"),
  w("post", `/api/integrations/${ID}/enable`, "feat_integrations", "manage_integrations"),
  w("post", `/api/integrations/${ID}/rotate-credentials`, "feat_integrations", "manage_integrations"),
  g(`/api/integrations/${ID}/logs`, "feat_integrations", "view_integrations"),
  g(`/api/integrations/${ID}/mappings`, "feat_integrations", "view_integrations"),
  w("put", `/api/integrations/${ID}/mappings`, "feat_integrations", "manage_integrations"),
  // api & webhooks
  g("/api/api-apps", "feat_api_webhooks", "view_api_webhooks"),
  w("post", "/api/api-apps", "feat_api_webhooks", "manage_api_webhooks"),
  w("post", `/api/api-apps/${ID}/rotate`, "feat_api_webhooks", "manage_api_webhooks"),
  w("post", `/api/api-apps/${ID}/revoke`, "feat_api_webhooks", "manage_api_webhooks"),
  g("/api/api-logs", "feat_api_webhooks", "view_api_webhooks"),
  g("/api/webhooks", "feat_api_webhooks", "view_api_webhooks"),
  w("post", "/api/webhooks", "feat_api_webhooks", "manage_api_webhooks"),
  w("post", `/api/webhooks/${ID}/test`, "feat_api_webhooks", "manage_api_webhooks"),
  w("post", `/api/webhooks/${ID}/disable`, "feat_api_webhooks", "manage_api_webhooks"),
  g("/api/webhook-deliveries", "feat_api_webhooks", "view_api_webhooks"),
  w("post", `/api/webhook-deliveries/${ID}/retry`, "feat_api_webhooks", "manage_api_webhooks"),
  w("post", `/api/webhook-deliveries/${ID}/replay`, "feat_api_webhooks", "manage_api_webhooks"),
];
