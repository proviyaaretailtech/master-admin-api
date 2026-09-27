-- Migration: 007_drop_role_and_panel_from_users.sql
-- Description: Drops role and panel columns from users table and ensures unique role names in security_roles

ALTER TABLE users DROP COLUMN IF EXISTS role;
ALTER TABLE users DROP COLUMN IF EXISTS panel;

-- 2. Unique role name constraint (case-insensitive) to prevent duplicate policy names
CREATE UNIQUE INDEX IF NOT EXISTS idx_security_roles_unique_name_lower ON security_roles (LOWER(name));
