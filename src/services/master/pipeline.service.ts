import { pool, query } from "../../config/database.config";

/**
 * Master follows the event log (domain_events, the receipt of every write; specs/event-spine-orders/spec.md).
 *
 * One bookmark ("master") in event_cursors. Each batch runs in ONE transaction: lock the bookmark, read the next events
 * (events_peek only returns events from transactions that can no longer commit behind it), add them to the per-minute
 * pipeline counters, move the bookmark (events_ack). Counters and bookmark commit together, so a crash re-reads the batch
 * and never counts it twice; a second follower waits on the lock instead of double counting.
 */
export const PIPELINE_CONSUMER = "master";
const BATCH = 500;

type EventRow = { id: string; tx_id: string; event_type: string; source: string; via: string; occurred_at: Date };

export const pipelineService = {
  /** One batch. Returns how many events were taken in. */
  async followOnce(limit = BATCH): Promise<{ processed: number; last_id: string | null }> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.source', 'master', true), set_config('app.via', 'master', true);");
      await client.query("INSERT INTO event_cursors(consumer) VALUES ($1) ON CONFLICT (consumer) DO NOTHING;", [PIPELINE_CONSUMER]);
      await client.query("SELECT 1 FROM event_cursors WHERE consumer = $1 FOR UPDATE;", [PIPELINE_CONSUMER]);
      const batch = await client.query<EventRow>(
        `SELECT id::text, tx_id::text, event_type, source, via, occurred_at FROM public.events_peek($1, $2);`,
        [PIPELINE_CONSUMER, limit]
      );
      if (batch.rows.length === 0) {
        await client.query("COMMIT");
        return { processed: 0, last_id: null };
      }
      const counts = new Map<string, { minute: string; type: string; source: string; via: string; n: number }>();
      for (const e of batch.rows) {
        const minute = new Date(Math.floor(new Date(e.occurred_at).getTime() / 60000) * 60000).toISOString();
        const key = `${minute}|${e.event_type}|${e.source}|${e.via}`;
        const c = counts.get(key) ?? { minute, type: e.event_type, source: e.source, via: e.via, n: 0 };
        c.n += 1;
        counts.set(key, c);
      }
      const rows = [...counts.values()];
      await client.query(
        `INSERT INTO pipeline_minute_stats(minute, event_type, source, via, events)
         SELECT * FROM unnest($1::timestamptz[], $2::text[], $3::text[], $4::text[], $5::bigint[])
         ON CONFLICT (minute, event_type, source, via) DO UPDATE SET events = pipeline_minute_stats.events + EXCLUDED.events;`,
        [rows.map((r) => r.minute), rows.map((r) => r.type), rows.map((r) => r.source), rows.map((r) => r.via), rows.map((r) => r.n)]
      );
      const last = batch.rows[batch.rows.length - 1];
      await client.query("SELECT public.events_ack($1, $2::xid8, $3::bigint);", [PIPELINE_CONSUMER, last.tx_id, last.id]);
      await client.query("COMMIT");
      return { processed: batch.rows.length, last_id: last.id };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  },

  /** Catches up in batches (bounded, so one call never runs long). */
  async follow(maxBatches = 20): Promise<{ processed: number; batches: number; caught_up: boolean; lag: Record<string, unknown> }> {
    let processed = 0;
    let batches = 0;
    let caughtUp = false;
    while (batches < maxBatches) {
      const r = await this.followOnce(BATCH);
      batches += 1;
      processed += r.processed;
      if (r.processed < BATCH) {
        caughtUp = true;
        break;
      }
    }
    return { processed, batches, caught_up: caughtUp, lag: await this.lag() };
  },

  async lag(): Promise<Record<string, unknown>> {
    const r = await query<{ lag: Record<string, unknown> }>("SELECT public.events_lag($1) AS lag;", [PIPELINE_CONSUMER]);
    return r.rows[0].lag;
  },

  /** The pipeline at a glance: the follower's position, and what flowed in the last hour by pipe, app and event type. */
  async status(windowMinutes = 60) {
    const since = `now() - make_interval(mins => $1)`;
    const [lag, byVia, bySource, byType, perMinute, unregistered] = await Promise.all([
      this.lag(),
      query(`SELECT via, sum(events)::int AS events FROM pipeline_minute_stats WHERE minute >= ${since} GROUP BY via ORDER BY 2 DESC;`, [windowMinutes]),
      query(`SELECT source, sum(events)::int AS events FROM pipeline_minute_stats WHERE minute >= ${since} GROUP BY source ORDER BY 2 DESC;`, [windowMinutes]),
      query(
        `SELECT event_type, sum(events)::int AS events FROM pipeline_minute_stats WHERE minute >= ${since} GROUP BY event_type ORDER BY 2 DESC, 1 LIMIT 25;`,
        [windowMinutes]
      ),
      query(
        `SELECT minute, sum(events)::int AS events, sum(events) FILTER (WHERE via = 'master')::int AS via_master
           FROM pipeline_minute_stats WHERE minute >= ${since} GROUP BY minute ORDER BY minute;`,
        [windowMinutes]
      ),
      // event types that reached the log before anyone registered them (emit_event keeps them and flags them)
      query(
        `SELECT event_type, count(*)::int AS events FROM domain_events
          WHERE NOT type_registered AND occurred_at >= now() - interval '24 hours' GROUP BY event_type ORDER BY 2 DESC LIMIT 25;`
      ),
    ]);
    return {
      window_minutes: windowMinutes,
      follower: lag,
      by_via: byVia.rows,
      by_source: bySource.rows,
      by_type: byType.rows,
      per_minute: perMinute.rows,
      unregistered_types_24h: unregistered.rows,
    };
  },
};
