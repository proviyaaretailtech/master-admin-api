import { query } from "../config/database.config";
import { NotFoundException, BadRequestException } from "../utils/app-error";
import { CreateModuleInput, UpdateModuleInput } from "../validators/module.validator";

export interface PlatformModuleModel {
  id: string;
  key: string;
  name: string;
  category: string;
  description: string;
  is_active: boolean;
  plans_count?: number;
  created_at: string;
  updated_at: string;
}

export class ModuleService {
  /**
   * Retrieves all platform modules with plan inclusion counts
   */
  async getAll(): Promise<PlatformModuleModel[]> {
    const res = await query<PlatformModuleModel>(
      `SELECT m.*,
              COALESCE(
                (SELECT count(*)::int FROM commercial_plans cp
                 WHERE cp.modules @> jsonb_build_array(m.key)),
                0
              ) AS plans_count
       FROM platform_modules m
       ORDER BY m.created_at ASC`
    );
    return res.rows.map((row) => ({
      ...row,
      plans_count: Number(row.plans_count || 0),
    }));
  }

  /**
   * Retrieves a platform module by ID
   */
  async getById(id: string): Promise<PlatformModuleModel> {
    const res = await query<PlatformModuleModel>(`SELECT * FROM platform_modules WHERE id = $1`, [
      id,
    ]);
    if (res.rows.length === 0) {
      throw new NotFoundException("Platform module not found");
    }
    return res.rows[0];
  }

  /**
   * Creates a new platform module
   */
  async create(data: CreateModuleInput): Promise<PlatformModuleModel> {
    const existing = await query(`SELECT id FROM platform_modules WHERE LOWER(key) = LOWER($1)`, [
      data.key,
    ]);
    if (existing.rows.length > 0) {
      throw new BadRequestException(`Module with key '${data.key}' already exists`);
    }

    const res = await query<PlatformModuleModel>(
      `INSERT INTO platform_modules (key, name, category, description, is_active)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        data.key.toUpperCase(),
        data.name,
        data.category || "Core",
        data.description || "",
        data.is_active ?? true,
      ]
    );

    return res.rows[0];
  }

  /**
   * Updates an existing platform module
   */
  async update(id: string, data: UpdateModuleInput): Promise<PlatformModuleModel> {
    await this.getById(id);

    if (data.key) {
      const conflict = await query(
        `SELECT id FROM platform_modules WHERE LOWER(key) = LOWER($1) AND id != $2`,
        [data.key, id]
      );
      if (conflict.rows.length > 0) {
        throw new BadRequestException(`Module with key '${data.key}' already exists`);
      }
    }

    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (data.key !== undefined) {
      updates.push(`key = $${idx++}`);
      values.push(data.key.toUpperCase());
    }
    if (data.name !== undefined) {
      updates.push(`name = $${idx++}`);
      values.push(data.name);
    }
    if (data.category !== undefined) {
      updates.push(`category = $${idx++}`);
      values.push(data.category);
    }
    if (data.description !== undefined) {
      updates.push(`description = $${idx++}`);
      values.push(data.description);
    }
    if (data.is_active !== undefined) {
      updates.push(`is_active = $${idx++}`);
      values.push(data.is_active);
    }

    if (updates.length === 0) {
      return this.getById(id);
    }

    values.push(id);
    const res = await query<PlatformModuleModel>(
      `UPDATE platform_modules SET ${updates.join(", ")}, updated_at = now() WHERE id = $${idx} RETURNING *`,
      values
    );

    return res.rows[0];
  }

  /**
   * Deletes a platform module
   */
  async delete(id: string): Promise<void> {
    const mod = await this.getById(id);

    const inUse = await query<{ name: string }>(
      `SELECT name FROM commercial_plans WHERE modules @> $1::jsonb LIMIT 1`,
      [JSON.stringify([mod.key])]
    );
    if (inUse.rows.length > 0) {
      throw new BadRequestException(
        `Cannot delete module '${mod.name}' (${mod.key}) because it is included in commercial plan '${inUse.rows[0].name}'. Please remove it from the plan before deleting.`
      );
    }

    await query(`DELETE FROM platform_modules WHERE id = $1`, [id]);
  }
}

export const moduleService = new ModuleService();
