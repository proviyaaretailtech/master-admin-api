import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Env } from "./env.config";

/**
 * Standard Supabase client initialized with Anon Key.
 * Used for public operations such as user registration and sign-in.
 */
export const supabaseClient: SupabaseClient = createClient(
  Env.SUPABASE_URL,
  Env.SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

/**
 * Factory creating a user-scoped Supabase client that injects the user's
 * Bearer access token into outgoing requests.
 * This guarantees all queries execute within PostgreSQL Row Level Security (RLS) policies.
 */
export const getScopedSupabaseClient = (accessToken?: string): SupabaseClient => {
  return createClient(Env.SUPABASE_URL, Env.SUPABASE_ANON_KEY, {
    global: {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
};
