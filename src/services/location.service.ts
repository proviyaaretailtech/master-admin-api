import { query } from "../config/database.config";
import { NotFoundException, BadRequestException } from "../utils/app-error";
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

/**
 * Locations live in the shared `locations` table (canonical). The control-plane API keeps its shape:
 *   type <- kind (Restaurant, Cloud Kitchen, Delivery Hub, Warehouse, Retail Outlet, Other),
 *   status <- initcap(status), time_zone <- timezone, currency <- "INR (₹)" style label of currency_code,
 *   org_id <- organization_id, last_sync <- last_sync_at.
 */
const TYPE_TO_KIND: Record<string, string> = {
  Restaurant: "restaurant",
  "Cloud Kitchen": "cloud_kitchen",
  "Delivery Hub": "hub",
  Warehouse: "warehouse",
  "Retail Outlet": "store",
  Other: "other",
};
const CURRENCY_SYMBOLS: Record<string, string> = { INR: "₹", USD: "$", EUR: "€", GBP: "£", AED: "AED" };
const toCurrencyCode = (label: string | undefined): string => (label || "INR").trim().slice(0, 3).toUpperCase();

const LOCATION_COLUMNS = `id, organization_id AS org_id, name, area, code,
  CASE kind WHEN 'restaurant' THEN 'Restaurant' WHEN 'cloud_kitchen' THEN 'Cloud Kitchen'
            WHEN 'hub' THEN 'Delivery Hub' WHEN 'warehouse' THEN 'Warehouse'
            WHEN 'store' THEN 'Retail Outlet' ELSE 'Other' END AS type,
  initcap(status) AS status, timezone AS time_zone, currency_code, last_sync_at AS last_sync, created_at, updated_at`;

function withCurrencyLabel(row: any): LocationModel {
  const { currency_code, ...rest } = row;
  const code = currency_code || "INR";
  return { ...rest, currency: CURRENCY_SYMBOLS[code] && code === "INR" ? `INR (${CURRENCY_SYMBOLS[code]})` : code };
}

