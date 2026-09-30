import { query } from "../config/database.config";
import { NotFoundException, BadRequestException } from "../utils/app-error";
import { CreatePackInput, UpdatePackInput, GetPacksQuery } from "../validators/pack.validator";

export interface PackDto {
  id: string;
  pack_code: string;
  name: string;
  description: string;
  status: "Draft" | "Published" | "Retired";
  price: number;
  currency: string;
  cadence: string;
  effective_date: string | null;
  extended_limits: string;
  prerequisite_note: string;
  included_feature_title: string;
  included_feature_subtitle: string;
  compatible_plans: string[];
  required_modules: string[];
  assigned_count: number;
  created_by?: string | null;
  updated_by?: string | null;
  created_at: string;
  updated_at: string;
}

interface PackDbRow {
  id: string;
  pack_code: string;
  name: string;
  description: string | null;
  status: string;
  price: string | number;
  currency: string;
  cadence: string;
  effective_date: string | null;
  extended_limits: string | null;
  prerequisite_note: string | null;
  included_feature_title: string | null;
  included_feature_subtitle: string | null;
  compatible_plans: string[] | string;
  required_modules: string[] | string;
  assigned_count: string | number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

function mapRowToDto(row: PackDbRow): PackDto {
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

  let requiredModules: string[] = [];
  if (Array.isArray(row.required_modules)) {
    requiredModules = row.required_modules;
  } else if (typeof row.required_modules === "string") {
    try {
      requiredModules = JSON.parse(row.required_modules);
    } catch {
      requiredModules = [];
    }
  }

  return {
    id: row.id,
    pack_code: row.pack_code,
    name: row.name,
    description: row.description || "",
    status: row.status as "Draft" | "Published" | "Retired",
    price: Number(row.price) || 0,
    currency: row.currency || "INR",
    cadence: row.cadence || "Monthly",
    effective_date: row.effective_date,
    extended_limits: row.extended_limits || "",
    prerequisite_note: row.prerequisite_note || "",
    included_feature_title: row.included_feature_title || "",
    included_feature_subtitle: row.included_feature_subtitle || "",
    compatible_plans: compatiblePlans,
    required_modules: requiredModules,
    assigned_count: Number(row.assigned_count) || 0,
    created_by: row.created_by,
    updated_by: row.updated_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class PackService {
  /**
   * Retrieves all commercial feature packs with real-time assigned tenant counts
   */
  async getPacks(queryInput: GetPacksQuery): Promise<{ packs: PackDto[]; total: number }> {
    const whereConditions: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    // Search query
    if (queryInput.search && queryInput.search.trim()) {
      const q = `%${queryInput.search.trim()}%`;
      whereConditions.push(
        `(p.name ILIKE $${paramIndex} OR p.pack_code ILIKE $${paramIndex} OR p.description ILIKE $${paramIndex} OR p.included_feature_title ILIKE $${paramIndex})`
      );
      values.push(q);
      paramIndex++;
    }

    // Status filter
    if (queryInput.status && queryInput.status.trim() && queryInput.status !== "All Active") {
      whereConditions.push(`LOWER(p.status) = LOWER($${paramIndex})`);
      values.push(queryInput.status.trim());
      paramIndex++;
    }

    // Compatibility filter (checks if array contains or matches plan)
    if (queryInput.compatibility && queryInput.compatibility.trim() && queryInput.compatibility !== "All") {
      const comp = queryInput.compatibility.trim();
      whereConditions.push(`(p.compatible_plans::text ILIKE $${paramIndex})`);
      values.push(`%${comp}%`);
      paramIndex++;
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : "";

    const sql = `
      SELECT 
        p.*,
        COUNT(DISTINCT s.organization_id)::int AS assigned_count
      FROM commercial_packs p
      LEFT JOIN subscriptions s 
        ON s.packs ? p.pack_code AND s.status = 'Active'
      ${whereClause}
      GROUP BY p.id
      ORDER BY p.created_at DESC;
    `;

    const result = await query<PackDbRow>(sql, values);
    const packs = result.rows.map(mapRowToDto);

    return {
      packs,
      total: packs.length,
    };
  }

  /**
   * Retrieves a single pack by ID
   */
  async getPackById(id: string): Promise<PackDto> {
    const sql = `
      SELECT 
        p.*,
        COUNT(DISTINCT s.organization_id)::int AS assigned_count
      FROM commercial_packs p
      LEFT JOIN subscriptions s 
        ON s.packs ? p.pack_code AND s.status = 'Active'
      WHERE p.id = $1
      GROUP BY p.id
      LIMIT 1;
    `;

    const result = await query<PackDbRow>(sql, [id]);
    if (result.rows.length === 0) {
      throw new NotFoundException(`Commercial pack with ID '${id}' was not found`);
    }

    return mapRowToDto(result.rows[0]);
  }

  /**
   * Creates a new commercial feature pack
   */
  async createPack(data: CreatePackInput, userId?: string): Promise<PackDto> {
    const packCodeNormalized = data.pack_code.trim();

    // Check unique pack_code
    const existing = await query<{ id: string }>(
      "SELECT id FROM commercial_packs WHERE LOWER(pack_code) = LOWER($1) LIMIT 1;",
      [packCodeNormalized]
    );
    if (existing.rows.length > 0) {
      throw new BadRequestException(`A commercial pack with code '${packCodeNormalized}' already exists`);
    }

    const compatiblePlansJson = JSON.stringify(data.compatible_plans || []);
    const requiredModulesJson = JSON.stringify(data.required_modules || []);

    const insertSql = `
      INSERT INTO commercial_packs (
        name, pack_code, description, status, price, currency, cadence,
        effective_date, extended_limits, prerequisite_note,
        included_feature_title, included_feature_subtitle,
        compatible_plans, required_modules, created_by, updated_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15, $15)
      RETURNING *, 0 AS assigned_count;
    `;

    const result = await query<PackDbRow>(insertSql, [
      data.name.trim(),
      packCodeNormalized,
      data.description || "",
      data.status || "Draft",
      data.price,
      data.currency || "INR",
      data.cadence || "Monthly",
      data.effective_date || null,
      data.extended_limits || "",
      data.prerequisite_note || "",
      data.included_feature_title || "",
      data.included_feature_subtitle || "",
      compatiblePlansJson,
      requiredModulesJson,
      userId || null,
    ]);

    return mapRowToDto(result.rows[0]);
  }

  /**
   * Updates an existing pack
   */
  async updatePack(id: string, data: UpdatePackInput, userId?: string): Promise<PackDto> {
    const existingPack = await this.getPackById(id);

    if (data.pack_code && data.pack_code.trim().toLowerCase() !== existingPack.pack_code.toLowerCase()) {
      const codeCheck = await query<{ id: string }>(
        "SELECT id FROM commercial_packs WHERE LOWER(pack_code) = LOWER($1) AND id != $2 LIMIT 1;",
        [data.pack_code.trim(), id]
      );
      if (codeCheck.rows.length > 0) {
        throw new BadRequestException(`A commercial pack with code '${data.pack_code.trim()}' already exists`);
      }
    }

    const updateFields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (data.name !== undefined) {
      updateFields.push(`name = $${paramIndex++}`);
      values.push(data.name.trim());
    }
    if (data.pack_code !== undefined) {
      updateFields.push(`pack_code = $${paramIndex++}`);
      values.push(data.pack_code.trim());
    }
    if (data.description !== undefined) {
      updateFields.push(`description = $${paramIndex++}`);
      values.push(data.description);
    }
    if (data.status !== undefined) {
      updateFields.push(`status = $${paramIndex++}`);
      values.push(data.status);
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
    if (data.effective_date !== undefined) {
      updateFields.push(`effective_date = $${paramIndex++}`);
      values.push(data.effective_date || null);
    }
    if (data.extended_limits !== undefined) {
      updateFields.push(`extended_limits = $${paramIndex++}`);
      values.push(data.extended_limits);
    }
    if (data.prerequisite_note !== undefined) {
      updateFields.push(`prerequisite_note = $${paramIndex++}`);
      values.push(data.prerequisite_note);
    }
    if (data.included_feature_title !== undefined) {
      updateFields.push(`included_feature_title = $${paramIndex++}`);
      values.push(data.included_feature_title);
    }
    if (data.included_feature_subtitle !== undefined) {
      updateFields.push(`included_feature_subtitle = $${paramIndex++}`);
      values.push(data.included_feature_subtitle);
    }
    if (data.compatible_plans !== undefined) {
      updateFields.push(`compatible_plans = $${paramIndex++}::jsonb`);
      values.push(JSON.stringify(data.compatible_plans));
    }
    if (data.required_modules !== undefined) {
      updateFields.push(`required_modules = $${paramIndex++}::jsonb`);
      values.push(JSON.stringify(data.required_modules));
    }

    if (userId) {
      updateFields.push(`updated_by = $${paramIndex++}`);
      values.push(userId);
    }

    updateFields.push(`updated_at = now()`);
    values.push(id);

    const updateSql = `
      UPDATE commercial_packs
      SET ${updateFields.join(", ")}
      WHERE id = $${paramIndex}
      RETURNING *;
    `;

    await query(updateSql, values);
    return this.getPackById(id);
  }

  /**
   * Publishes a pack (transitions status to 'Published')
   */
  async publishPack(id: string, userId?: string): Promise<PackDto> {
    await this.getPackById(id);
    const sql = `
      UPDATE commercial_packs 
      SET status = 'Published', updated_by = $2, updated_at = now() 
      WHERE id = $1
      RETURNING *;
    `;
    await query(sql, [id, userId || null]);
    return this.getPackById(id);
  }

  /**
   * Retires a pack (transitions status to 'Retired')
   */
  async retirePack(id: string, userId?: string): Promise<PackDto> {
    await this.getPackById(id);
    const sql = `
      UPDATE commercial_packs 
      SET status = 'Retired', updated_by = $2, updated_at = now() 
      WHERE id = $1
      RETURNING *;
    `;
    await query(sql, [id, userId || null]);
    return this.getPackById(id);
  }

  /**
   * Deletes a pack if no active organizations are assigned
   */
  async deletePack(id: string): Promise<{ id: string; message: string }> {
    const pack = await this.getPackById(id);

    if (pack.assigned_count > 0) {
      throw new BadRequestException(
        `Cannot delete pack '${pack.name}' because it has ${pack.assigned_count} active assigned organization(s). Retire it instead.`
      );
    }

    await query("DELETE FROM commercial_packs WHERE id = $1;", [id]);
    return { id, message: `Commercial pack '${pack.name}' deleted successfully` };
  }
}

export const packService = new PackService();
