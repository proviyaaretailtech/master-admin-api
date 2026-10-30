import { Router, Request } from "express";
import { z } from "zod";
import { HTTPSTATUS } from "../config/http.config";
import { requireAuth } from "../middlewares/auth.middleware";
import { requireOrganizationCreatePermission } from "../middlewares/permission.middleware";
import { wrap, can, canWrite } from "../utils/master-http";
import { idParams, reasonBody } from "../validators/master.validator";
import * as ops from "../validators/master-ops.validator";
import * as orgv from "../validators/master-org.validator";
import { scrub } from "../services/master/common";
import { shellService } from "../services/master/shell.service";
import { readService } from "../services/master/read.service";
import { riderPayService } from "../services/master/rider-pay.service";
import { commissionService } from "../services/master/commission.service";
import { dispatchService } from "../services/master/dispatch.service";
import { financeService } from "../services/master/finance.service";
import { orgService } from "../services/master/org.service";
import { peopleService } from "../services/master/people.service";
import { partnerApplicationService } from "../services/master/partner-application.service";
import { customerService } from "../services/master/customer.service";
import { supportService } from "../services/master/support.service";
import { orgRolesService } from "../services/master/org-roles.service";
import { orderHoldService } from "../services/master/order-hold.service";
import { popupsService } from "../services/master/popups.service";
import { pipelineService } from "../services/master/pipeline.service";
import * as review from "../validators/master-review.validator";
import { createOrganizationSchema } from "../validators/organization.validator";

/**
 * Master immediate build (specs/master-immediate/spec.md). Every route names its feature+action permission;
 * writes need "full" access on the feature. Super admins bypass as everywhere else. Mounted before the legacy
 * routers so /organizations/:id/<verb> reaches here; unmatched paths fall through.
 */
const r = Router();
const OK = HTTPSTATUS.OK;
const pipelineStatusQuery = z.object({ minutes: z.coerce.number().int().min(5).max(1440).default(60) });
const idem = (req: Request) => {
  const k = req.header("idempotency-key");
  return k && /^[\w:.-]{8,200}$/.test(k) ? k : undefined;
};

// ------------------------------------------------------------------ shell
r.get("/me/context", requireAuth, wrap(async (req, res, actor) => {
  res.status(OK).json({ message: "Context fetched successfully", ...(await shellService.context(req.user!, actor)) });
}));
r.get("/system/status", requireAuth, wrap(async (_req, res) => {
  res.status(OK).json({ message: "System status fetched successfully", ...(await shellService.systemStatus()) });
}));
r.get("/search", requireAuth, wrap(async (req, res, actor) => {
  const { q } = ops.searchQuery.parse(req.query);
  res.status(OK).json({ message: "Search completed", ...(await shellService.search(actor, q)) });
}));
r.get("/dashboard/summary", can("feat_dashboard", "view_dashboard"), wrap(async (req, res) => {
  const q = z.object({ from: ops.rangeQuery.shape.from, to: ops.rangeQuery.shape.to, org: orgv.invitationsQuery.shape.org }).parse(req.query);
  res.status(OK).json({ message: "Dashboard fetched successfully", summary: await shellService.dashboard(q) });
}));

