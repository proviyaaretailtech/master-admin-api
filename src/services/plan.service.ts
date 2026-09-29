import { query } from "../config/database.config";
import { NotFoundException, BadRequestException } from "../utils/app-error";
import { CreatePlanInput, UpdatePlanInput, GetPlansQueryInput } from "../validators/plan.validator";

export interface CommercialPlanModel {
  id: string;
  plan_code: string;
  name: string;
  version: string;
  version_type: "Draft" | "Active" | "Custom" | "Legacy";
  status: "Draft" | "Published" | "Retired";
  price: number;
  currency: string;
  cadence: string;
  tax_note: string;
  trial_days: number;
  effective_date: string | null;
  locations_limit: number;
  users_limit: number;
  is_unlimited_locations: boolean;
  is_unlimited_users: boolean;
  modules: string[];
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  assignments_count?: number;
  created_by_email?: string | null;
  updated_by_email?: string | null;
}

export class PlanService {
  /**
   * Sanitizes module payload: converts legacy "ALL" into active module keys,
   * removes duplicates, trims and filters out empty strings.
   */
  private async sanitizeModules(rawModules: any): Promise<string[]> {
    const list: string[] = Array.isArray(rawModules) ? rawModules : [];
    const hasAll = list.some((k) => typeof k === "string" && k.toUpperCase() === "ALL");
    if (hasAll) {
      const modRes = await query<{ key: string }>(
        "SELECT key FROM platform_modules WHERE is_active = true ORDER BY created_at ASC"
      );
      return modRes.rows.map((r) => r.key);
    }
    return Array.from(
      new Set(
        list
          .filter((k) => typeof k === "string" && k.trim().length > 0 && k.toUpperCase() !== "ALL")
          .map((k) => k.trim())
      )
    );
  }

