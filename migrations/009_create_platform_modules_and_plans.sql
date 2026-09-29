-- Migration: 009_create_platform_modules_and_plans.sql
-- Description: Creates platform_modules, commercial_plans (with JSONB modules array), and subscriptions table without static data

-- 1. Master Platform Modules Table
CREATE TABLE IF NOT EXISTS platform_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(6) UNIQUE NOT NULL,
  name VARCHAR(150) NOT NULL,
  category VARCHAR(100) NOT NULL DEFAULT 'Core',
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_modules_key ON platform_modules(key);
CREATE INDEX IF NOT EXISTS idx_platform_modules_category ON platform_modules(category);
CREATE INDEX IF NOT EXISTS idx_platform_modules_is_active ON platform_modules(is_active);

DROP TRIGGER IF EXISTS update_platform_modules_updated_at ON platform_modules;
CREATE TRIGGER update_platform_modules_updated_at
BEFORE UPDATE ON platform_modules
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- 2. Commercial Plans Table (with JSONB modules array: ["ALL"] or ["MODORG", "MODACC", ...])
CREATE TABLE IF NOT EXISTS commercial_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_code VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(150) NOT NULL,
  version VARCHAR(10) NOT NULL DEFAULT 'v1.0',
  version_type VARCHAR(20) NOT NULL DEFAULT 'Draft',
  status VARCHAR(30) NOT NULL DEFAULT 'Draft',
  price NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  currency VARCHAR(10) NOT NULL DEFAULT 'INR',
  cadence VARCHAR(30) NOT NULL DEFAULT 'Monthly',
  tax_note VARCHAR(150) DEFAULT '+18% GST Applicable',
  trial_days INTEGER NOT NULL DEFAULT 3,
  effective_date TIMESTAMPTZ,
  locations_limit INTEGER NOT NULL DEFAULT 1,
  users_limit INTEGER NOT NULL DEFAULT 3,
  is_unlimited_locations BOOLEAN NOT NULL DEFAULT false,
  is_unlimited_users BOOLEAN NOT NULL DEFAULT false,
  modules JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commercial_plans_plan_code ON commercial_plans(plan_code);
CREATE INDEX IF NOT EXISTS idx_commercial_plans_status ON commercial_plans(status);
CREATE INDEX IF NOT EXISTS idx_commercial_plans_version_type ON commercial_plans(version_type);
CREATE INDEX IF NOT EXISTS idx_commercial_plans_created_at ON commercial_plans(created_at);
CREATE INDEX IF NOT EXISTS idx_commercial_plans_modules ON commercial_plans USING gin (modules);

DROP TRIGGER IF EXISTS update_commercial_plans_updated_at ON commercial_plans;
CREATE TRIGGER update_commercial_plans_updated_at
BEFORE UPDATE ON commercial_plans
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- 3. Subscriptions Table (Links Organizations to Commercial Plans)
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES commercial_plans(id) ON DELETE RESTRICT,
  status VARCHAR(30) NOT NULL DEFAULT 'Active',
  billing_cadence VARCHAR(30) NOT NULL DEFAULT 'Monthly',
  current_period_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_period_end TIMESTAMPTZ,
  trial_start TIMESTAMPTZ,
  trial_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  canceled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_organization_id ON subscriptions(organization_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_plan_id ON subscriptions(plan_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

DROP TRIGGER IF EXISTS update_subscriptions_updated_at ON subscriptions;
CREATE TRIGGER update_subscriptions_updated_at
BEFORE UPDATE ON subscriptions
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