// ---------------------------------------------------------- organizations
r.post("/organizations", requireOrganizationCreatePermission, wrap(async (req, res, actor) => {
  // plan_code / owner_email / locations / ordering_open extend the legacy create; the legacy status gate still applies below
  const body = createOrganizationSchema.parse(req.body);
  const out = await orgService.create(actor, body);
  res.status(HTTPSTATUS.CREATED).json({ message: "Organization created successfully", ...out });
}));
r.patch("/organizations/:id/ordering", canWrite("feat_org_360", "manage_ordering"), wrap(async (req, res, actor) => {
  const { id } = idParams.parse(req.params);
  const b = orgv.orderingBody.parse(req.body);
  res.status(OK).json({ message: b.accepting ? "Ordering resumed" : "Ordering paused", ...(await orgService.setOrdering(actor, id, b.accepting, b.reason)) });
}));
for (const [verb, perm, fn, msg] of [
  ["suspend", "suspend_org", orgService.suspend, "Organization suspended"],
  ["reactivate", "suspend_org", orgService.reactivate, "Organization reactivated"],
  ["archive", "archive_org", orgService.archive, "Organization archived"],
  ["restore", "archive_org", orgService.restore, "Organization restored"],
] as const) {
  r.post(`/organizations/:id/${verb}`, canWrite("feat_org_360", perm), wrap(async (req, res, actor) => {
    const { id } = idParams.parse(req.params);
    const { reason } = reasonBody.parse(req.body);
    res.status(OK).json({ message: msg, ...(await fn.call(orgService, actor, id, reason)) });
  }));
}
r.get("/organizations/:id/360", can("feat_org_360", "view_directory"), wrap(async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.status(OK).json({ message: "Organization 360 fetched successfully", ...(await orgService.view360(id)) });
}));
r.post("/organizations/:id/subscription", canWrite("feat_org_subscription", "change_plan"), wrap(async (req, res, actor) => {
  const { id } = idParams.parse(req.params);
  const b = orgv.subscriptionBody.parse(req.body);
  res.status(OK).json({ message: "Plan updated", ...(await orgService.changePlan(actor, id, b.plan_code, b.reason)) });
}));
r.get("/organizations/:id/entitlements", can("feat_org_subscription", "view_subscription"), wrap(async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.status(OK).json({ message: "Entitlements fetched successfully", ...(await orgService.entitlements(id)) });
}));

// ------------------------------------------------------------ invitations
r.get("/invitations", can("feat_invitations", "view_invitations"), wrap(async (req, res) => {
  res.status(OK).json({ message: "Invitations fetched successfully", ...(await peopleService.listInvitations(orgv.invitationsQuery.parse(req.query))) });
}));
r.post("/invitations", canWrite("feat_invitations", "manage_invitations"), wrap(async (req, res, actor) => {
  const out = await peopleService.invite(actor, orgv.inviteBody.parse(req.body));
  res.status(HTTPSTATUS.CREATED).json({ message: "Invitation created", invitation: out });
}));
r.post("/invitations/:id/revoke", canWrite("feat_invitations", "manage_invitations"), wrap(async (req, res, actor) => {
  const { id } = idParams.parse(req.params);
  const b = orgv.revokeBody.parse(req.body ?? {});
  res.status(OK).json({ message: "Invitation revoked", invitation: await peopleService.revoke(actor, id, b.reason) });
}));
r.post("/invitations/:id/resend", canWrite("feat_invitations", "manage_invitations"), wrap(async (req, res, actor) => {
  const { id } = idParams.parse(req.params);
  res.status(OK).json({ message: "Invitation resent", invitation: await peopleService.resend(actor, id) });
}));

// ----------------------------------------------------------------- riders
r.get("/riders", can("feat_riders", "view_riders"), wrap(async (req, res) => {
  res.status(OK).json({ message: "Riders fetched successfully", ...(await readService.riders(ops.ridersQuery.parse(req.query))) });
}));
r.get("/riders/:id", can("feat_riders", "view_riders"), wrap(async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.status(OK).json({ message: "Rider fetched successfully", ...(await readService.rider360(id)) });
}));
for (const [verb, action, to, msg] of [
  ["approve", "approve_rider", "approved", "Rider approved"],
  ["reject", "reject_rider", "rejected", "Rider rejected"],
  ["suspend", "suspend_rider", "suspended", "Rider suspended"],
  ["reactivate", "reactivate_rider", "approved", "Rider reactivated"],
] as const) {
  r.post(`/riders/:id/${verb}`, canWrite("feat_riders", action), wrap(async (req, res, actor) => {
    const { id } = idParams.parse(req.params);
    const { reason } = (verb === "approve" ? z.object({ reason: z.string().trim().min(3).max(500).optional() }) : ops.riderActionBody).parse(req.body ?? {});
    res.status(OK).json({ message: msg, ...(await peopleService.setRiderStatus(actor, id, to, reason)) });
  }));
}
r.get("/rider-cash-deposits", can("feat_riders", "view_riders"), wrap(async (req, res) => {
  res.status(OK).json({ message: "Cash deposits fetched successfully", ...(await readService.cashDeposits(ops.depositsQuery.parse(req.query))) });
}));
r.post("/rider-cash-deposits/:id/confirm", canWrite("feat_riders", "confirm_cash_deposit"), wrap(async (req, res, actor) => {
  const { id } = idParams.parse(req.params);
  const b = ops.depositDecisionBody.parse(req.body ?? {});
  res.status(OK).json({ message: "Cash deposit confirmed", ...(await peopleService.decideDeposit(actor, id, "confirmed", b.note)) });
}));
r.post("/rider-cash-deposits/:id/reject", canWrite("feat_riders", "confirm_cash_deposit"), wrap(async (req, res, actor) => {
  const { id } = idParams.parse(req.params);
  const b = ops.depositDecisionBody.parse(req.body ?? {});
  res.status(OK).json({ message: "Cash deposit rejected", ...(await peopleService.decideDeposit(actor, id, "rejected", b.note)) });
}));

