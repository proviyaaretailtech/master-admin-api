import { query } from "../config/database.config";
import { NotFoundException, BadRequestException } from "../utils/app-error";
import {
  CreateOrganizationInput,
  UpdateOrganizationInput,
  GetOrganizationsQueryInput,
} from "../validators/organization.validator";
import { OrganizationModel } from "../@types/express";

export interface PaginatedOrganizationsResult {
  organizations: OrganizationModel[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

/**
 * Organizations live in the shared (canonical) `organizations` table. This service keeps the
 * control-plane API shape (business_name, domain, status, email, phone_number) and maps it:
 *   business_name <- name, domain <- business_domain, status <- control_status,
 *   email <- contact_email, phone_number <- contact_phone.
 * Creation goes through the database function master_create_organization (default location,
 * billing/dispatch settings, optional trial subscription, owner invitation) so every app sees
 * the same, complete organization.
 */
const SELECT_COLUMNS = `id, name AS business_name, business_domain AS domain, control_status AS status,
  contact_email AS email, contact_phone AS phone_number, created_at, updated_at`;

// Whitelist of valid database columns for ORDER BY (Prevents SQL Injection)
const ALLOWED_SORT_COLUMNS: Record<string, string> = {
  business_name: "name",
  domain: "business_domain",
  status: "control_status",
  email: "contact_email",
  phone_number: "contact_phone",
  created_at: "created_at",
  updated_at: "updated_at",
};

function friendlyUniqueError(err: any, email?: string, phone?: string): never {
  if (err?.code === "23505") {
    if (err.constraint?.includes("email")) {
      throw new BadRequestException(`An organization with email '${email ?? ""}' already exists`);
    }
    if (err.constraint?.includes("phone")) {
      throw new BadRequestException(
        `An organization with phone number '${phone ?? ""}' already exists`
      );
    }
  }
  throw err;
}

export class OrganizationService {
  /**
   * Creates a new organization (and its default location, settings and optional trial subscription).
   */
  async createOrganization(
    data: CreateOrganizationInput & { plan_code?: string; owner_email?: string }
  ): Promise<OrganizationModel> {
    const emailNormalized = data.email.trim().toLowerCase();
    const phoneNormalized = data.phone_number.trim();

    const emailCheck = await query<{ id: string }>(
      "SELECT id FROM organizations WHERE lower(contact_email) = lower($1) LIMIT 1;",
      [emailNormalized]
    );
    if (emailCheck.rows.length > 0) {
      throw new BadRequestException(`An organization with email '${emailNormalized}' already exists`);
    }
    const phoneCheck = await query<{ id: string }>(
      "SELECT id FROM organizations WHERE contact_phone = $1 LIMIT 1;",
      [phoneNormalized]
    );
    if (phoneCheck.rows.length > 0) {
      throw new BadRequestException(
        `An organization with phone number '${phoneNormalized}' already exists`
      );
    }

    try {
      const created = await query<{ result: { organization_id: string } }>(
        "SELECT public.master_create_organization($1::jsonb) AS result;",
        [
          JSON.stringify({
            name: data.business_name.trim(),
            business_domain: data.domain.trim(),
            control_status: data.status || "Draft",
            contact_email: emailNormalized,
            contact_phone: phoneNormalized,
            plan_code: data.plan_code,
            owner_email: data.owner_email,
          }),
        ]
      );
      return this.getOrganizationById(created.rows[0].result.organization_id);
    } catch (err: any) {
      if (typeof err?.message === "string" && err.message.startsWith("MASTER_BAD_PLAN")) {
        throw new BadRequestException(err.message.replace("MASTER_BAD_PLAN: ", ""));
      }
      return friendlyUniqueError(err, emailNormalized, phoneNormalized);
    }
  }

  /**
   * Retrieves paginated organizations with parameterized multi-field search and filters
   */
  async getOrganizations(
    params: Partial<GetOrganizationsQueryInput> = {}
  ): Promise<PaginatedOrganizationsResult> {
    const page = Math.max(1, params.page || 1);
    const limit = Math.max(1, Math.min(100, params.limit || 10));
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const values: any[] = [];

    if (params.search && params.search.trim().length > 0) {
      values.push(`%${params.search.trim()}%`);
      const idx = values.length;
      conditions.push(
        `(name ILIKE $${idx} OR business_domain ILIKE $${idx} OR contact_email ILIKE $${idx} OR contact_phone ILIKE $${idx})`
      );
    }

    if (params.status && params.status !== "All Statuses" && params.status !== "All") {
      const statusTrimmed = params.status.trim();
      if (statusTrimmed.toLowerCase() === "approved") {
        conditions.push(`control_status IN ('Approved', 'Active')`);
      } else if (statusTrimmed.toLowerCase() === "rejected") {
        conditions.push(`control_status IN ('Rejected', 'Suspended', 'Inactive')`);
      } else {
        values.push(statusTrimmed);
        conditions.push(`control_status ILIKE $${values.length}`);
      }
    }

    if (
      params.domain &&
      params.domain !== "All Types" &&
      params.domain !== "All Domains" &&
      params.domain !== "All"
    ) {
      values.push(params.domain.trim());
      conditions.push(`business_domain ILIKE $${values.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await query<{ total: number }>(
      `SELECT COUNT(*)::int as total FROM organizations ${whereClause};`,
      values
    );
    const total = countResult.rows[0]?.total || 0;

    const rawSortBy = (params.sortBy || "created_at").toLowerCase();
    const sortColumn = ALLOWED_SORT_COLUMNS[rawSortBy] || "created_at";
    const sortDirection = (params.sortOrder || "DESC").toUpperCase() === "ASC" ? "ASC" : "DESC";

    values.push(limit);
    const limitIdx = values.length;
    values.push(offset);
    const offsetIdx = values.length;

    const result = await query<OrganizationModel>(
      `SELECT ${SELECT_COLUMNS}
       FROM organizations
       ${whereClause}
       ORDER BY ${sortColumn} ${sortDirection}
       LIMIT $${limitIdx} OFFSET $${offsetIdx};`,
      values
    );
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return { organizations: result.rows, pagination: { total, page, limit, totalPages } };
  }

  /**
   * Retrieves single organization by UUID
   */
  async getOrganizationById(id: string): Promise<OrganizationModel> {
    const result = await query<OrganizationModel>(
      `SELECT ${SELECT_COLUMNS} FROM organizations WHERE id = $1 LIMIT 1;`,
      [id]
    );
    if (result.rows.length === 0) {
      throw new NotFoundException(`Organization with ID '${id}' not found`);
    }
    return result.rows[0];
  }

  /**
   * Updates existing organization by UUID with conflict checks and partial updates
   */
  async updateOrganization(id: string, data: UpdateOrganizationInput): Promise<OrganizationModel> {
    await this.getOrganizationById(id);

    if (data.email) {
      const emailNormalized = data.email.trim().toLowerCase();
      const checkEmail = await query<{ id: string }>(
        "SELECT id FROM organizations WHERE lower(contact_email) = lower($1) AND id != $2 LIMIT 1;",
        [emailNormalized, id]
      );
      if (checkEmail.rows.length > 0) {
        throw new BadRequestException(
          `Email '${emailNormalized}' is already in use by another organization`
        );
      }
    }
    if (data.phone_number) {
      const phoneNormalized = data.phone_number.trim();
      const checkPhone = await query<{ id: string }>(
        "SELECT id FROM organizations WHERE contact_phone = $1 AND id != $2 LIMIT 1;",
        [phoneNormalized, id]
      );
      if (checkPhone.rows.length > 0) {
        throw new BadRequestException(
          `Phone number '${phoneNormalized}' is already in use by another organization`
        );
      }
    }

    const setClauses: string[] = [];
    const values: any[] = [];
    const set = (column: string, value: unknown) => {
      values.push(value);
      setClauses.push(`${column} = $${values.length}`);
    };
    if (data.business_name !== undefined) set("name", data.business_name.trim());
    if (data.domain !== undefined) set("business_domain", data.domain.trim());
    if (data.status !== undefined) set("control_status", data.status);
    if (data.email !== undefined) set("contact_email", data.email.trim().toLowerCase());
    if (data.phone_number !== undefined) set("contact_phone", data.phone_number.trim());
    if (setClauses.length === 0) return this.getOrganizationById(id);
    setClauses.push("updated_at = now()");

    values.push(id);
    try {
      const result = await query<OrganizationModel>(
        `UPDATE organizations SET ${setClauses.join(", ")} WHERE id = $${values.length}
         RETURNING ${SELECT_COLUMNS};`,
        values
      );
      if (result.rows.length === 0) {
        throw new NotFoundException(`Organization with ID '${id}' not found`);
      }
      return result.rows[0];
    } catch (err: any) {
      return friendlyUniqueError(err, data.email, data.phone_number);
    }
  }

  /**
   * Deletes an organization by UUID. An organization that has traded (orders or payments) is part
   * of the financial record and is never hard-deleted: deactivate it instead.
   */
  async deleteOrganization(
    id: string
  ): Promise<{ success: boolean; message: string; deletedId: string }> {
    await this.getOrganizationById(id);

    const traded = await query<{ has_orders: boolean }>(
      `SELECT (EXISTS (SELECT 1 FROM orders WHERE organization_id = $1)
            OR EXISTS (SELECT 1 FROM payments WHERE organization_id = $1)) AS has_orders;`,
      [id]
    );
    if (traded.rows[0]?.has_orders) {
      throw new BadRequestException(
        "This organization has orders or payments and cannot be deleted. Set its status to Inactive instead."
      );
    }

    await query("DELETE FROM organizations WHERE id = $1;", [id]);
    return { success: true, message: "Organization deleted successfully", deletedId: id };
  }
}

export const organizationService = new OrganizationService();