  /**
   * Retrieves all commercial plans with subscriber count calculation
   */
  async getAll(
    filters: GetPlansQueryInput
  ): Promise<{ plans: CommercialPlanModel[]; total: number }> {
    const conditions: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (filters.search) {
      conditions.push(`(p.name ILIKE $${idx} OR p.plan_code ILIKE $${idx})`);
      values.push(`%${filters.search}%`);
      idx++;
    }

    if (filters.status && filters.status !== "all") {
      conditions.push(`p.status = $${idx}`);
      values.push(filters.status);
      idx++;
    }

    if (filters.cadence && filters.cadence !== "all") {
      conditions.push(`p.cadence = $${idx}`);
      values.push(filters.cadence);
      idx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countQuery = `SELECT COUNT(*) AS total FROM commercial_plans p ${whereClause}`;
    const countRes = await query<{ total: string }>(countQuery, values);
    const total = parseInt(countRes.rows[0]?.total || "0", 10);

    const dataQuery = `
      SELECT p.*,
             COALESCE(sub_counts.active_count, 0)::int AS assignments_count,
             u1.email AS created_by_email,
             u2.email AS updated_by_email
      FROM commercial_plans p
      LEFT JOIN (
        SELECT plan_id, COUNT(*) AS active_count
        FROM subscriptions
        WHERE status = 'Active'
        GROUP BY plan_id
      ) sub_counts ON p.id = sub_counts.plan_id
      LEFT JOIN users u1 ON p.created_by = u1.id
      LEFT JOIN users u2 ON p.updated_by = u2.id
      ${whereClause}
      ORDER BY p.created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}
    `;

    const limit = filters.limit || 50;
    const offset = ((filters.page || 1) - 1) * limit;
    values.push(limit, offset);

    const res = await query<CommercialPlanModel>(dataQuery, values);

    const plans = await Promise.all(
      res.rows.map(async (row) => ({
        ...row,
        price: parseFloat(row.price as any) || 0,
        assignments_count: Number(row.assignments_count || 0),
        modules: await this.sanitizeModules(row.modules),
      }))
    );

    return {
      plans,
      total,
    };
  }

  /**
   * Retrieves a single commercial plan by ID
   */
  async getById(id: string): Promise<CommercialPlanModel> {
    const res = await query<CommercialPlanModel>(
      `SELECT p.*,
              COALESCE(sub_counts.active_count, 0)::int AS assignments_count,
              u1.email AS created_by_email,
              u2.email AS updated_by_email
       FROM commercial_plans p
       LEFT JOIN (
         SELECT plan_id, COUNT(*) AS active_count
         FROM subscriptions
         WHERE status = 'Active'
         GROUP BY plan_id
       ) sub_counts ON p.id = sub_counts.plan_id
       LEFT JOIN users u1 ON p.created_by = u1.id
       LEFT JOIN users u2 ON p.updated_by = u2.id
       WHERE p.id = $1`,
      [id]
    );

    if (res.rows.length === 0) {
      throw new NotFoundException("Commercial plan not found");
    }

    const row = res.rows[0];
    return {
      ...row,
      price: parseFloat(row.price as any) || 0,
      assignments_count: Number(row.assignments_count || 0),
      modules: await this.sanitizeModules(row.modules),
    };
  }

  /**
   * Creates a new commercial plan
   */
  async create(data: CreatePlanInput, userId?: string): Promise<CommercialPlanModel> {
    const existing = await query(
      `SELECT id FROM commercial_plans WHERE LOWER(plan_code) = LOWER($1)`,
      [data.plan_code]
    );
    if (existing.rows.length > 0) {
      throw new BadRequestException(`Plan with code '${data.plan_code}' already exists`);
    }

    const sanitizedModules = await this.sanitizeModules(data.modules || []);

    const res = await query<CommercialPlanModel>(
      `INSERT INTO commercial_plans (
        plan_code, name, version, version_type, status, price, currency,
        cadence, tax_note, trial_days, effective_date, locations_limit,
        users_limit, is_unlimited_locations, is_unlimited_users, modules,
        created_by, updated_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      RETURNING *`,
      [
        data.plan_code,
        data.name,
        data.version || "v1.0",
        data.version_type || "Draft",
        data.status || "Draft",
        data.price || 0,
        data.currency || "INR",
        data.cadence || "Monthly",
        data.tax_note || "+18% GST Applicable",
        data.trial_days ?? 3,
        data.effective_date ? new Date(data.effective_date) : null,
        data.locations_limit || 1,
        data.users_limit || 3,
        data.is_unlimited_locations || false,
        data.is_unlimited_users || false,
        JSON.stringify(sanitizedModules),
        userId || null,
        userId || null,
      ]
    );

    return {
      ...res.rows[0],
      price: parseFloat(res.rows[0].price as any) || 0,
      assignments_count: 0,
      modules: sanitizedModules,
    };
  }

  /**
   * Updates an existing commercial plan
   */
  async update(id: string, data: UpdatePlanInput, userId?: string): Promise<CommercialPlanModel> {
    await this.getById(id);

    if (data.plan_code) {
      const conflict = await query(
        `SELECT id FROM commercial_plans WHERE LOWER(plan_code) = LOWER($1) AND id != $2`,
        [data.plan_code, id]
      );
      if (conflict.rows.length > 0) {
        throw new BadRequestException(`Plan with code '${data.plan_code}' already exists`);
      }
    }

    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (data.name !== undefined) {
      updates.push(`name = $${idx++}`);
      values.push(data.name);
    }
    if (data.plan_code !== undefined) {
      updates.push(`plan_code = $${idx++}`);
      values.push(data.plan_code);
    }
    if (data.version !== undefined) {
      updates.push(`version = $${idx++}`);
      values.push(data.version);
    }
    if (data.version_type !== undefined) {
      updates.push(`version_type = $${idx++}`);
      values.push(data.version_type);
    }
    if (data.status !== undefined) {
      updates.push(`status = $${idx++}`);
      values.push(data.status);
    }
    if (data.price !== undefined) {
      updates.push(`price = $${idx++}`);
      values.push(data.price);
    }
    if (data.currency !== undefined) {
      updates.push(`currency = $${idx++}`);
      values.push(data.currency);
    }
    if (data.cadence !== undefined) {
      updates.push(`cadence = $${idx++}`);
      values.push(data.cadence);
    }
    if (data.tax_note !== undefined) {
      updates.push(`tax_note = $${idx++}`);
      values.push(data.tax_note);
    }
    if (data.trial_days !== undefined) {
      updates.push(`trial_days = $${idx++}`);
      values.push(data.trial_days);
    }
    if (data.effective_date !== undefined) {
      updates.push(`effective_date = $${idx++}`);
      values.push(data.effective_date ? new Date(data.effective_date) : null);
    }
    if (data.locations_limit !== undefined) {
      updates.push(`locations_limit = $${idx++}`);
      values.push(data.locations_limit);
    }
    if (data.users_limit !== undefined) {
      updates.push(`users_limit = $${idx++}`);
      values.push(data.users_limit);
    }
    if (data.is_unlimited_locations !== undefined) {
      updates.push(`is_unlimited_locations = $${idx++}`);
      values.push(data.is_unlimited_locations);
    }
    if (data.is_unlimited_users !== undefined) {
      updates.push(`is_unlimited_users = $${idx++}`);
      values.push(data.is_unlimited_users);
    }
    if (data.modules !== undefined) {
      const sanitizedModules = await this.sanitizeModules(data.modules);
      updates.push(`modules = $${idx++}`);
      values.push(JSON.stringify(sanitizedModules));
    }

    if (userId) {
      updates.push(`updated_by = $${idx++}`);
      values.push(userId);
    }

    if (updates.length === 0) {
      return this.getById(id);
    }

    values.push(id);
    await query(
      `UPDATE commercial_plans SET ${updates.join(", ")}, updated_at = now() WHERE id = $${idx}`,
      values
    );

    return this.getById(id);
  }

  /**
   * Publishes a commercial plan (moves from Draft to Published & Active)
   */
  async publish(id: string, userId?: string): Promise<CommercialPlanModel> {
    const plan = await this.getById(id);

    if (plan.status === "Published") {
      return plan;
    }

    return this.update(
      id,
      {
        status: "Published",
        version_type: "Active",
      },
      userId
    );
  }

  /**
   * Duplicates an existing commercial plan into a Draft copy
   */
  async duplicate(id: string, userId?: string): Promise<CommercialPlanModel> {
    const source = await this.getById(id);
    // time in seconds till now last 5 charaters
    const random = Date.now().toString(36).slice(-5);
    const timestamp = Date.now().toString(36);
    const newPlanCode = `${source.plan_code}_${random}`;
    const newName = `${source.name} (Copy)`;

    return this.create(
      {
        name: newName,
        plan_code: newPlanCode,
        version: `${source.version}`,
        version_type: "Draft",
        status: "Draft",
        price: source.price,
        currency: source.currency,
        cadence: source.cadence as any,
        tax_note: source.tax_note,
        trial_days: source.trial_days,
        effective_date: null,
        locations_limit: source.locations_limit,
        users_limit: source.users_limit,
        is_unlimited_locations: source.is_unlimited_locations,
        is_unlimited_users: source.is_unlimited_users,
        modules: source.modules,
      },
      userId
    );
  }

  /**
   * Retires or archives a plan
   */
  async retire(id: string, userId?: string): Promise<CommercialPlanModel> {
    return this.update(
      id,
      {
        status: "Retired",
        version_type: "Legacy",
      },
      userId
    );
  }

  /**
   * Deletes a plan if it has no active subscriptions
   */
  async delete(id: string): Promise<void> {
    const plan = await this.getById(id);
    if ((plan.assignments_count || 0) > 0) {
      throw new BadRequestException(
        "Cannot delete plan with active tenant subscriptions. Retire it instead."
      );
    }
    await query(`DELETE FROM commercial_plans WHERE id = $1`, [id]);
  }
}

export const planService = new PlanService();
