import { Pool, PoolClient, PoolConfig, QueryResult, QueryResultRow, types } from "pg";
import { Env } from "./env.config";
import { isLocalDatabaseUrl, sslForDatabaseUrl, stripSslParams } from "./ssl.config";

/**
 * Builds PoolConfig supporting IPv4 pooler for Supabase
 */
export function buildPoolConfig(
  rawUrl: string = Env.DATABASE_URL || process.env.DATABASE_URL || "",
  env: NodeJS.ProcessEnv = process.env
): PoolConfig {
  if (!rawUrl) {
    console.warn("⚠️ DATABASE_URL is not set. Database operations will fail.");
    return {
      connectionString: "postgresql://localhost:5432/postgres",
    };
  }

  // Check if user provided direct db.[ref].supabase.co format
  const directMatch = rawUrl
    .trim()
    .match(/postgresql:\/\/([^:]+):(.*)@db\.([a-z0-9]+)\.supabase\.co:?(\d+)?\/(.*)/);
  if (directMatch) {
    const [, , passRaw, projectRef, , dbRaw] = directMatch;
    const database = dbRaw ? dbRaw.split("?")[0] : "postgres";

    return {
      host: "aws-0-ap-south-1.pooler.supabase.com",
      port: 6543,
      user: `postgres.${projectRef}`,
      password: passRaw,
      database,
      // Certificate-verified (see ssl.config.ts); a hosted database is never local.
      ssl: sslForDatabaseUrl("postgresql://remote.invalid/", env),
      max: 10,
      idleTimeoutMillis: 30000,
    };
  }

  const url = rawUrl.trim();
  const local = isLocalDatabaseUrl(url);
  return {
    // For a remote database the TLS settings below are authoritative: drop sslmode/ssl from the URL, which
    // node-postgres would otherwise let override them (and silently discard a pinned CA).
    connectionString: local ? url : stripSslParams(url),
    ssl: local ? false : sslForDatabaseUrl(url, env),
    max: 10,
    idleTimeoutMillis: 30000,
  };
}

// Money is stored as integer minor units in bigint columns; node-postgres returns bigint as a string by default.
// Minor-unit amounts and counts stay far below 2^53, so the API reports them as JSON numbers.
types.setTypeParser(20, (v: string) => Number(v));

export const pool = new Pool(buildPoolConfig());

pool.on("error", (err) => {
  console.error("Unexpected error on idle PostgreSQL client", err);
});

/**
 * Executes a parameterized SQL query against Supabase PostgreSQL.
 * Parameterized queries are 100% immune to SQL injection.
 */
export const query = async <T extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> => {
  return pool.query<T>(text, params);
};

/**
 * Runs ONE write statement attributed to a staff member. The control plane connects as the database owner, so
 * the audit triggers (audit_row_change) would otherwise record no actor; setting the request's JWT subject for
 * the duration of a transaction makes auth.uid() - and so audit_logs.actor_user_id - the staff member who
 * made the change. Use it for privileged mutations (roles, staff, plan / pack / add-on lifecycle).
 */
export const queryAs = async <T extends QueryResultRow = QueryResultRow>(
  actorId: string | null | undefined,
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> => {
  if (!actorId) return pool.query<T>(text, params);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true);", [actorId]);
    const result = await client.query<T>(text, params);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Runs several statements in ONE transaction attributed to a staff member (same audit mechanism as queryAs).
 * The callback receives a client; commit on return, rollback on throw.
 */
export const txAs = async <T>(
  actorId: string | null | undefined,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (actorId) await client.query("SELECT set_config('request.jwt.claim.sub', $1, true);", [actorId]);
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
};

export default pool;
