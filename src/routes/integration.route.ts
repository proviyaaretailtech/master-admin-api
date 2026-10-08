import { Router, Request } from "express";
import { HTTPSTATUS } from "../config/http.config";
import { wrap, can, canWrite } from "../utils/master-http";
import { idParams } from "../validators/master.validator";
import * as pv from "../validators/master-platform.validator";
import { integrationService } from "../services/master/integration.service";
import { platformService } from "../services/master/platform.service";

/** Integration Centre, CRM / CMS mappings, API apps and webhooks (spec: Integrations, API & webhooks). */
const r = Router();
const OK = HTTPSTATUS.OK;
const idem = (req: Request) => {
  const k = req.header("idempotency-key");
  return k && /^[\w:.-]{8,200}$/.test(k) ? k : undefined;
};

// ----------------------------------------------------------- integrations
r.get("/integrations", can("feat_integrations", "view_integrations"), wrap(async (req, res) => {
  res.status(OK).json({ message: "Integrations fetched successfully", ...(await integrationService.list(pv.integrationsQuery.parse(req.query))) });
}));
r.post("/integrations", canWrite("feat_integrations", "manage_integrations"), wrap(async (req, res, actor) => {
  const integration = await integrationService.create(actor, pv.integrationCreateBody.parse(req.body));
  res.status(HTTPSTATUS.CREATED).json({ message: "Integration registered", integration });
}));
r.get("/integrations/:id", can("feat_integrations", "view_integrations"), wrap(async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.status(OK).json({ message: "Integration fetched successfully", ...(await integrationService.get(id)) });
}));
r.put("/integrations/:id", canWrite("feat_integrations", "manage_integrations"), wrap(async (req, res, actor) => {
  const { id } = idParams.parse(req.params);
  res.status(OK).json({ message: "Integration updated", integration: await integrationService.update(actor, id, pv.integrationUpdateBody.parse(req.body)) });
}));
r.post("/integrations/:id/test", canWrite("feat_integrations", "manage_integrations"), wrap(async (req, res, actor) => {
  const { id } = idParams.parse(req.params);
  await integrationService.run(actor, id, "test");
}));
r.post("/integrations/:id/sync", canWrite("feat_integrations", "manage_integrations"), wrap(async (req, res, actor) => {
  const { id } = idParams.parse(req.params);
  await integrationService.run(actor, id, "sync");
}));
r.post("/integrations/:id/disable", canWrite("feat_integrations", "manage_integrations"), wrap(async (req, res, actor) => {
  const { id } = idParams.parse(req.params);
  const { reason } = pv.integrationDisableBody.parse(req.body ?? {});
  res.status(OK).json({ message: "Integration disabled", ...(await integrationService.setEnabled(actor, id, false, reason ?? "Disabled from Master")) });
}));
r.post("/integrations/:id/enable", canWrite("feat_integrations", "manage_integrations"), wrap(async (req, res, actor) => {
  const { id } = idParams.parse(req.params);
  const b = pv.integrationToggleBody.parse(req.body ?? {});
  res.status(OK).json({ message: "Integration enabled", ...(await integrationService.setEnabled(actor, id, true, b.reason)) });
}));
r.post("/integrations/:id/rotate-credentials", canWrite("feat_integrations", "manage_integrations"), wrap(async (req, res, actor) => {
  const { id } = idParams.parse(req.params);
  const { credential_ref } = pv.rotateBody.parse(req.body ?? {});
  res.status(OK).json({ message: "Credentials rotated", integration: await integrationService.rotate(actor, id, credential_ref) });
}));
r.get("/integrations/:id/logs", can("feat_integrations", "view_integrations"), wrap(async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.status(OK).json({ message: "Integration logs fetched successfully", ...(await integrationService.logs(id, pv.logsQuery.parse(req.query))) });
}));
r.get("/integrations/:id/mappings", can("feat_integrations", "view_integrations"), wrap(async (req, res) => {
  const { id } = idParams.parse(req.params);
  const { kind } = pv.mappingsQuery.parse(req.query);
  res.status(OK).json({ message: "Mappings fetched successfully", ...(await integrationService.mappings(id, kind)) });
}));
r.put("/integrations/:id/mappings", canWrite("feat_integrations", "manage_integrations"), wrap(async (req, res, actor) => {
  const { id } = idParams.parse(req.params);
  if (req.body && Array.isArray((req.body as { mappings?: unknown }).mappings)) {
    const ui = pv.mappingsUiBody.parse(req.body);
    res.status(OK).json({ message: "Mappings saved", ...(await integrationService.setAllMappings(actor, id, ui.mappings)) });
    return;
  }
  const b = pv.mappingsBody.parse(req.body);
  res.status(OK).json({ message: "Mappings saved", ...(await integrationService.setMappings(actor, id, b.kind, b.items)) });
}));

