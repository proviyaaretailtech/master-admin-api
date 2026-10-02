-- ============================================================================
-- Migration: 006_create_security_roles_table.sql
-- Description: Creates the security_roles table with the multi-level delimited
--              permissions column ($$$ between modules, :: for config, $ between actions).
--              Adds role_id to users table.
-- NOTE: Contains ZERO sample/mock data. Roles are created dynamically via UI.
-- ============================================================================

-- 1. Create the Security Roles table
CREATE TABLE IF NOT EXISTS security_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  key VARCHAR(100) UNIQUE NOT NULL,
  scope VARCHAR(50) NOT NULL DEFAULT 'One organization',
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_system BOOLEAN NOT NULL DEFAULT false,
  
  -- Multi-level delimited permissions string:
  -- Format: module::access_level::action1$action2$$$module2::access_level::action1
  permissions TEXT NOT NULL DEFAULT '',
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast lookup indexes
CREATE INDEX IF NOT EXISTS idx_security_roles_key ON security_roles(key);
CREATE INDEX IF NOT EXISTS idx_security_roles_is_active ON security_roles(is_active);
CREATE INDEX IF NOT EXISTS idx_security_roles_scope ON security_roles(scope);

-- Trigger for auto-updating updated_at timestamp
DROP TRIGGER IF EXISTS update_security_roles_updated_at ON security_roles;
CREATE TRIGGER update_security_roles_updated_at
BEFORE UPDATE ON security_roles
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- 2. Add role_id foreign key to the users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id UUID REFERENCES security_roles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);
