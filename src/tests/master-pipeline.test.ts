/**
 * Master follows the event log (0590, specs/event-spine-orders/spec.md): the follower takes every committed event in, counts
 * it once per minute / type / app / pipe, and moves its bookmark in the same transaction, so re-running or running two followers
 * at once never counts an event twice. Status reads only.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../index";
import { pool, query } from "../config/database.config";
import { cleanup, TestStaff } from "./helpers/testkit";
import { staffWith, bearer, tag } from "./helpers/master-kit";
import { pipelineService } from "../services/master/pipeline.service";

const TYPE = "test.pipeline_follow";

/** Commits `n` events of the test type in their own transaction, optionally as if written through the Master pipe. */
async function emit(n: number, opts: { via?: "master"; source?: string } = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (opts.via) await client.query("SELECT set_config('app.via', 'master', true);");
    if (opts.source) await client.query("SELECT set_config('app.source', $1, true);", [opts.source]);
    for (let i = 0; i < n; i++) {
      await client.query("SELECT public.emit_event($1, NULL, 'test', $2, '{}'::jsonb);", [TYPE, `pipe-${tag()}`]);
    }
    await client.query("COMMIT");
  } finally {
    client.release();
  }
}

/** Events of the test type counted so far, per pipe. */
async function counted(): Promise<{ direct: number; master: number }> {
  const r = await query<{ via: string; n: number }>(
    "SELECT via, sum(events)::int AS n FROM pipeline_minute_stats WHERE event_type = $1 GROUP BY via;",
    [TYPE]
  );
  const by = Object.fromEntries(r.rows.map((x) => [x.via, x.n]));
  return { direct: by.direct ?? 0, master: by.master ?? 0 };
}

describe("Master: event pipeline follower", () => {
  const roleKeys: string[] = [];
  const staffIds: string[] = [];
  let runner: TestStaff;
  let viewer: TestStaff;

  beforeAll(async () => {
    await query("INSERT INTO event_types(type, version, description) VALUES ($1, 1, 'Master pipeline test') ON CONFLICT DO NOTHING;", [TYPE]);
    runner = await staffWith({ feat_orders: ["view_orders", "run_pipeline"] }, roleKeys);
    viewer = await staffWith({ feat_orders: ["view_orders"] }, roleKeys);
    staffIds.push(runner.id, viewer.id);
    await pipelineService.follow(1000); // start from a caught-up bookmark
  });
  afterAll(async () => {
    await cleanup({ staffIds, roleKeys });
  });

  it("takes every committed event in, counts it under its pipe and app, and catches up", async () => {
    const before = await counted();
    await emit(3);
    await emit(2, { via: "master", source: "customer" });
    const res = await request(app).post("/api/pipeline/follow").set(bearer(runner));
    expect(res.status).toBe(200);
    expect(res.body.result.caught_up).toBe(true);
    expect(res.body.result.lag.behind).toBe(0);
    const after = await counted();
    expect(after.direct - before.direct).toBe(3);
    expect(after.master - before.master).toBe(2);
  });

  it("running it again counts nothing twice", async () => {
    const before = await counted();
    const res = await request(app).post("/api/pipeline/follow").set(bearer(runner));
    expect(res.status).toBe(200);
    expect(await counted()).toEqual(before);
  });

  it("two followers at once still count each event exactly once", async () => {
    const before = await counted();
    await emit(7);
    await Promise.all([pipelineService.followOnce(3), pipelineService.followOnce(3), pipelineService.followOnce(3)]);
    await pipelineService.follow();
    const after = await counted();
    expect(after.direct - before.direct).toBe(7);
  });

  it("status shows the follower's position and what flowed, by pipe, app and type", async () => {
    await emit(1, { via: "master", source: "pos" });
    await pipelineService.follow();
    const res = await request(app).get("/api/pipeline/status?minutes=60").set(bearer(viewer));
    expect(res.status).toBe(200);
    expect(res.body.follower.consumer).toBe("master");
    expect(res.body.follower.behind).toBe(0);
    expect(res.body.by_via.map((x: { via: string }) => x.via)).toContain("master");
    expect(res.body.by_source.map((x: { source: string }) => x.source)).toContain("pos");
    expect(res.body.by_type.find((x: { event_type: string }) => x.event_type === TYPE)?.events).toBeGreaterThan(0);
  });

  it("status only reads: viewing does not move the bookmark", async () => {
    await emit(2);
    const lagBefore = await pipelineService.lag();
    await request(app).get("/api/pipeline/status").set(bearer(viewer));
    const lagAfter = await pipelineService.lag();
    expect(lagAfter.last_id).toBe(lagBefore.last_id);
    expect(lagAfter.behind).toBe(2);
    await pipelineService.follow();
  });

  it("a viewer can see the status but cannot run the follower", async () => {
    const res = await request(app).post("/api/pipeline/follow").set(bearer(viewer));
    expect(res.status).toBe(403);
  });

  it("an out-of-range window is refused", async () => {
    const res = await request(app).get("/api/pipeline/status?minutes=99999").set(bearer(viewer));
    expect(res.status).toBe(400);
  });
});
