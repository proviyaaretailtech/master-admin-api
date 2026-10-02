import { Pool, PoolConfig, QueryResult, QueryResultRow } from "pg";
import { Env } from "./env.config";

/**
 * Builds PoolConfig supporting IPv4 pooler for Supabase
 */
function buildPoolConfig(): PoolConfig {
  const rawUrl = Env.DATABASE_URL || process.env.DATABASE_URL || "";

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
      password: passRaw.replace(/^"|"$/g, ""),
      database,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
    };
  }

  const isLocal = rawUrl.includes("localhost") || rawUrl.includes("127.0.0.1");

  return {
    connectionString: rawUrl.trim(),
    ssl: isLocal ? false : { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
  };
}

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

export default pool;
