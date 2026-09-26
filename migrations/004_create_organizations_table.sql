-- Migration: 004_create_organizations_table.sql
-- Description: Creates organizations table with business_name, domain, status, email, phone_number, unique constraints, and auto-timestamps

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name VARCHAR(150) NOT NULL,
  domain VARCHAR(100) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'Active',
  email VARCHAR(255) NOT NULL UNIQUE,
  phone_number VARCHAR(50) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast lookup indexes
CREATE INDEX IF NOT EXISTS idx_organizations_email ON organizations(email);
CREATE INDEX IF NOT EXISTS idx_organizations_phone ON organizations(phone_number);
CREATE INDEX IF NOT EXISTS idx_organizations_domain ON organizations(domain);
CREATE INDEX IF NOT EXISTS idx_organizations_status ON organizations(status);
CREATE INDEX IF NOT EXISTS idx_organizations_business_name ON organizations(business_name);

-- Trigger for auto-updating updated_at
DROP TRIGGER IF EXISTS update_organizations_updated_at ON organizations;
CREATE TRIGGER update_organizations_updated_at
BEFORE UPDATE ON organizations
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Seed initial benchmark organizations
INSERT INTO organizations (business_name, domain, status, email, phone_number)
VALUES
  ('The Burger Joint Corp', 'Restaurant', 'Active', 'ops@burgerjoint.com', '+1 (555) 019-2834'),
  ('FreshCart Grocers Logistics', 'Logistics', 'Pending', 'partners@freshcart.io', '+1 (555) 043-9812'),
  ('QuickClean Facilities LLC', 'Service', 'Active', 'facility@quickclean.co', '+1 (555) 091-7654'),
  ('Pizza Al Taglio Italia', 'Restaurant', 'Active', 'contact@altagliopizza.com', '+1 (555) 021-3948'),
  ('Subway Express Holdings', 'Restaurant', 'Suspended', 'express@subwaypartners.com', '+1 (555) 055-1234')
ON CONFLICT (email) DO NOTHING;
