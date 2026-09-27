-- Migration: 005_create_locations_table.sql
-- Description: Creates the locations table associated with organizations, including location name, area, code, type, status, time_zone, currency, and timestamps

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
CREATE INDEX IF NOT EXISTS idx_locations_org_id ON locations(org_id);
CREATE INDEX IF NOT EXISTS idx_locations_code ON locations(org_id, code);
CREATE INDEX IF NOT EXISTS idx_locations_status ON locations(status);
CREATE INDEX IF NOT EXISTS idx_locations_type ON locations(type);
CREATE INDEX IF NOT EXISTS idx_locations_name ON locations(name);

-- Trigger for auto-updating updated_at
DROP TRIGGER IF EXISTS update_locations_updated_at ON locations;
CREATE TRIGGER update_locations_updated_at
BEFORE UPDATE ON locations
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Seed initial benchmark locations for existing organizations if not already present
DO $$
DECLARE
  first_org_id UUID;
BEGIN
  SELECT id INTO first_org_id FROM organizations LIMIT 1;
  IF first_org_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM locations WHERE org_id = first_org_id) THEN
    INSERT INTO locations (org_id, name, area, code, type, status, time_zone, currency)
    VALUES
      (first_org_id, 'Main Restaurant', 'Indiranagar, Bengaluru', 'ANN-MAIN', 'Restaurant', 'Active', 'Asia/Kolkata', 'INR (₹)'),
      (first_org_id, 'Cloud Kitchen North', 'Hebbal, Bengaluru', 'ANN-NORTH', 'Cloud Kitchen', 'Active', 'Asia/Kolkata', 'INR (₹)'),
      (first_org_id, 'Delivery Hub East', 'Whitefield, Bengaluru', 'ANN-EAST', 'Delivery Hub', 'Pending', 'Asia/Kolkata', 'INR (₹)'),
      (first_org_id, 'Central Warehouse', 'Hosur Road, Bengaluru', 'ANN-WHSE', 'Warehouse', 'Inactive', 'Asia/Kolkata', 'INR (₹)'),
      (first_org_id, 'New Outlet South', 'JP Nagar, Bengaluru', 'ANN-SOUTH', 'Restaurant', 'Draft', 'Asia/Kolkata', 'INR (₹)');
  END IF;
END $$;
