import { SupabaseClient } from "@supabase/supabase-js";

export interface UserModel {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone_number: string;
  role?: string;
  panel?: string;
  status?: string;
  password?: string;
  created_at: string;
  updated_at: string;
}

export interface OrganizationModel {
  id: string;
  business_name: string;
  domain: string;
  status: "Active" | "Inactive" | "Pending" | "Suspended" | string;
  email: string;
  phone_number: string;
  created_at: string;
  updated_at: string;
}

export interface LocationModel {
  id: string;
  org_id: string;
  name: string;
  area: string | null;
  code: string | null;
  type: string;
  status: "Active" | "Pending" | "Inactive" | "Draft" | string;
  time_zone: string;
  currency: string;
  last_sync: string;
  created_at: string;
  updated_at: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: UserModel;
      token?: string;
      supabase?: SupabaseClient;
    }
  }
}
