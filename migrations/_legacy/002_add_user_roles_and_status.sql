-- Migration: 002_add_user_roles_and_status.sql
-- Description: Adds role, panel, status, business, and last_login fields to users table, and seeds system accounts

ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'admin';
ALTER TABLE users ADD COLUMN IF NOT EXISTS panel VARCHAR(50) DEFAULT 'admin';
ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'Active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS business VARCHAR(100) DEFAULT '-';
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ;

-- Seed initial system accounts matching the system accounts panel
-- (seeded superadmin account removed: credential material must never be committed. Platform admins are created with `npm run bootstrap:admin`.)
