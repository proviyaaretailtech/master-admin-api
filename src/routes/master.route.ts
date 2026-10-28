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
import { orderHoldService } from "../services/master/order-hold.service";
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