// -------------------------------------------------------------- rider pay
r.get("/cities", requireAuth, wrap(async (_req, res) => {
  res.status(OK).json({ message: "Cities fetched successfully", cities: await riderPayService.listCities() });
}));
r.get("/rider-pay/rate-cards/:city_id", can("feat_rider_pay", "view_rider_pay"), wrap(async (req, res) => {
  const { city_id } = ops.cityParams.parse(req.params);
  res.status(OK).json({ message: "Rate card fetched successfully", ...(await riderPayService.getRateCard(city_id)) });
}));
r.put("/rider-pay/rate-cards/:city_id", canWrite("feat_rider_pay", "edit_rider_pay"), wrap(async (req, res, actor) => {
  const { city_id } = ops.cityParams.parse(req.params);
  res.status(OK).json({ message: "Rate card saved", ...(await riderPayService.putRateCard(actor, city_id, ops.rateCardBody.parse(req.body))) });
}));
r.get("/rider-pay/policies/:city_id", can("feat_rider_pay", "view_rider_pay"), wrap(async (req, res) => {
  const { city_id } = ops.cityParams.parse(req.params);
  res.status(OK).json({ message: "Policy fetched successfully", ...(await riderPayService.getPolicy(city_id)) });
}));
r.put("/rider-pay/policies/:city_id", canWrite("feat_rider_pay", "edit_rider_pay"), wrap(async (req, res, actor) => {
  const { city_id } = ops.cityParams.parse(req.params);
  res.status(OK).json({ message: "Policy saved", ...(await riderPayService.putPolicy(actor, city_id, ops.policyBody.parse(req.body))) });
}));

// ------------------------------------------------------------- commission
r.get("/commission-rules", can("feat_commission", "view_commission"), wrap(async (req, res) => {
  res.status(OK).json({ message: "Commission rules fetched successfully", ...(await commissionService.list(ops.commissionQuery.parse(req.query))) });
}));
r.post("/commission-rules", canWrite("feat_commission", "edit_commission"), wrap(async (req, res, actor) => {
  const rule = await commissionService.create(actor, ops.commissionCreateBody.parse(req.body));
  res.status(HTTPSTATUS.CREATED).json({ message: "Commission rule created", rule });
}));
r.put("/commission-rules/:id", canWrite("feat_commission", "edit_commission"), wrap(async (req, res, actor) => {
  const { id } = idParams.parse(req.params);
  const { reason, ...patch } = ops.commissionUpdateBody.parse(req.body);
  res.status(OK).json({ message: "Commission rule replaced", ...(await commissionService.replace(actor, id, patch, reason ?? "Commission rule updated")) });
}));
r.post("/commission-rules/:id/deactivate", canWrite("feat_commission", "edit_commission"), wrap(async (req, res, actor) => {
  const { id } = idParams.parse(req.params);
  const b = ops.commissionDeactivateBody.parse(req.body ?? {});
  res.status(OK).json({ message: "Commission rule deactivated", rule: await commissionService.deactivate(actor, id, b.reason ?? "Commission rule deactivated") });
}));

// ----------------------------------------------------------------- orders
r.get("/orders", can("feat_orders", "view_orders"), wrap(async (req, res) => {
  res.status(OK).json({ message: "Orders fetched successfully", ...(await readService.orders(ops.ordersQuery.parse(req.query))) });
}));
r.get("/orders/:id", can("feat_orders", "view_orders"), wrap(async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.status(OK).json({ message: "Order fetched successfully", ...(await readService.order360(id)) });
}));

