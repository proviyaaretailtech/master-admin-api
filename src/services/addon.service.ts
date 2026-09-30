import { query } from "../config/database.config";
import { NotFoundException, BadRequestException } from "../utils/app-error";
import { CreateAddonInput, UpdateAddonInput, GetAddonsQuery } from "../validators/addon.validator";

export interface AddonDto {
  id: string;
  addon_code: string;
  name: string;
  description: string;
  category: string;
  status: "Draft" | "Published" | "Retired";
  version: string;
  price: number;
  currency: string;
  cadence: string;
  unit_label: string;
  pricing_subtitle: string;
  effective_date: string | null;
  min_quantity: number;
  max_quantity: number;
  compatible_plans: string[];
  billing_sync_status: string;
  entitlement_validation_status: string;
  tax_compliance_status: string;
  active_units_count: number;
  assigned_count: number;
  created_by?: string | null;
  updated_by?: string | null;
  created_at: string;
  updated_at: string;
}

interface AddonDbRow {
  id: string;
  addon_code: string;
  name: string;
  description: string | null;
  category: string;
  status: string;
  version: string;
  price: string | number;
  currency: string;
  cadence: string;
  unit_label: string | null;
  pricing_subtitle: string | null;
  effective_date: string | null;
  min_quantity: number;
  max_quantity: number;
  compatible_plans: string[] | string;
  billing_sync_status: string | null;
  entitlement_validation_status: string | null;
  tax_compliance_status: string | null;
  active_units_count: string | number;
  assigned_count: string | number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

function mapRowToDto(row: AddonDbRow): AddonDto {
  let compatiblePlans: string[] = [];
  if (Array.isArray(row.compatible_plans)) {
    compatiblePlans = row.compatible_plans;
  } else if (typeof row.compatible_plans === "string") {
    try {
      compatiblePlans = JSON.parse(row.compatible_plans);
    } catch {
      compatiblePlans = [];
    }
  }

  return {
    id: row.id,
    addon_code: row.addon_code,
    name: row.name,
    description: row.description || "",
    category: row.category || "General",
    status: (row.status as "Draft" | "Published" | "Retired") || "Draft",
    version: row.version || "v1.0",
    price: Number(row.price) || 0,
    currency: row.currency || "INR",
    cadence: row.cadence || "Monthly",
    unit_label: row.unit_label || "location",
    pricing_subtitle: row.pricing_subtitle || "",
    effective_date: row.effective_date,
    min_quantity: Number(row.min_quantity) || 1,
    max_quantity: Number(row.max_quantity) || 10,
    compatible_plans: compatiblePlans,
    billing_sync_status: row.billing_sync_status || "Success",
    entitlement_validation_status: row.entitlement_validation_status || "Passed",
    tax_compliance_status: row.tax_compliance_status || "Pending verification",
    active_units_count: Number(row.active_units_count) || 0,
    assigned_count: Number(row.assigned_count) || 0,
    created_by: row.created_by,
    updated_by: row.updated_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class AddonService {
  /**
   * Retrieves all commercial add-ons with real-time assigned tenant counts and active units
   */
  async getAddons(queryInput: GetAddonsQuery): Promise<{ addons: AddonDto[]; total: number }> {
    const whereConditions: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    // Search query
    if (queryInput.search && queryInput.search.trim()) {
      const q = `%${queryInput.search.trim()}%`;
      whereConditions.push(
        `(a.name ILIKE $${paramIndex} OR a.addon_code ILIKE $${paramIndex} OR a.description ILIKE $${paramIndex} OR a.category ILIKE $${paramIndex})`
      );
      values.push(q);
      paramIndex++;
    }

    // Category filter
    if (
      queryInput.category &&
      queryInput.category.trim() &&
      queryInput.category !== "All Commercial Categories" &&
      queryInput.category !== "All"
    ) {
      whereConditions.push(`LOWER(a.category) = LOWER($${paramIndex})`);
      values.push(queryInput.category.trim());
      paramIndex++;
    }

    // Status filter
    if (
      queryInput.status &&
      queryInput.status.trim() &&
      queryInput.status !== "All Active" &&
      queryInput.status !== "All"
    ) {
      whereConditions.push(`LOWER(a.status) = LOWER($${paramIndex})`);
      values.push(queryInput.status.trim());
      paramIndex++;
    }

    // Compatibility filter
    if (
      queryInput.compatibility &&
      queryInput.compatibility.trim() &&
      queryInput.compatibility !== "All"
    ) {
      const comp = queryInput.compatibility.trim();
      whereConditions.push(`(a.compatible_plans::text ILIKE $${paramIndex})`);
      values.push(`%${comp}%`);
      paramIndex++;
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : "";

    const sql = `
      SELECT 
        a.*,
        COALESCE(sub.active_units, 0)::int AS active_units_count,
        COALESCE(sub.active_orgs, 0)::int AS assigned_count
      FROM commercial_addons a
      LEFT JOIN (
        SELECT 
          CASE 
            WHEN jsonb_typeof(elem) = 'object' THEN elem->>'addon_code'
            ELSE trim('"' FROM elem::text)
          END AS code,
          SUM(
            CASE 
              WHEN jsonb_typeof(elem) = 'object' AND (elem->>'quantity') IS NOT NULL 
              THEN (elem->>'quantity')::int 
              ELSE 1 
            END
          )::int AS active_units,
          COUNT(DISTINCT s.organization_id)::int AS active_orgs
        FROM subscriptions s,
             jsonb_array_elements(CASE WHEN jsonb_typeof(s.addons) = 'array' THEN s.addons ELSE '[]'::jsonb END) AS elem
        WHERE s.status = 'Active'
        GROUP BY 1
      ) sub ON LOWER(sub.code) = LOWER(a.addon_code)
      ${whereClause}
      ORDER BY a.created_at DESC;
    `;

    const result = await query<AddonDbRow>(sql, values);
    const addons = result.rows.map(mapRowToDto);

    return {
      addons,
      total: addons.length,
    };
  }

  /**
   * Retrieves all unique commercial categories present in the database
   */
  async getCategories(): Promise<string[]> {
    const sql = `
      SELECT DISTINCT category 
      FROM commercial_addons 
      WHERE category IS NOT NULL AND category != '' 
      ORDER BY category ASC;
    `;
    const result = await query<{ category: string }>(sql);
    return result.rows.map((r) => r.category);
  }

  /**
   * Retrieves a single add-on by ID
   */
  async getAddonById(id: string): Promise<AddonDto> {
    const sql = `
      SELECT 
        a.*,
        COALESCE(sub.active_units, 0)::int AS active_units_count,
        COALESCE(sub.active_orgs, 0)::int AS assigned_count
      FROM commercial_addons a
      LEFT JOIN (
        SELECT 
          CASE 
            WHEN jsonb_typeof(elem) = 'object' THEN elem->>'addon_code'
            ELSE trim('"' FROM elem::text)
          END AS code,
          SUM(
            CASE 
              WHEN jsonb_typeof(elem) = 'object' AND (elem->>'quantity') IS NOT NULL 
              THEN (elem->>'quantity')::int 
              ELSE 1 
            END
          )::int AS active_units,
          COUNT(DISTINCT s.organization_id)::int AS active_orgs
        FROM subscriptions s,
             jsonb_array_elements(CASE WHEN jsonb_typeof(s.addons) = 'array' THEN s.addons ELSE '[]'::jsonb END) AS elem
        WHERE s.status = 'Active'
        GROUP BY 1
      ) sub ON LOWER(sub.code) = LOWER(a.addon_code)
      WHERE a.id = $1
      LIMIT 1;
    `;

    const result = await query<AddonDbRow>(sql, [id]);
    if (result.rows.length === 0) {
      throw new NotFoundException(`Commercial add-on with ID '${id}' was not found`);
    }

    return mapRowToDto(result.rows[0]);
  }

  /**
   * Creates a new commercial add-on
   */
  async createAddon(data: CreateAddonInput, userId?: string): Promise<AddonDto> {
    const addonCodeNormalized = data.addon_code.trim();

    // Check unique addon_code
    const existing = await query<{ id: string }>(
      "SELECT id FROM commercial_addons WHERE LOWER(addon_code) = LOWER($1) LIMIT 1;",
      [addonCodeNormalized]
    );
    if (existing.rows.length > 0) {
      throw new BadRequestException(
        `A commercial add-on with code '${addonCodeNormalized}' already exists`
      );
    }

    const compatiblePlansJson = JSON.stringify(data.compatible_plans || []);

    const insertSql = `
      INSERT INTO commercial_addons (
        name, addon_code, description, category, status, version,
        price, currency, cadence, unit_label, pricing_subtitle,
        effective_date, min_quantity, max_quantity, compatible_plans,
        billing_sync_status, entitlement_validation_status, tax_compliance_status,
        created_by, updated_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16, $17, $18, $19, $19)
      RETURNING *, 0 AS active_units_count, 0 AS assigned_count;
    `;

    const result = await query<AddonDbRow>(insertSql, [
      data.name.trim(),
      addonCodeNormalized,
      data.description || "",
      data.category.trim(),
      data.status || "Draft",
      data.version || "v1.0",
      data.price,
      data.currency || "INR",
      data.cadence || "Monthly",
      data.unit_label || "location",
      data.pricing_subtitle || "",
      data.effective_date || null,
      data.min_quantity ?? 1,
      data.max_quantity ?? 10,
      compatiblePlansJson,
      data.billing_sync_status || "Success",
      data.entitlement_validation_status || "Passed",
      data.tax_compliance_status || "Pending verification",
      userId || null,
    ]);

    return mapRowToDto(result.rows[0]);
  }

  /**
   * Updates an existing add-on
   */
  async updateAddon(id: string, data: UpdateAddonInput, userId?: string): Promise<AddonDto> {
    const existingAddon = await this.getAddonById(id);

    if (
      data.addon_code &&
      data.addon_code.trim().toLowerCase() !== existingAddon.addon_code.toLowerCase()
    ) {
      const codeCheck = await query<{ id: string }>(
        "SELECT id FROM commercial_addons WHERE LOWER(addon_code) = LOWER($1) AND id != $2 LIMIT 1;",
        [data.addon_code.trim(), id]
      );
      if (codeCheck.rows.length > 0) {
        throw new BadRequestException(
          `A commercial add-on with code '${data.addon_code.trim()}' already exists`
        );
      }
    }

    const updateFields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (data.name !== undefined) {
      updateFields.push(`name = $${paramIndex++}`);
      values.push(data.name.trim());
    }
    if (data.addon_code !== undefined) {
      updateFields.push(`addon_code = $${paramIndex++}`);
      values.push(data.addon_code.trim());
    }
    if (data.description !== undefined) {
      updateFields.push(`description = $${paramIndex++}`);
      values.push(data.description);
    }
    if (data.category !== undefined) {
      updateFields.push(`category = $${paramIndex++}`);
      values.push(data.category.trim());
    }
    if (data.status !== undefined) {
      updateFields.push(`status = $${paramIndex++}`);
      values.push(data.status);
    }
    if (data.version !== undefined) {
      updateFields.push(`version = $${paramIndex++}`);
      values.push(data.version.trim());
    }
    if (data.price !== undefined) {
      updateFields.push(`price = $${paramIndex++}`);
      values.push(data.price);
    }
    if (data.currency !== undefined) {
      updateFields.push(`currency = $${paramIndex++}`);
      values.push(data.currency);
    }
    if (data.cadence !== undefined) {
      updateFields.push(`cadence = $${paramIndex++}`);
      values.push(data.cadence);
    }
    if (data.unit_label !== undefined) {
      updateFields.push(`unit_label = $${paramIndex++}`);
      values.push(data.unit_label);
    }
    if (data.pricing_subtitle !== undefined) {
      updateFields.push(`pricing_subtitle = $${paramIndex++}`);
      values.push(data.pricing_subtitle);
    }
    if (data.effective_date !== undefined) {
      updateFields.push(`effective_date = $${paramIndex++}`);
      values.push(data.effective_date || null);
    }
    if (data.min_quantity !== undefined) {
      updateFields.push(`min_quantity = $${paramIndex++}`);
      values.push(data.min_quantity);
    }
    if (data.max_quantity !== undefined) {
      updateFields.push(`max_quantity = $${paramIndex++}`);
      values.push(data.max_quantity);
    }
    if (data.compatible_plans !== undefined) {
      updateFields.push(`compatible_plans = $${paramIndex++}::jsonb`);
      values.push(JSON.stringify(data.compatible_plans));
    }
    if (data.billing_sync_status !== undefined) {
      updateFields.push(`billing_sync_status = $${paramIndex++}`);
      values.push(data.billing_sync_status);
    }
    if (data.entitlement_validation_status !== undefined) {
      updateFields.push(`entitlement_validation_status = $${paramIndex++}`);
      values.push(data.entitlement_validation_status);
    }
    if (data.tax_compliance_status !== undefined) {
      updateFields.push(`tax_compliance_status = $${paramIndex++}`);
      values.push(data.tax_compliance_status);
    }

    if (userId) {
      updateFields.push(`updated_by = $${paramIndex++}`);
      values.push(userId);
    }

    updateFields.push(`updated_at = now()`);
    values.push(id);

    const updateSql = `
      UPDATE commercial_addons
      SET ${updateFields.join(", ")}
      WHERE id = $${paramIndex}
      RETURNING *;
    `;

    await query(updateSql, values);
    return this.getAddonById(id);
  }

  /**
   * Publishes an add-on (transitions status to 'Published')
   */
  async publishAddon(id: string, userId?: string): Promise<AddonDto> {
    await this.getAddonById(id);
    const sql = `
      UPDATE commercial_addons 
      SET status = 'Published', updated_by = $2, updated_at = now() 
      WHERE id = $1
      RETURNING *;
    `;
    await query(sql, [id, userId || null]);
    return this.getAddonById(id);
  }

  /**
   * Retires an add-on (transitions status to 'Retired')
   */
  async retireAddon(id: string, userId?: string): Promise<AddonDto> {
    await this.getAddonById(id);
    const sql = `
      UPDATE commercial_addons 
      SET status = 'Retired', updated_by = $2, updated_at = now() 
      WHERE id = $1
      RETURNING *;
    `;
    await query(sql, [id, userId || null]);
    return this.getAddonById(id);
  }

  /**
   * Deletes an add-on if no active organizations are assigned
   */
  async deleteAddon(id: string): Promise<{ id: string; message: string }> {
    const addon = await this.getAddonById(id);

    if (addon.assigned_count > 0 || addon.active_units_count > 0) {
      throw new BadRequestException(
        `Cannot delete add-on '${addon.name}' because it has ${addon.assigned_count} active assigned organization(s). Retire it instead.`
      );
    }

    await query("DELETE FROM commercial_addons WHERE id = $1;", [id]);
    return { id, message: `Commercial add-on '${addon.name}' deleted successfully` };
  }
}

export const addonService = new AddonService();
