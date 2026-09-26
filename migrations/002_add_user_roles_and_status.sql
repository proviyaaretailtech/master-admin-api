-- Migration: 002_add_user_roles_and_status.sql
-- Description: Adds role, panel, status, business, and last_login fields to users table, and seeds system accounts

ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'admin';
ALTER TABLE users ADD COLUMN IF NOT EXISTS panel VARCHAR(50) DEFAULT 'admin';
ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'Active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS business VARCHAR(100) DEFAULT '-';
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ;

-- Seed initial system accounts matching the system accounts panel
INSERT INTO users (first_name, last_name, email, phone_number, password, panel, role, business, status)
VALUES
  ('super', 'admin', 'superadmin@onlatur.com', '-', '$2b$10$DPblimyykkiG6qIIuwzQeeI/2upJAY.FdSOTQH1PtbLlmsv1s0Qh2', 'admin', 'admin', '-', 'Active')
ON CONFLICT (email) DO UPDATE 
SET panel = EXCLUDED.panel,
    role = EXCLUDED.role,
    status = EXCLUDED.status;
