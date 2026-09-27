import { SupabaseClient } from "@supabase/supabase-js";
import { FeaturePermission } from "../utils/permission-adapter";

export interface UserModel {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone_number: string;
  status?: string;
  role_id?: string | null;
  role_name?: string;
  role_key?: string;
  role_scope?: string;
  role_details?: {
    id: string;
    name: string;
    key: string;
    scope: string;
    description: string;
    is_active: boolean;
    is_system: boolean;
  } | null;
  permissions?: FeaturePermission[];
  isSuperAdmin?: boolean;
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
      permissions?: FeaturePermission[];
      userRole?: any;
      isSuperAdmin?: boolean;
    }
  }
}

