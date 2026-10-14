/**
 * Global test setup: (1) refuses to run against anything but a local *_test database, and
 * (2) replaces the Supabase auth client with a deterministic fake so tests never touch the real
 * auth service or its users. A test token is "test:<auth user id>".
 */
import { vi } from "vitest";

const url = process.env.DATABASE_URL || "";
const m = url.match(/^postgres(?:ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost)(?::\d+)?\/([A-Za-z0-9_]+)(?:\?.*)?$/);
if (!m || !m[2].endsWith("_test")) {
  throw new Error(
    "Refusing to run tests: DATABASE_URL must point at a LOCAL database whose name ends in _test " +
      "(build one with ../../database/make_testdb.sh). Got: " + url.replace(/:\/\/.*@/, "://***@")
  );
}

vi.mock("../config/supabase.config", () => {
  const fakeAuth = {
    getUser: async (token: string) =>
      token && token.startsWith("test:")
        ? { data: { user: { id: token.slice(5) } }, error: null }
        : { data: { user: null }, error: { message: "invalid token" } },
    signInWithPassword: async ({ email, password }: { email: string; password: string }) => {
      const { query } = await import("../config/database.config");
      const r = await query<{ id: string }>("SELECT id FROM auth.users WHERE lower(email) = lower($1) LIMIT 1;", [email]);
      return r.rows[0] && password === "test-password-123"
        ? {
            data: {
              session: { access_token: `test:${r.rows[0].id}`, refresh_token: `rt:${r.rows[0].id}:0`, expires_at: 4102444800 },
              user: { id: r.rows[0].id },
            },
            error: null,
          }
        : { data: { session: null, user: null }, error: { message: "Invalid login credentials" } };
    },
    // Refresh token "rt:<auth user id>:<n>" rotates to "rt:<id>:<n+1>"; anything else is refused.
    refreshSession: async ({ refresh_token }: { refresh_token: string }) => {
      const m = /^rt:([0-9a-f-]{36}):(\d+)$/.exec(refresh_token ?? "");
      return m
        ? {
            data: {
              session: { access_token: `test:${m[1]}`, refresh_token: `rt:${m[1]}:${Number(m[2]) + 1}`, expires_at: 4102444800 },
              user: { id: m[1] },
            },
            error: null,
          }
        : { data: { session: null, user: null }, error: { message: "Invalid Refresh Token" } };
    },
    // Records password-reset emails instead of sending them.
    resetPasswordForEmail: async (email: string, opts?: { redirectTo?: string }) => {
      const g = globalThis as unknown as { __recoverCalls?: Array<{ email: string; redirectTo?: string }> };
      (g.__recoverCalls ??= []).push({ email, redirectTo: opts?.redirectTo });
      return { data: {}, error: null };
    },
    admin: {
      // Records revoked sessions so tests can assert that logout revokes the session.
      signOut: async (jwt: string, scope?: string) => {
        const g = globalThis as unknown as { __signOutCalls?: Array<{ jwt: string; scope?: string }> };
        (g.__signOutCalls ??= []).push({ jwt, scope });
        return { data: null, error: null };
      },
      createUser: async ({ email }: { email: string }) => {
        const { query } = await import("../config/database.config");
        const r = await query<{ id: string }>(
          `INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $1) RETURNING id;`,
          [email]
        );
        return { data: { user: { id: r.rows[0].id } }, error: null };
      },
      updateUserById: async (id: string, attrs: { email?: string }) => {
        const { query } = await import("../config/database.config");
        if (attrs.email) await query("UPDATE auth.users SET email = $1 WHERE id = $2;", [attrs.email, id]);
        return { data: {}, error: null };
      },
      deleteUser: async (id: string) => {
        const { query } = await import("../config/database.config");
        await query("DELETE FROM auth.users WHERE id = $1;", [id]);
        return { data: {}, error: null };
      },
    },
  };
  const client = { auth: fakeAuth };
  return { supabaseClient: client, supabaseAdmin: client, getScopedSupabaseClient: () => client };
});