// --------------------------------------------------------------- dispatch
r.get("/dispatch/jobs", can("feat_dispatch", "view_dispatch"), wrap(async (req, res) => {
  res.status(OK).json({ message: "Dispatch jobs fetched successfully", ...(await readService.dispatchJobs(ops.dispatchJobsQuery.parse(req.query))) });
}));
r.get("/dispatch/jobs/:id", can("feat_dispatch", "view_dispatch"), wrap(async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.status(OK).json({ message: "Dispatch job fetched successfully", ...(await readService.dispatchJob(id)) });
}));
r.post("/dispatch/jobs/:id/reassign", canWrite("feat_dispatch", "manage_dispatch"), wrap(async (req, res, actor) => {
  const { id } = idParams.parse(req.params);
  const { reason } = ops.dispatchReasonBody.parse(req.body);
  res.status(OK).json({ message: "Job reassignment requested", result: scrub(await dispatchService.reassign(actor, id, reason, idem(req))) });
}));
r.post("/dispatch/jobs/:id/cancel", canWrite("feat_dispatch", "manage_dispatch"), wrap(async (req, res, actor) => {
  const { id } = idParams.parse(req.params);
  const b = ops.dispatchCancelBody.parse(req.body);
  res.status(OK).json({ message: "Job cancelled", result: scrub(await dispatchService.cancel(actor, id, b.reason, b.code, idem(req))) });
}));
r.post("/dispatch/exceptions/:id/resolve", canWrite("feat_dispatch", "manage_dispatch"), wrap(async (req, res, actor) => {
  const { id } = idParams.parse(req.params);
  const b = ops.exceptionResolveBody.parse(req.body);
  res.status(OK).json({ message: "Exception resolved", result: scrub(await dispatchService.resolveException(actor, id, b.outcome, b.note, idem(req))) });
}));

// ---------------------------------------------------------------- finance
r.get("/finance/overview", can("feat_finance", "view_finance"), wrap(async (req, res) => {
  res.status(OK).json({ message: "Finance overview fetched successfully", overview: await shellService.financeOverview(ops.rangeQuery.parse(req.query)) });
}));
r.get("/finance/payments", can("feat_finance", "view_finance"), wrap(async (req, res) => {
  res.status(OK).json({ message: "Payments fetched successfully", ...(await readService.payments(ops.paymentsQuery.parse(req.query))) });
}));
r.get("/finance/settlements", can("feat_finance", "view_finance"), wrap(async (req, res) => {
  res.status(OK).json({ message: "Settlements fetched successfully", ...(await readService.settlements(ops.settlementsQuery.parse(req.query))) });
}));
r.post("/finance/settlements/run", canWrite("feat_finance", "run_settlement"), wrap(async (req, res, actor) => {
  const settlement = await financeService.runSettlement(actor, ops.runSettlementBody.parse(req.body));
  res.status(HTTPSTATUS.CREATED).json({ message: "Settlement created", settlement });
}));
r.post("/finance/settlements/:id/approve", canWrite("feat_finance", "approve_settlement"), wrap(async (req, res, actor) => {
  const { id } = idParams.parse(req.params);
  res.status(OK).json({ message: "Settlement approved", ...(await financeService.approveSettlement(actor, id)) });
}));
r.get("/finance/payouts", can("feat_finance", "view_finance"), wrap(async (req, res) => {
  res.status(OK).json({ message: "Payouts fetched successfully", ...(await readService.payouts(ops.payoutsQuery.parse(req.query))) });
}));
r.post("/finance/payouts/:id/approve", canWrite("feat_finance", "approve_payout"), wrap(async (req, res, actor) => {
  const { id } = idParams.parse(req.params);
  res.status(OK).json({ message: "Payout approved", payout: await financeService.approvePayout(actor, id) });
}));
r.post("/finance/payouts/:id/mark-paid", canWrite("feat_finance", "mark_payout_paid"), wrap(async (req, res, actor) => {
  const { id } = idParams.parse(req.params);
  const { reference } = ops.markPaidBody.parse(req.body);
  res.status(OK).json({ message: "Payout marked paid", payout: await financeService.markPaid(actor, id, reference) });
}));
r.get("/finance/ledger", can("feat_finance", "view_finance"), wrap(async (req, res) => {
  res.status(OK).json({ message: "Ledger fetched successfully", ...(await readService.ledger(ops.ledgerQuery.parse(req.query))) });
}));
r.get("/finance/reconciliation", can("feat_finance", "view_finance"), wrap(async (_req, res) => {
  res.status(OK).json({ message: "Reconciliation fetched successfully", ...(await readService.reconciliation()) });
}));
r.get("/finance/rider-earnings", can("feat_finance", "view_finance"), wrap(async (req, res) => {
  res.status(OK).json({ message: "Rider earnings fetched successfully", ...(await readService.riderEarnings(ops.riderEarningsQuery.parse(req.query))) });
}));

