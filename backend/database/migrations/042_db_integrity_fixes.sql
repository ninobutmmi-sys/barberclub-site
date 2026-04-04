-- Migration 042: Database integrity fixes
-- Fix register_closings UNIQUE constraint to include salon_id
-- Fix client_id FK missing ON DELETE for RGPD compliance
-- Fix salon_id type inconsistencies

-- 1. Fix register_closings: UNIQUE(date) → UNIQUE(date, salon_id)
-- Drop the old unique constraint and add new one
ALTER TABLE register_closings DROP CONSTRAINT IF EXISTS register_closings_date_key;
ALTER TABLE register_closings ADD CONSTRAINT register_closings_date_salon_key UNIQUE(date, salon_id);

-- 2. Fix bookings.client_id: add ON DELETE SET NULL for RGPD deletion
-- First make client_id nullable (needed for SET NULL)
ALTER TABLE bookings ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_client_id_fkey;
ALTER TABLE bookings ADD CONSTRAINT bookings_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;

-- 3. Fix product_sales.client_id: same treatment
ALTER TABLE product_sales DROP CONSTRAINT IF EXISTS product_sales_client_id_fkey;
ALTER TABLE product_sales ADD CONSTRAINT product_sales_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;

-- 4. Fix salon_id type inconsistencies
-- audit_log: VARCHAR(50) → VARCHAR(20)
ALTER TABLE audit_log ALTER COLUMN salon_id TYPE VARCHAR(20);

-- push_subscriptions: VARCHAR(50) → VARCHAR(20)
ALTER TABLE push_subscriptions ALTER COLUMN salon_id TYPE VARCHAR(20);

-- challenges: TEXT → VARCHAR(20)
ALTER TABLE challenges ALTER COLUMN salon_id TYPE VARCHAR(20);
