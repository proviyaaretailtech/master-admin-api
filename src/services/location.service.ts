import { query } from "../config/database.config";
import { NotFoundException } from "../utils/app-error";
import {
  CreateLocationInput,
  UpdateLocationInput,
  GetLocationsQueryInput,
} from "../validators/location.validator";
import { LocationModel, OrganizationModel } from "../@types/express";

export interface PaginatedLocationsResult {
  locations: LocationModel[];
  organization: {
    id: string;
    business_name: string;
    domain: string;
  };
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

const ALLOWED_SORT_COLUMNS: Record<string, string> = {
  name: "name",
  code: "code",
  area: "area",
  type: "type",
  status: "status",
  created_at: "created_at",
  updated_at: "updated_at",
};

export class LocationService {
  /**
   * Helper to ensure the target organization exists in the database
   */
  async ensureOrganizationExists(orgId: string): Promise<OrganizationModel> {
    const orgCheck = await query<OrganizationModel>(
      `SELECT id, business_name, domain, status, email, phone_number, created_at, updated_at
       FROM organizations
       WHERE id = $1
       LIMIT 1;`,
      [orgId]
    );

    if (orgCheck.rows.length === 0) {
      throw new NotFoundException(`Organization with ID '${orgId}' does not exist`);
    }

    return orgCheck.rows[0];
  }

  /**
   * Creates a new location under the given organization
   */
  async createLocation(orgId: string, data: CreateLocationInput): Promise<LocationModel> {
    await this.ensureOrganizationExists(orgId);

    const insertSql = `
      INSERT INTO locations (org_id, name, area, code, type, status, time_zone, currency)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, org_id, name, area, code, type, status, time_zone, currency, last_sync, created_at, updated_at;
    `;

    const result = await query<LocationModel>(insertSql, [
      orgId,
      data.name.trim(),
      data.area ? data.area.trim() : null,
      data.code ? data.code.trim().toUpperCase() : null,
      data.type,
      data.status,
      data.time_zone,
      data.currency,
    ]);

    return result.rows[0];
  }

  /**
   * Retrieves paginated locations for an organization with search and filter capabilities
   */
  async getLocations(
    orgId: string,
    params: GetLocationsQueryInput
  ): Promise<PaginatedLocationsResult> {
    const org = await this.ensureOrganizationExists(orgId);

    const conditions: string[] = ["org_id = $1"];
    const values: unknown[] = [orgId];
    let paramIndex = 2;

    // Optional Search Filter (Name, Area, Code, Type)
    if (params.search) {
      conditions.push(
        `(LOWER(name) LIKE $${paramIndex} OR LOWER(COALESCE(area, '')) LIKE $${paramIndex} OR LOWER(COALESCE(code, '')) LIKE $${paramIndex} OR LOWER(type) LIKE $${paramIndex})`
      );
      values.push(`%${params.search.toLowerCase()}%`);
      paramIndex++;
    }

    // Optional Status Filter
    if (params.status) {
      conditions.push(`status = $${paramIndex}`);
      values.push(params.status);
      paramIndex++;
    }

    // Optional Type Filter
    if (params.type) {
      conditions.push(`type = $${paramIndex}`);
      values.push(params.type);
      paramIndex++;
    }

    const whereClause = conditions.join(" AND ");

    // 1. Get Total Count
    const countSql = `SELECT COUNT(*) AS total FROM locations WHERE ${whereClause};`;
    const countResult = await query<{ total: string }>(countSql, values);
    const total = parseInt(countResult.rows[0]?.total || "0", 10);

    // 2. Sorting & Pagination
    const page = params.page || 1;
    const limit = params.limit || 10;
    const offset = (page - 1) * limit;
    const totalPages = Math.ceil(total / limit) || 1;

    const sortColumn = ALLOWED_SORT_COLUMNS[params.sortBy] || "created_at";
    const sortOrder = params.sortOrder === "asc" ? "ASC" : "DESC";

    const fetchSql = `
      SELECT id, org_id, name, area, code, type, status, time_zone, currency, last_sync, created_at, updated_at
      FROM locations
      WHERE ${whereClause}
      ORDER BY ${sortColumn} ${sortOrder}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1};
    `;
    values.push(limit, offset);

    const result = await query<LocationModel>(fetchSql, values);

    return {
      locations: result.rows,
      organization: {
        id: org.id,
        business_name: org.business_name,
        domain: org.domain,
      },
      pagination: {
        total,
        page,
        limit,
        totalPages,
      },
    };
  }

  /**
   * Retrieves a single location by ID for a specific organization
   */
  async getLocationById(orgId: string, locationId: string): Promise<LocationModel> {
    await this.ensureOrganizationExists(orgId);

    const result = await query<LocationModel>(
      `SELECT id, org_id, name, area, code, type, status, time_zone, currency, last_sync, created_at, updated_at
       FROM locations
       WHERE id = $1 AND org_id = $2
       LIMIT 1;`,
      [locationId, orgId]
    );

    if (result.rows.length === 0) {
      throw new NotFoundException(
        `Location with ID '${locationId}' not found for organization '${orgId}'`
      );
    }

    return result.rows[0];
  }

  /**
   * Updates an existing location under an organization
   */
  async updateLocation(
    orgId: string,
    locationId: string,
    data: UpdateLocationInput
  ): Promise<LocationModel> {
    // Verify location exists
    await this.getLocationById(orgId, locationId);

    const updateFields: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (data.name !== undefined) {
      updateFields.push(`name = $${paramIndex++}`);
      values.push(data.name.trim());
    }
    if (data.area !== undefined) {
      updateFields.push(`area = $${paramIndex++}`);
      values.push(data.area ? data.area.trim() : null);
    }
    if (data.code !== undefined) {
      updateFields.push(`code = $${paramIndex++}`);
      values.push(data.code ? data.code.trim().toUpperCase() : null);
    }
    if (data.type !== undefined) {
      updateFields.push(`type = $${paramIndex++}`);
      values.push(data.type);
    }
    if (data.status !== undefined) {
      updateFields.push(`status = $${paramIndex++}`);
      values.push(data.status);
    }
    if (data.time_zone !== undefined) {
      updateFields.push(`time_zone = $${paramIndex++}`);
      values.push(data.time_zone);
    }
    if (data.currency !== undefined) {
      updateFields.push(`currency = $${paramIndex++}`);
      values.push(data.currency);
    }

    // Always update updated_at
    updateFields.push("updated_at = now()");

    values.push(locationId, orgId);
    const updateSql = `
      UPDATE locations
      SET ${updateFields.join(", ")}
      WHERE id = $${paramIndex++} AND org_id = $${paramIndex++}
      RETURNING id, org_id, name, area, code, type, status, time_zone, currency, last_sync, created_at, updated_at;
    `;

    const result = await query<LocationModel>(updateSql, values);
    return result.rows[0];
  }

  /**
   * Deletes a location by ID for a specific organization
   */
  async deleteLocation(orgId: string, locationId: string): Promise<void> {
    // Verify location exists first
    await this.getLocationById(orgId, locationId);

    await query("DELETE FROM locations WHERE id = $1 AND org_id = $2;", [locationId, orgId]);
  }
}

export const locationService = new LocationService();