// ---------------------------------------------------- partner applications
// Sign-ups from the partner website (ol_partner_applications). Approve creates the organisation (0342).
r.get("/partner-applications", can("feat_partner_review", "view_applications"), wrap(async (req, res) => {
  res.status(OK).json({ message: "Partner applications fetched successfully", ...(await partnerApplicationService.list(review.applicationsQuery.parse(req.query))) });
}));
r.get("/partner-applications/:id", can("feat_partner_review", "view_applications"), wrap(async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.status(OK).json({ message: "Partner application fetched successfully", ...(await partnerApplicationService.get(id)) });
}));
r.post("/partner-applications/:id/approve", canWrite("feat_partner_review", "approve_partner"), wrap(async (req, res, actor) => {
  const { id } = idParams.parse(req.params);
  const { reason } = review.approveApplicationBody.parse(req.body ?? {});
  const result = await partnerApplicationService.decide(actor, id, "approve", reason);
  res.status(OK).json({ message: result.replayed ? "Partner application was already approved" : "Partner application approved", result });
}));
r.post("/partner-applications/:id/reject", canWrite("feat_partner_review", "reject_partner"), wrap(async (req, res, actor) => {
  const { id } = idParams.parse(req.params);
  const { reason } = review.rejectApplicationBody.parse(req.body ?? {});
  const result = await partnerApplicationService.decide(actor, id, "reject", reason);
  res.status(OK).json({ message: result.replayed ? "Partner application was already rejected" : "Partner application rejected", result });
}));
// ------------------------------------------------------------- customers
// People using the customer app (logins that are not partner staff, riders or platform staff); masked on the server.
r.get("/customers", can("feat_customers", "view_customers"), wrap(async (req, res) => {
  const f = review.customersQuery.parse(req.query);
  const test = f.accounts === "all" ? undefined : f.accounts === "test";
  res.status(OK).json({
    message: "Customers fetched successfully",
    summary: await customerService.summary(),
    ...(await customerService.list({ q: f.q, test, page: f.page, limit: f.limit })),
  });
}));

// ------------------------------------------------- role sets and test logins
// Which staff roles each store type may use: decided by the founder here, empty until then (0632).
r.get("/role-sets", can("feat_role_sets", "view_role_sets"), wrap(async (_req, res) => {
  res.status(OK).json({ message: "Role sets fetched successfully", ...(await orgRolesService.roleSets()) });
}));
r.put("/role-sets/:storeType/:role", canWrite("feat_role_sets", "manage_role_sets"), wrap(async (req, res, actor) => {
  const { storeType, role } = review.roleSetParams.parse(req.params);
  res.status(OK).json({ message: "Role added to the set", result: await orgRolesService.changeSet(actor, storeType, role, true) });
}));
r.delete("/role-sets/:storeType/:role", canWrite("feat_role_sets", "manage_role_sets"), wrap(async (req, res, actor) => {
  const { storeType, role } = review.roleSetParams.parse(req.params);
  res.status(OK).json({ message: "Role removed from the set", result: await orgRolesService.changeSet(actor, storeType, role, false) });
}));
r.get("/organizations/:id/staff-roles", can("feat_role_sets", "view_role_sets"), wrap(async (req, res) => {
  const { id } = review.orgParams.parse(req.params);
  res.status(OK).json({ message: "Organisation roles fetched successfully", ...(await orgRolesService.forOrganization(id)) });
}));
r.post("/organizations/:id/staff-roles/apply", canWrite("feat_role_sets", "manage_role_sets"), wrap(async (req, res, actor) => {
  const { id } = review.orgParams.parse(req.params);
  const { store_type } = review.applyRoleSetBody.parse(req.body ?? {});
  res.status(OK).json({ message: "Approved roles applied", result: await orgRolesService.applySet(actor, id, store_type) });
}));
// Local and staging only; the password is shown once and never stored by Master (0633).
r.post("/organizations/:id/test-login", canWrite("feat_role_sets", "create_test_login"), wrap(async (req, res, actor) => {
  const { id } = review.orgParams.parse(req.params);
  const { role } = review.testLoginBody.parse(req.body ?? {});
  res.status(OK).json({ message: "Test login created", result: await orgRolesService.createTestLogin(actor, id, role) });
}));

