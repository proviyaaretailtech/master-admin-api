-- Migration: 005_create_locations_table.sql
-- Description: Creates the org_locations table associated with organizations, including location name, area, code, type, status, time_zone, currency, and timestamps
-- NOTE: Contains ZERO sample data. Locations are created dynamically via UI.

CREATE TABLE IF NOT EXISTS org_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(150) NOT NULL,
  area VARCHAR(150),
  code VARCHAR(50),
  type VARCHAR(50) NOT NULL DEFAULT 'Restaurant',
  status VARCHAR(30) NOT NULL DEFAULT 'Active',
  time_zone VARCHAR(50) NOT NULL DEFAULT 'Asia/Kolkata',
  currency VARCHAR(30) NOT NULL DEFAULT 'INR (₹)',
  last_sync TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast lookup indexes
CREATE INDEX IF NOT EXISTS idx_org_locations_org_id ON org_locations(org_id);
CREATE INDEX IF NOT EXISTS idx_org_locations_code ON org_locations(org_id, code);
CREATE INDEX IF NOT EXISTS idx_org_locations_status ON org_locations(status);
CREATE INDEX IF NOT EXISTS idx_org_locations_type ON org_locations(type);
CREATE INDEX IF NOT EXISTS idx_org_locations_name ON org_locations(name);

-- Trigger for auto-updating updated_at
DROP TRIGGER IF EXISTS update_org_locations_updated_at ON org_locations;
CREATE TRIGGER update_org_locations_updated_at
BEFORE UPDATE ON org_locations
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
