import { Actor } from "../../utils/authz";
import { Row, recordAudit } from "./common";
import { oneLocalAdminRequest } from "./one-local-client";

/**
 * Customer-app pop-ups (ol_popups) are owned by the One Local server. The Master panel reaches them only
 * through this server, server to server, with the signed-in staff member's own session: One Local
 * re-checks that the caller is an active platform admin, and Master records who changed what.
 * The browser never calls One Local directly.
 */
const BASE = "/api/admin/popups";
const enc = encodeURIComponent;

export type PopupAction = "submit" | "return" | "approve" | "end";

export const popupsService = {
  list(token: string, status?: string) {
    const qs = status ? `?status=${enc(status)}` : "";
    return oneLocalAdminRequest<unknown[]>("GET", `${BASE}${qs}`, token);
  },

  get(token: string, id: string) {
    return oneLocalAdminRequest("GET", `${BASE}/${enc(id)}`, token);
  },

  results(token: string, id: string) {
    return oneLocalAdminRequest("GET", `${BASE}/${enc(id)}/results`, token);
  },

  async create(actor: Actor, token: string, draft: Row) {
    const popup = await oneLocalAdminRequest<Row>("POST", BASE, token, draft);
    await recordAudit(actor, "popup.created", "ol_popups", String(popup.id ?? ""), null, {
      title: popup.title ?? draft.title ?? null,
      format: popup.format ?? draft.format ?? null,
      via: "one_local_admin_api",
    });
    return popup;
  },

  async update(actor: Actor, token: string, id: string, draft: Row) {
    const popup = await oneLocalAdminRequest<Row>("PUT", `${BASE}/${enc(id)}`, token, draft);
    await recordAudit(actor, "popup.updated", "ol_popups", id, null, { via: "one_local_admin_api" });
    return popup;
  },

  async act(actor: Actor, token: string, id: string, action: PopupAction, note?: string) {
    const popup = await oneLocalAdminRequest<Row>("POST", `${BASE}/${enc(id)}/status`, token, { action, note });
    await recordAudit(actor, `popup.${action}`, "ol_popups", id, null, {
      status: popup.status ?? null,
      note: note ?? null,
      via: "one_local_admin_api",
    });
    return popup;
  },

  /** A signed upload address for the pop-ups folder; the browser then uploads the file straight to storage. */
  uploadUrl(token: string, body: Row) {
    return oneLocalAdminRequest("POST", "/api/admin/media/upload-url", token, { ...body, folder: "popups" });
  },
};