// --------------------------------------------------------------- support
// One inbox over customer and partner support requests (0631). Notes are internal; nothing is sent from here.
r.get("/support", can("feat_support", "view_support"), wrap(async (req, res, actor) => {
  const f = review.supportQuery.parse(req.query);
  res.status(OK).json({
    message: "Support requests fetched successfully",
    ...(await supportService.list({ source: f.source, status: f.status, mine: f.mine ? actor.id : undefined, q: f.q, page: f.page, limit: f.limit })),
  });
}));
r.get("/support/:source/:id", can("feat_support", "view_support"), wrap(async (req, res) => {
  const { source, id } = review.supportParams.parse(req.params);
  res.status(OK).json({ message: "Support request fetched successfully", ...(await supportService.get(source, id)) });
}));
r.post("/support/:source/:id", canWrite("feat_support", "handle_support"), wrap(async (req, res, actor) => {
  const { source, id } = review.supportParams.parse(req.params);
  const body = review.supportUpdateBody.parse(req.body ?? {});
  res.status(OK).json({ message: "Support request updated", result: await supportService.update(actor, source, id, body) });
}));

// Verification before approval: the four checks and each uploaded document (0372, 0630). The database refuses an
// approval until all of them are verified, so these are the only way to an approval.
r.post("/partner-applications/:id/checks/:kind", canWrite("feat_partner_review", "verify_checks"), wrap(async (req, res, actor) => {
  const { id, kind } = review.checkParams.parse(req.params);
  const { status, note } = review.checkBody.parse(req.body ?? {});
  res.status(OK).json({ message: "Check updated", result: await partnerApplicationService.setCheck(actor, id, kind, status, note) });
}));
r.post("/partner-applications/:id/documents/:docId/review", canWrite("feat_partner_review", "review_documents"), wrap(async (req, res, actor) => {
  const { id, docId } = review.documentParams.parse(req.params);
  const { status, note } = review.documentBody.parse(req.body ?? {});
  res.status(OK).json({ message: "Document updated", result: await partnerApplicationService.setDocument(actor, id, docId, status, note) });
}));
// Every view is recorded before the 60-second link is made (0630).
r.post("/partner-applications/:id/documents/:docId/view", can("feat_partner_review", "view_documents"), wrap(async (req, res, actor) => {
  const { id, docId } = review.documentParams.parse(req.params);
  res.status(OK).json({ message: "Document link created", ...(await partnerApplicationService.viewDocument(actor, id, docId)) });
}));
r.post("/partner-applications/:id/hold", canWrite("feat_partner_review", "hold_partner"), wrap(async (req, res, actor) => {
  const { id } = idParams.parse(req.params);
  const { hold, reason } = review.platformHoldBody.parse(req.body ?? {});
  res.status(OK).json({ message: hold ? "Partner put on hold" : "Partner hold lifted", result: await partnerApplicationService.setHold(actor, id, hold, reason) });
}));

