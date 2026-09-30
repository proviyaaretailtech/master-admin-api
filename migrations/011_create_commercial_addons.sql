-- ============================================================================
-- Migration: 011_create_commercial_addons.sql
-- Description: Creates commercial_addons table and adds addons JSONB column to subscriptions table.
-- Zero static data.
-- ============================================================================

-- 1. Create Commercial Add-ons table
CREATE TABLE IF NOT EXISTS commercial_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  addon_code VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  category VARCHAR(100) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'Draft',
  version VARCHAR(20) NOT NULL DEFAULT 'v1.0',
  
  -- Pricing & Billing
  price NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  currency VARCHAR(10) NOT NULL DEFAULT 'INR',
  cadence VARCHAR(30) NOT NULL DEFAULT 'Monthly',
  unit_label VARCHAR(100) DEFAULT 'location',
  pricing_subtitle VARCHAR(200),
  effective_date TIMESTAMPTZ,
  
  -- Purchase Quantity Controls
  min_quantity INTEGER NOT NULL DEFAULT 1,
  max_quantity INTEGER NOT NULL DEFAULT 10,
  
  -- Plan Compatibility
  compatible_plans JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- System Integration Validation Flags
  billing_sync_status VARCHAR(50) DEFAULT 'Success',
  entitlement_validation_status VARCHAR(50) DEFAULT 'Passed',
  tax_compliance_status VARCHAR(50) DEFAULT 'Pending verification',

  -- Audit & Timestamps
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast lookup indexes
CREATE INDEX IF NOT EXISTS idx_commercial_addons_addon_code ON commercial_addons(addon_code);
CREATE INDEX IF NOT EXISTS idx_commercial_addons_status ON commercial_addons(status);
CREATE INDEX IF NOT EXISTS idx_commercial_addons_category ON commercial_addons(category);
CREATE INDEX IF NOT EXISTS idx_commercial_addons_compatible_plans ON commercial_addons USING gin (compatible_plans);
CREATE INDEX IF NOT EXISTS idx_commercial_addons_created_at ON commercial_addons(created_at);

-- Trigger for auto-updating updated_at timestamp
DROP TRIGGER IF EXISTS update_commercial_addons_updated_at ON commercial_addons;
CREATE TRIGGER update_commercial_addons_updated_at
BEFORE UPDATE ON commercial_addons
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- 2. Add addons JSONB column to subscriptions table if not present
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS addons JSONB NOT NULL DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS idx_subscriptions_addons ON subscriptions USING gin (addons);