const ALLOWED_SORT_COLUMNS: Record<string, string> = {
  name: "name",
  code: "code",
  area: "area",
  type: "kind",
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
      `SELECT id, name AS business_name, business_domain AS domain, control_status AS status,
              contact_email AS email, contact_phone AS phone_number, created_at, updated_at
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
   * Creates a new location under the given organization in org_locations table
   */
  async createLocation(orgId: string, data: CreateLocationInput): Promise<LocationModel> {
    await this.ensureOrganizationExists(orgId);

    const insertSql = `
      INSERT INTO locations (organization_id, name, area, code, kind, status, timezone, currency_code)
      VALUES ($1, $2, $3, COALESCE($4, 'L' || upper(substr(md5(random()::text), 1, 6))), $5, $6, $7, $8)
      RETURNING ${LOCATION_COLUMNS};
    `;

    try {
      const result = await query<LocationModel>(insertSql, [
        orgId,
        data.name.trim(),
        data.area ? data.area.trim() : null,
        data.code ? data.code.trim().toUpperCase() : null,
        TYPE_TO_KIND[data.type] || "other",
        String(data.status).toLowerCase(),
        data.time_zone,
        toCurrencyCode(data.currency),
      ]);
      return withCurrencyLabel(result.rows[0]);
    } catch (err: any) {
      if (typeof err?.message === "string" && err.message.startsWith("PLAN_LIMIT")) {
        throw new BadRequestException(err.message.replace("PLAN_LIMIT: ", ""));
      }
      if (err?.code === "23505") {
        throw new BadRequestException(`A location with code '${data.code}' already exists in this organization`);
      }
      throw err;
    }
  }

  /**
   * Retrieves paginated locations for an organization from org_locations with search and filter capabilities
   */
  async getLocations(
    orgId: string,
    params: GetLocationsQueryInput
  ): Promise<PaginatedLocationsResult> {
    const org = await this.ensureOrganizationExists(orgId);

    const conditions: string[] = ["organization_id = $1"];
    const values: unknown[] = [orgId];
    let paramIndex = 2;

    // Optional Search Filter (Name, Area, Code, Type)
    if (params.search) {
      conditions.push(
        `(LOWER(name) LIKE $${paramIndex} OR LOWER(COALESCE(area, '')) LIKE $${paramIndex} OR LOWER(COALESCE(code, '')) LIKE $${paramIndex} OR LOWER(kind) LIKE $${paramIndex})`
      );
      values.push(`%${params.search.toLowerCase()}%`);
      paramIndex++;
    }

    // Optional Status Filter
    if (params.status) {
      conditions.push(`status = $${paramIndex}`);
      values.push(String(params.status).toLowerCase());
      paramIndex++;
    }

    // Optional Type Filter
    if (params.type) {
      conditions.push(`kind = $${paramIndex}`);
      values.push(TYPE_TO_KIND[params.type as string] || "other");
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
      SELECT ${LOCATION_COLUMNS}
      FROM locations
      WHERE ${whereClause}
      ORDER BY ${sortColumn} ${sortOrder}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1};
    `;
    values.push(limit, offset);

    const result = await query<LocationModel>(fetchSql, values);

    return {
      locations: result.rows.map((r) => withCurrencyLabel(r)),
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
   * Retrieves a single location by ID from org_locations for a specific organization
   */
  async getLocationById(orgId: string, locationId: string): Promise<LocationModel> {
    await this.ensureOrganizationExists(orgId);

    const result = await query<LocationModel>(
      `SELECT ${LOCATION_COLUMNS}
       FROM locations
       WHERE id = $1 AND organization_id = $2
       LIMIT 1;`,
      [locationId, orgId]
    );

    if (result.rows.length === 0) {
      throw new NotFoundException(
        `Location with ID '${locationId}' not found for organization '${orgId}'`
      );
    }

    return withCurrencyLabel(result.rows[0]);
  }

  /**
   * Updates an existing location in org_locations under an organization
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
      updateFields.push(`kind = $${paramIndex++}`);
      values.push(TYPE_TO_KIND[data.type as string] || "other");
    }
    if (data.status !== undefined) {
      updateFields.push(`status = $${paramIndex++}`);
      values.push(String(data.status).toLowerCase());
    }
    if (data.time_zone !== undefined) {
      updateFields.push(`timezone = $${paramIndex++}`);
      values.push(data.time_zone);
    }
    if (data.currency !== undefined) {
      updateFields.push(`currency_code = $${paramIndex++}`);
      values.push(toCurrencyCode(data.currency));
    }

    // Always update updated_at
    updateFields.push("updated_at = now()");

    values.push(locationId, orgId);
    const updateSql = `
      UPDATE locations
      SET ${updateFields.join(", ")}
      WHERE id = $${paramIndex++} AND organization_id = $${paramIndex++}
      RETURNING ${LOCATION_COLUMNS};
    `;

    try {
      const result = await query<LocationModel>(updateSql, values);
      return withCurrencyLabel(result.rows[0]);
    } catch (err: any) {
      if (err?.code === "23505") {
        throw new BadRequestException("A location with this code already exists in this organization");
      }
      throw err;
    }
  }

  /**
   * Deletes a location by ID from org_locations for a specific organization
   */
  async deleteLocation(orgId: string, locationId: string): Promise<void> {
    // Verify location exists first
    await this.getLocationById(orgId, locationId);

    const used = await query<{ n: number }>("SELECT count(*)::int AS n FROM orders WHERE location_id = $1;", [locationId]);
    if ((used.rows[0]?.n || 0) > 0) {
      throw new BadRequestException("This location has orders and cannot be deleted. Set its status to Inactive instead.");
    }
    await query("DELETE FROM locations WHERE id = $1 AND organization_id = $2;", [locationId, orgId]);
  }
}

export const locationService = new LocationService();
