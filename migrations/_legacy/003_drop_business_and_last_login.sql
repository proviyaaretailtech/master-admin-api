-- Migration: 003_drop_business_and_last_login.sql
-- Description: Drops business and last_login columns from users table

ALTER TABLE users DROP COLUMN IF EXISTS business;
ALTER TABLE users DROP COLUMN IF EXISTS last_login;
