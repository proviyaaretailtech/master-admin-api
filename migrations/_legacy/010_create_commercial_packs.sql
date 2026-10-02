-- ============================================================================
-- Migration: 010_create_commercial_packs.sql
-- Description: Creates commercial_packs table and adds packs JSONB column to subscriptions table.
-- Zero static data.
-- ============================================================================

-- 1. Create Commercial Feature Packs table
CREATE TABLE IF NOT EXISTS commercial_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_code VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'Draft',
  price NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  currency VARCHAR(10) NOT NULL DEFAULT 'INR',
  cadence VARCHAR(30) NOT NULL DEFAULT 'Monthly',
  effective_date TIMESTAMPTZ,
  extended_limits TEXT,
  prerequisite_note TEXT,
  
  -- Included feature display highlights
  included_feature_title VARCHAR(200),
  included_feature_subtitle VARCHAR(200),
  
  -- JSONB array of compatible plan codes/names
  compatible_plans JSONB NOT NULL DEFAULT '[]'::jsonb,
  required_modules JSONB NOT NULL DEFAULT '[]'::jsonb,

  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast lookup indexes
CREATE INDEX IF NOT EXISTS idx_commercial_packs_pack_code ON commercial_packs(pack_code);
CREATE INDEX IF NOT EXISTS idx_commercial_packs_status ON commercial_packs(status);
CREATE INDEX IF NOT EXISTS idx_commercial_packs_compatible_plans ON commercial_packs USING gin (compatible_plans);
CREATE INDEX IF NOT EXISTS idx_commercial_packs_created_at ON commercial_packs(created_at);

-- Trigger for auto-updating updated_at timestamp
DROP TRIGGER IF EXISTS update_commercial_packs_updated_at ON commercial_packs;
CREATE TRIGGER update_commercial_packs_updated_at
BEFORE UPDATE ON commercial_packs
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- 2. Add packs JSONB column to subscriptions table if not present
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS packs JSONB NOT NULL DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS idx_subscriptions_packs ON subscriptions USING gin (packs);
