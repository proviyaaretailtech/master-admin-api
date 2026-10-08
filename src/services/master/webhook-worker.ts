import { createHmac } from "crypto";
import { query } from "../../config/database.config";

/**
 * Webhook fan-out and delivery (0309 leaves both to the backend). Honest about provider state:
 *  - enqueueForEvent() writes one delivery per subscribed active endpoint (idempotent per event id).
 *  - deliverDue() claims due deliveries. The signing secret is read from the vault by endpoint.secret_ref, and no
 *    vault client exists in this build, so every attempt is RECORDED AS FAILED with error "provider_not_configured"
 *    (backoff and the dead state then follow from the database). Nothing is sent over the network.
 * Neither is scheduled automatically; a worker calls them (e.g. every 30 s).
 */
export function signWebhookBody(secret: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export async function enqueueForEvent(eventType: string, payload: Record<string, unknown>, eventId: string, organizationId?: string | null): Promise<number> {
  const eps = await query<{ id: string }>(
    `SELECT id FROM webhook_endpoints WHERE status = 'active' AND ('*' = ANY(events) OR $1 = ANY(events)) AND (organization_id IS NULL OR organization_id IS NOT DISTINCT FROM $2::uuid);`,
    [eventType, organizationId ?? null]
  );
  let n = 0;
  for (const e of eps.rows) {
    const r = await query<{ r: { changed: boolean } }>(`SELECT public.webhook_enqueue($1::uuid, $2::text, $3::jsonb, $4::text, $5::uuid) AS r;`, [e.id, eventType, JSON.stringify(payload), `event:${eventId}`, eventId]);
    if (r.rows[0].r.changed) n++;
  }
  return n;
}

export async function deliverDue(limit = 20): Promise<{ claimed: number; failed: number }> {
  const c = await query<{ id: string }>(`SELECT id FROM public.webhook_delivery_claim($1::int);`, [limit]);
  for (const d of c.rows) {
    await query(`SELECT public.webhook_delivery_record($1::uuid, false, NULL, 'provider_not_configured: no vault client to read the signing secret', 0);`, [d.id]);
  }
  return { claimed: c.rows.length, failed: c.rows.length };
}
