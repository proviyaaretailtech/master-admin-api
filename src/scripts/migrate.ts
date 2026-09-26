import "dotenv/config";
import fs from "fs";
import path from "path";
import { Client, ClientConfig } from "pg";
import { Env } from "../config/env.config";

/**
 * Builds a working ClientConfig from DATABASE_URL.
 * Supports IPv4 pooler fallback for Supabase when direct IPv6 domain fails.
 */
function buildClientConfig(rawUrl: string): ClientConfig {
  const trimmed = rawUrl.trim();

  try {
    // If user provided direct db.[ref].supabase.co, we convert to IPv4 pooler
    const directMatch = trimmed.match(
      /postgresql:\/\/([^:]+):(.*)@db\.([a-z0-9]+)\.supabase\.co:?(\d+)?\/(.*)/
    );
    if (directMatch) {
      const [, , passRaw, projectRef, , dbRaw] = directMatch;
      const pass = passRaw;
      const database = dbRaw ? dbRaw.split("?")[0] : "postgres";

      console.log(`ℹ️ Converting direct IPv6 URL to Supabase IPv4 Pooler (ap-south-1)...`);
      return {
        host: "aws-0-ap-south-1.pooler.supabase.com",
        port: 6543,
        user: `postgres.${projectRef}`,
        password: pass,
        database,
        ssl: { rejectUnauthorized: false },
      };
    }
  } catch (e) {
    // fallback
  }

  const isLocal = trimmed.includes("localhost") || trimmed.includes("127.0.0.1");

  return {
    connectionString: trimmed,
    ssl: isLocal ? false : { rejectUnauthorized: false },
  };
}

async function runMigrations() {
  console.log("=========================================");
  console.log("🚀 Supabase Database Migration Runner");
  console.log("=========================================");

  const migrationsDir = path.resolve(__dirname, "../../migrations");

  if (!fs.existsSync(migrationsDir)) {
    console.error(`❌ Migrations directory not found at: ${migrationsDir}`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log("ℹ️ No SQL migration files found.");
    return;
  }

  const databaseUrl = Env.DATABASE_URL || process.env.DATABASE_URL;

  if (!databaseUrl || databaseUrl.includes("your-project")) {
    console.log("\n⚠️ DATABASE_URL is not configured in backend/.env!");
    return;
  }

  const clientConfig = buildClientConfig(databaseUrl);
  console.log(`🔌 Connecting to Supabase database host: ${(clientConfig as any).host}...`);

  const client = new Client(clientConfig);

  try {
    await client.connect();
    console.log("✅ Connected successfully to Supabase PostgreSQL!\n");

    // 1. Ensure the migration log table exists in the database
    console.log("📋 Checking migration log table (_migrations)...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        executed_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    // 2. Fetch all previously recorded migrations from the database
    const { rows } = await client.query<{ name: string }>(
      "SELECT name FROM _migrations ORDER BY id ASC;"
    );
    const executedSet = new Set(rows.map((r) => r.name));

    let appliedCount = 0;
    let skippedCount = 0;

    // 3. Iterate through migration files and execute only unapplied migrations
    for (const file of files) {
      if (executedSet.has(file)) {
        console.log(`⏩ [ALREADY COMPLETED] Skipping: ${file}`);
        skippedCount++;
        continue;
      }

      console.log(`⏳ Executing pending migration: ${file}...`);
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, "utf-8");

      try {
        // Run migration in a transaction for data integrity
        await client.query("BEGIN;");
        await client.query(sql);

        // Record successful execution into _migrations log table
        await client.query("INSERT INTO _migrations (name, executed_at) VALUES ($1, now());", [
          file,
        ]);
        await client.query("COMMIT;");

        console.log(`✅ [APPLIED & RECORDED IN DB]: ${file}\n`);
        appliedCount++;
      } catch (err: any) {
        await client.query("ROLLBACK;");
        console.error(`\n❌ Migration failed on ${file}: ${err.message}`);
        throw err;
      }
    }

    console.log("=========================================");
    if (appliedCount === 0) {
      console.log(
        `✨ All ${skippedCount} migration(s) are already completed! No pending migrations to run.`
      );
    } else {
      console.log(
        `🎉 Successfully applied ${appliedCount} new migration(s)! (${skippedCount} previously completed)`
      );
    }
    console.log("=========================================");
  } catch (error: any) {
    console.error(`\n❌ Migration execution error: ${error.message}`);
    process.exit(1);
  } finally {
    try {
      await client.end();
    } catch {
      // ignore
    }
  }
}

runMigrations();