// ------------------------------------------------------------- api & webhooks
r.get("/api-apps", can("feat_api_webhooks", "view_api_webhooks"), wrap(async (req, res) => {
  res.status(OK).json({ message: "API apps fetched successfully", ...(await platformService.listApps(pv.apiAppsQuery.parse(req.query))) });
}));
r.post("/api-apps", canWrite("feat_api_webhooks", "manage_api_webhooks"), wrap(async (req, res, actor) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(HTTPSTATUS.CREATED).json({ message: "API app created", ...(await platformService.createApp(actor, pv.apiAppCreateBody.parse(req.body))) });
}));
r.post("/api-apps/:id/rotate", canWrite("feat_api_webhooks", "manage_api_webhooks"), wrap(async (req, res, actor) => {
  const { id } = idParams.parse(req.params);
  res.setHeader("Cache-Control", "no-store");
  res.status(OK).json({ message: "API key rotated", ...(await platformService.rotateApp(actor, id, pv.apiAppRotateBody.parse(req.body ?? {}))) });
}));
r.post("/api-apps/:id/revoke", canWrite("feat_api_webhooks", "manage_api_webhooks"), wrap(async (req, res, actor) => {
  const { id } = idParams.parse(req.params);
  const { reason } = pv.disableBody.parse(req.body);
  res.status(OK).json({ message: "API app revoked", ...(await platformService.revokeApp(actor, id, reason)) });
}));
r.get("/api-logs", can("feat_api_webhooks", "view_api_webhooks"), wrap(async (req, res) => {
  res.status(OK).json({ message: "API logs fetched successfully", ...(await platformService.apiLogs(pv.apiLogsQuery.parse(req.query))) });
}));
r.get("/webhooks", can("feat_api_webhooks", "view_api_webhooks"), wrap(async (req, res) => {
  res.status(OK).json({ message: "Webhooks fetched successfully", ...(await platformService.listWebhooks(pv.webhooksQuery.parse(req.query))) });
}));
r.post("/webhooks", canWrite("feat_api_webhooks", "manage_api_webhooks"), wrap(async (req, res, actor) => {
  res.status(HTTPSTATUS.CREATED).json({ message: "Webhook created", webhook: await platformService.createWebhook(actor, pv.webhookCreateBody.parse(req.body)) });
}));
r.post("/webhooks/:id/test", canWrite("feat_api_webhooks", "manage_api_webhooks"), wrap(async (req, res, actor) => {
  const { id } = idParams.parse(req.params);
  res.status(HTTPSTATUS.ACCEPTED).json({ message: "Test delivery queued", ...(await platformService.testWebhook(actor, id)) });
}));
r.post("/webhooks/:id/disable", canWrite("feat_api_webhooks", "manage_api_webhooks"), wrap(async (req, res, actor) => {
  const { id } = idParams.parse(req.params);
  const { reason } = pv.webhookDisableBody.parse(req.body);
  res.status(OK).json({ message: "Webhook disabled", ...(await platformService.disableWebhook(actor, id, reason)) });
}));
r.get("/webhook-deliveries", can("feat_api_webhooks", "view_api_webhooks"), wrap(async (req, res) => {
  res.status(OK).json({ message: "Webhook deliveries fetched successfully", ...(await platformService.deliveries(pv.webhookDeliveriesQuery.parse(req.query))) });
}));
r.post("/webhook-deliveries/:id/retry", canWrite("feat_api_webhooks", "manage_api_webhooks"), wrap(async (req, res, actor) => {
  const { id } = idParams.parse(req.params);
  res.status(OK).json({ message: "Delivery queued for retry", ...(await platformService.retryDelivery(actor, id)) });
}));
r.post("/webhook-deliveries/:id/replay", canWrite("feat_api_webhooks", "manage_api_webhooks"), wrap(async (req, res, actor) => {
  const { id } = idParams.parse(req.params);
  res.status(HTTPSTATUS.CREATED).json({ message: "Delivery replayed", ...(await platformService.replayDelivery(actor, id, idem(req))) });
}));

export default r;
