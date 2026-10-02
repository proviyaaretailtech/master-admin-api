-- Migration: 008_alter_organizations_status_default_draft.sql
-- Description: Alters the default value of the status column in organizations to 'Draft'

ALTER TABLE organizations ALTER COLUMN status SET DEFAULT 'Draft';
