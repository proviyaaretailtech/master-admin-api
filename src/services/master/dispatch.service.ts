import { Actor } from "../../utils/authz";
import { dispatchRequest } from "./dispatch-client";
import { Row, recordAudit } from "./common";
import { readService } from "./read.service";

const enc = encodeURIComponent;

export const dispatchService = {
  async reassign(actor: Actor, jobId: string, reason: string, key?: string) {
    const { job } = await readService.dispatchJob(jobId);
    const out = await dispatchRequest("POST", `/api/dispatch/jobs/${enc(jobId)}/reassign`, { reason }, key);
    await recordAudit(actor, "dispatch.job_reassign", "delivery_jobs", jobId, (job.organization_id as string) ?? null, { reason });
    return out;
  },

  /** reason is the operator's free text; the dispatch API takes a fixed code, sent as `code` (default "other"). */
  async cancel(actor: Actor, jobId: string, reason: string, code: string, key?: string) {
    const { job } = await readService.dispatchJob(jobId);
    const out = await dispatchRequest("POST", `/api/dispatch/jobs/${enc(jobId)}/cancel`, { reason: code, expected_version: job.version }, key);
    await recordAudit(actor, "dispatch.job_cancel", "delivery_jobs", jobId, (job.organization_id as string) ?? null, { reason, code });
    return out;
  },

  async resolveException(actor: Actor, exceptionId: string, outcome: string, note: string | undefined, key?: string) {
    const ex: Row = await readService.exceptionJob(exceptionId);
    const out = await dispatchRequest("POST", `/api/dispatch/exceptions/${enc(exceptionId)}/resolve`, { outcome, note: note ?? null }, key);
    await recordAudit(actor, "dispatch.exception_resolve", "delivery_exceptions", exceptionId, (ex.organization_id as string) ?? null, { outcome, note: note ?? null });
    return out;
  },
};
