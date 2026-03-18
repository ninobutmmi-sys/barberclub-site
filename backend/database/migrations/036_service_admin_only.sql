-- 036: Add admin_only flag to services
-- When true, service is usable by admin but hidden from public booking page
ALTER TABLE services ADD COLUMN IF NOT EXISTS admin_only BOOLEAN NOT NULL DEFAULT false;
