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

// Whitelist of valid database columns for ORDER BY (Prevents SQL Injection)
const ALLOWED_SORT_COLUMNS: Record<string, string> = {
  business_name: "business_name",
  domain: "domain",
  status: "status",
  email: "email",
  phone_number: "phone_number",
  created_at: "created_at",
  updated_at: "updated_at",
};

export class OrganizationService {
  /**
   * Creates a new organization with strict unique email and phone validations
   */
  async createOrganization(data: CreateOrganizationInput): Promise<OrganizationModel> {
    const emailNormalized = data.email.trim().toLowerCase();
    const phoneNormalized = data.phone_number.trim();

    // 1. Pre-check: Unique Email
    const emailCheck = await query<{ id: string }>(
      "SELECT id FROM organizations WHERE LOWER(email) = LOWER($1) LIMIT 1;",
      [emailNormalized]
    );
    if (emailCheck.rows.length > 0) {
      throw new BadRequestException(
        `An organization with email '${emailNormalized}' already exists`
      );
    }

    // 2. Pre-check: Unique Phone Number
    const phoneCheck = await query<{ id: string }>(
      "SELECT id FROM organizations WHERE phone_number = $1 LIMIT 1;",
      [phoneNormalized]
    );
    if (phoneCheck.rows.length > 0) {
      throw new BadRequestException(
        `An organization with phone number '${phoneNormalized}' already exists`
      );
    }

    // 3. Insert new organization with parameterized query
    try {
      const insertSql = `
        INSERT INTO organizations (business_name, domain, status, email, phone_number)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, business_name, domain, status, email, phone_number, created_at, updated_at;
      `;

      const result = await query<OrganizationModel>(insertSql, [
        data.business_name.trim(),
        data.domain.trim(),
        data.status || "Draft",
        emailNormalized,
        phoneNormalized,
      ]);

      return result.rows[0];
    } catch (err: any) {
      // Catch concurrent unique constraint violations (PostgreSQL error 23505)
      if (err.code === "23505") {
        if (err.detail?.includes("email") || err.constraint?.includes("email")) {
          throw new BadRequestException(
            `An organization with email '${emailNormalized}' already exists`
          );
        }
        if (err.detail?.includes("phone") || err.constraint?.includes("phone")) {
          throw new BadRequestException(
            `An organization with phone number '${phoneNormalized}' already exists`
          );
        }
      }
      throw err;
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

    // Search filter across business_name, domain, email, and phone_number
    if (params.search && params.search.trim().length > 0) {
      values.push(`%${params.search.trim()}%`);
      const idx = values.length;
      conditions.push(
        `(business_name ILIKE $${idx} OR domain ILIKE $${idx} OR email ILIKE $${idx} OR phone_number ILIKE $${idx})`
      );
    }

    // Status filter
    if (params.status && params.status !== "All Statuses" && params.status !== "All") {
      const statusTrimmed = params.status.trim();
      if (statusTrimmed.toLowerCase() === "approved") {
        conditions.push(`(status ILIKE 'Approved' OR status ILIKE 'Active')`);
      } else if (statusTrimmed.toLowerCase() === "rejected") {
        conditions.push(
          `(status ILIKE 'Rejected' OR status ILIKE 'Suspended' OR status ILIKE 'Inactive')`
        );
      } else {
        values.push(statusTrimmed);
        const idx = values.length;
        conditions.push(`status ILIKE $${idx}`);
      }
    }

    // Domain filter
    if (
      params.domain &&
      params.domain !== "All Types" &&
      params.domain !== "All Domains" &&
      params.domain !== "All"
    ) {
      values.push(params.domain.trim());
      const idx = values.length;
      conditions.push(`domain ILIKE $${idx}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Total count query
    const countSql = `SELECT COUNT(*)::int as total FROM organizations ${whereClause};`;
    const countResult = await query<{ total: number }>(countSql, values);
    const total = countResult.rows[0]?.total || 0;

    // Sort column and direction sanitization (strictly whitelist verified)
    const rawSortBy = (params.sortBy || "created_at").toLowerCase();
    const sortColumn = ALLOWED_SORT_COLUMNS[rawSortBy] || "created_at";
    const sortDirection = (params.sortOrder || "DESC").toUpperCase() === "ASC" ? "ASC" : "DESC";

    // Paginated data query
    values.push(limit);
    const limitIdx = values.length;
    values.push(offset);
    const offsetIdx = values.length;

    const dataSql = `
      SELECT id, business_name, domain, status, email, phone_number, created_at, updated_at
      FROM organizations
      ${whereClause}
      ORDER BY ${sortColumn} ${sortDirection}
      LIMIT $${limitIdx} OFFSET $${offsetIdx};
    `;

    const result = await query<OrganizationModel>(dataSql, values);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      organizations: result.rows,
      pagination: {
        total,
        page,
        limit,
        totalPages,
      },
    };
  }

  /**
   * Retrieves single organization by UUID
   */
  async getOrganizationById(id: string): Promise<OrganizationModel> {
    const result = await query<OrganizationModel>(
      `SELECT id, business_name, domain, status, email, phone_number, created_at, updated_at
       FROM organizations
       WHERE id = $1
       LIMIT 1;`,
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
    // 1. Verify existence
    await this.getOrganizationById(id);

    // 2. If email is being modified, ensure no collision with another organization
    if (data.email) {
      const emailNormalized = data.email.trim().toLowerCase();
      const checkEmail = await query<{ id: string }>(
        "SELECT id FROM organizations WHERE LOWER(email) = LOWER($1) AND id != $2 LIMIT 1;",
        [emailNormalized, id]
      );
      if (checkEmail.rows.length > 0) {
        throw new BadRequestException(
          `Email '${emailNormalized}' is already in use by another organization`
        );
      }
    }

    // 3. If phone_number is being modified, ensure no collision with another organization
    if (data.phone_number) {
      const phoneNormalized = data.phone_number.trim();
      const checkPhone = await query<{ id: string }>(
        "SELECT id FROM organizations WHERE phone_number = $1 AND id != $2 LIMIT 1;",
        [phoneNormalized, id]
      );
      if (checkPhone.rows.length > 0) {
        throw new BadRequestException(
          `Phone number '${phoneNormalized}' is already in use by another organization`
        );
      }
    }

    // 4. Dynamically build parameterized UPDATE
    const setClauses: string[] = [];
    const values: any[] = [];

    if (data.business_name !== undefined) {
      values.push(data.business_name.trim());
      setClauses.push(`business_name = $${values.length}`);
    }

    if (data.domain !== undefined) {
      values.push(data.domain.trim());
      setClauses.push(`domain = $${values.length}`);
    }

    if (data.status !== undefined) {
      values.push(data.status);
      setClauses.push(`status = $${values.length}`);
    }

    if (data.email !== undefined) {
      values.push(data.email.trim().toLowerCase());
      setClauses.push(`email = $${values.length}`);
    }

    if (data.phone_number !== undefined) {
      values.push(data.phone_number.trim());
      setClauses.push(`phone_number = $${values.length}`);
    }

    setClauses.push("updated_at = now()");

    values.push(id);
    const idIdx = values.length;

    try {
      const updateSql = `
        UPDATE organizations
        SET ${setClauses.join(", ")}
        WHERE id = $${idIdx}
        RETURNING id, business_name, domain, status, email, phone_number, created_at, updated_at;
      `;

      const result = await query<OrganizationModel>(updateSql, values);

      if (result.rows.length === 0) {
        throw new NotFoundException(`Organization with ID '${id}' not found`);
      }

      return result.rows[0];
    } catch (err: any) {
      if (err.code === "23505") {
        if (err.detail?.includes("email") || err.constraint?.includes("email")) {
          throw new BadRequestException("An organization with this email already exists");
        }
        if (err.detail?.includes("phone") || err.constraint?.includes("phone")) {
          throw new BadRequestException("An organization with this phone number already exists");
        }
      }
      throw err;
    }
  }

  /**
   * Deletes an organization by UUID
   */
  async deleteOrganization(
    id: string
  ): Promise<{ success: boolean; message: string; deletedId: string }> {
    // 1. Verify existence
    await this.getOrganizationById(id);

    // 2. Perform parameterized delete
    await query("DELETE FROM organizations WHERE id = $1;", [id]);

    return {
      success: true,
      message: "Organization deleted successfully",
      deletedId: id,
    };
  }
}

export const organizationService = new OrganizationService();