// ------------------------------------------------------------ order holds
// Orders held for review (ol_order_holds). Decisions go through One Local, which sends the order on or refunds it.
r.get("/order-holds", can("feat_orders", "view_orders"), wrap(async (req, res) => {
  res.status(OK).json({ message: "Order holds fetched successfully", ...(await orderHoldService.list(review.holdsQuery.parse(req.query))) });
}));
r.get("/order-holds/:id", can("feat_orders", "view_orders"), wrap(async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.status(OK).json({ message: "Order hold fetched successfully", ...(await orderHoldService.get(id)) });
}));
for (const [verb, msg] of [
  ["release", "Order released to the restaurant"],
  ["reject", "Order rejected and cancelled"],
] as const) {
  r.post(`/order-holds/:id/${verb}`, canWrite("feat_orders", "decide_order_holds"), wrap(async (req, res, actor) => {
    const { id } = idParams.parse(req.params);
    const { reason } = review.holdDecisionBody.parse(req.body ?? {});
    res.status(OK).json({ message: msg, result: await orderHoldService.decide(actor, req.token ?? "", id, verb, reason) });
  }));
}

// --------------------------------------------------------------- customer-app pop-ups (owned by One Local)
// Master calls One Local server to server with the staff member's session; the browser never calls One Local.
const popupId = z.object({ id: z.string().regex(/^[A-Za-z0-9-]{1,64}$/, "Invalid pop-up id") });
const popupDraft = z.record(z.unknown());
r.get("/popups", can("feat_customer_popups", "view_popups"), wrap(async (req, res) => {
  const { status } = z.object({ status: z.enum(["draft", "submitted", "approved", "live", "ended"]).optional() }).parse(req.query);
  res.status(OK).json(await popupsService.list(req.token ?? "", status));
}));
r.get("/popups/:id", can("feat_customer_popups", "view_popups"), wrap(async (req, res) => {
  res.status(OK).json(await popupsService.get(req.token ?? "", popupId.parse(req.params).id));
}));
r.get("/popups/:id/results", can("feat_customer_popups", "view_popups"), wrap(async (req, res) => {
  res.status(OK).json(await popupsService.results(req.token ?? "", popupId.parse(req.params).id));
}));
r.post("/popups", canWrite("feat_customer_popups", "manage_popups"), wrap(async (req, res, actor) => {
  res.status(HTTPSTATUS.CREATED).json(await popupsService.create(actor, req.token ?? "", popupDraft.parse(req.body ?? {})));
}));
r.put("/popups/:id", canWrite("feat_customer_popups", "manage_popups"), wrap(async (req, res, actor) => {
  const { id } = popupId.parse(req.params);
  res.status(OK).json(await popupsService.update(actor, req.token ?? "", id, popupDraft.parse(req.body ?? {})));
}));
r.post("/popups/:id/status", canWrite("feat_customer_popups", "manage_popups"), wrap(async (req, res, actor) => {
  const { id } = popupId.parse(req.params);
  const b = z
    .object({ action: z.enum(["submit", "return", "approve", "end"]), note: z.string().trim().max(500).optional() })
    .parse(req.body ?? {});
  res.status(OK).json(await popupsService.act(actor, req.token ?? "", id, b.action, b.note));
}));
r.post("/popups/media/upload-url", canWrite("feat_customer_popups", "manage_popups"), wrap(async (req, res) => {
  const b = z
    .object({ content_type: z.string().min(3).max(100), filename: z.string().min(1).max(200), size: z.number().int().positive() })
    .parse(req.body ?? {});
  res.status(OK).json(await popupsService.uploadUrl(req.token ?? "", b));
}));

// --------------------------------------------------------------- pipeline
// Master follows the event log (domain_events). Status reads only; follow moves Master's bookmark and its counters.
r.get("/pipeline/status", can("feat_orders", "view_orders"), wrap(async (req, res) => {
  const { minutes } = pipelineStatusQuery.parse(req.query);
  res.status(OK).json({ message: "Pipeline status fetched successfully", ...(await pipelineService.status(minutes)) });
}));
r.post("/pipeline/follow", canWrite("feat_orders", "run_pipeline"), wrap(async (_req, res) => {
  res.status(OK).json({ message: "Event follower ran", result: await pipelineService.follow() });
}));

// ------------------------------------------------------------------ audit
r.get("/audit-logs", can("feat_audit_compliance", "view_audit_logs"), wrap(async (req, res) => {
  res.status(OK).json({ message: "Audit logs fetched successfully", ...(await readService.auditLogs(ops.auditQuery.parse(req.query))) });
}));

export default r;
